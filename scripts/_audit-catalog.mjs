// Audit quotidien automatisé (parcours COMPLET du catalogue).
//
// Étape « rapide » de l'architecture hybride décrite dans AUDIT-COMPLET.md :
//  1. Ce script parcourt toutes les offres avec une `url` connue.
//  2. Il compare le prix stocké au prix affiché sur la page (via Playwright).
//  3. Il flague explicitement chaque cas ambigu (mots-clés suspects, prix
//     inextractable, écart de prix).
//  4. Il écrit un rapport unique dans `scripts/daily-audit-log.md`
//     (rolling : les runs les plus récents en haut).
//  5. Il maintient un état `scripts/daily-audit-state.json` pour tracer la
//     date du dernier run et de la dernière passe complète manuelle validée
//     (permet de déclencher l'AUDIT COMPLET si > 2 jours sans passe).
//
// Ce script NE MODIFIE PAS index.html. Il n'auto-corrige rien. Toute décision
// (bump de prix, prolongation de promoData, retrait d'offre) reste manuelle,
// prise avec browser MCP + jugement, comme documenté dans AUDIT-COMPLET.md.
//
// Usage :
//   node scripts/_audit-catalog.mjs                  # run complet
//   node scripts/_audit-catalog.mjs --limit 20       # premiers 20 (debug rapide)
//   node scripts/_audit-catalog.mjs --category mobile  # subset
//   node scripts/_audit-catalog.mjs --mark-full-pass   # marque une passe manuelle validée (reset le compteur)
//   node scripts/_audit-catalog.mjs --dry-run          # inventaire sans Playwright
//
// Note : ce script REMPLACE l'ancien _audit-catalog.mjs qui dumpait juste le
// texte brut de landings hardcodées, vague par vague. L'ancien comportement
// n'est plus utilisé — le parcours par URL depuis index.html est plus fidèle
// à la réalité du catalogue.

import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { loadData, checkOffer, detectSuspiciousKeywords } from "./lib/audit-lib.mjs";

const CHROME_PATH =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const LOG_PATH = "scripts/daily-audit-log.md";
const STATE_PATH = "scripts/daily-audit-state.json";

// Nombre de jours max entre 2 passes complètes AVANT que le trigger « manuel »
// soit forcé, même sans flag. Cf. AUDIT-COMPLET.md.
const DAYS_BEFORE_FORCED_FULL_PASS = 2;

// === Args ===
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const argVal = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

// === Mode --mark-full-pass : marque une passe manuelle complète et exit ===
// À invoquer par l'utilisateur après un AUDIT COMPLET manuel validé et pushé.
// Ex : `node scripts/_audit-catalog.mjs --mark-full-pass`
if (flag("mark-full-pass")) {
  const state = loadState();
  const today = new Date().toISOString().slice(0, 10);
  state.lastFullPassDate = today;
  saveState(state);
  console.log(`✅ Passe complète manuelle enregistrée le ${today}.`);
  process.exit(0);
}

const LIMIT = parseInt(argVal("limit") || "0", 10);
const CATEGORY = argVal("category"); // "mobile" | "internet" | "tv" | "combo" | "promo"
const DRY = flag("dry-run");

// === Chargement des offres ===
const data = loadData();
const CATS = CATEGORY ? [CATEGORY] : ["mobile", "internet", "tv", "combo", "promo"];
const pool = [];
for (const cat of CATS) {
  if (!data[cat]) continue;
  for (const item of data[cat]) {
    if (!item.url) continue; // pas d'URL = pas auditable
    pool.push({ ...item, __cat: cat });
  }
}
// Dédup par (cat, url, name) — certaines offres ont la même URL (ex Wingo Migration warning
// partagée). On garde chaque entrée distincte (nom différent), mais on compte
// une seule requête HTTP par URL — les résultats sont ensuite ventilés.
const uniqueUrls = [...new Set(pool.map(o => o.url))];
console.log(`▶ Audit daily : ${pool.length} offres (${uniqueUrls.length} URLs uniques) sur ${CATS.join("+")}`);

if (DRY) {
  console.log("(dry-run — pas de Playwright, exit)");
  process.exit(0);
}

let subset = pool;
if (LIMIT > 0) subset = pool.slice(0, LIMIT);

// === Playwright ===
const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
const ctx = await browser.newContext({
  userAgent: UA,
  locale: "fr-CH",
  timezoneId: "Europe/Zurich",
  viewport: { width: 1280, height: 900 },
  extraHTTPHeaders: { "accept-language": "fr-CH,fr;q=0.9,en;q=0.5" },
});

// Cache par URL : si plusieurs offres pointent vers la même URL, on ne charge
// la page qu'une fois. Économie de temps significative sur les gros opérateurs.
const urlCache = new Map(); // url → { text, pricesOnPage, httpStatus, ... }

async function getUrlSnapshot(url) {
  if (urlCache.has(url)) return urlCache.get(url);
  // fabrique un "item stub" avec url + price=null pour forcer NON_VÉRIFIABLE
  // et récupérer text + pricesOnPage sans comparer.
  const snap = await checkOffer(ctx, { url, price: null }, { waitAfter: 1500 });
  urlCache.set(url, snap);
  return snap;
}

const results = [];
let idx = 0;
for (const item of subset) {
  idx++;
  const t0 = Date.now();
  process.stdout.write(`  [${idx}/${subset.length}] ${item.__cat}/${item.operator || ""}/${item.name} `);
  const snap = await getUrlSnapshot(item.url);
  let verdict;
  if (snap.status === "URL_MORTE" || snap.status === "PAGE_VIDE" || snap.status === "ERREUR") {
    verdict = { ...snap };
  } else {
    // Comparaison prix stocké vs pricesOnPage
    const expected = typeof item.price === "number" ? item.price.toFixed(2) : null;
    if (!expected || item.price === 0) {
      verdict = { status: "NON_VÉRIFIABLE", pricesOnPage: snap.pricesOnPage };
    } else if (snap.pricesOnPage?.includes(expected)) {
      verdict = { status: "OK", expected, pricesOnPage: snap.pricesOnPage.slice(0, 15) };
    } else {
      const near = (snap.pricesOnPage || [])
        .map(p => ({ p, diff: Math.abs(parseFloat(p) - parseFloat(expected)) }))
        .filter(x => x.diff <= parseFloat(expected) * 0.15)
        .sort((a, b) => a.diff - b.diff)
        .slice(0, 3)
        .map(x => x.p);
      verdict = { status: "ÉCART", expected, pricesOnPage: (snap.pricesOnPage || []).slice(0, 15), near };
    }
  }
  const keywords = snap.text ? detectSuspiciousKeywords(snap.text) : [];
  verdict.keywords = keywords;
  const ms = Date.now() - t0;
  const icon = { OK: "✅", ÉCART: "⚠️", URL_MORTE: "❌", PAGE_VIDE: "📭", ERREUR: "💥", NON_VÉRIFIABLE: "ℹ️", SKIP_NO_URL: "⏭" }[verdict.status] || "?";
  const kwFlag = keywords.length ? ` [kw:${keywords.length}]` : "";
  console.log(`${icon} ${verdict.status}${kwFlag} (${ms}ms)`);
  results.push({ item, verdict, ms });
}

await browser.close();

// === Agrégation par verdict ===
const counts = { OK: 0, ÉCART: 0, URL_MORTE: 0, PAGE_VIDE: 0, ERREUR: 0, NON_VÉRIFIABLE: 0 };
for (const r of results) counts[r.verdict.status] = (counts[r.verdict.status] || 0) + 1;
const withKeywords = results.filter(r => r.verdict.keywords?.length > 0);
const flagged = results.filter(r =>
  r.verdict.status === "ÉCART" ||
  r.verdict.status === "URL_MORTE" ||
  r.verdict.status === "PAGE_VIDE" ||
  r.verdict.status === "ERREUR" ||
  (r.verdict.keywords?.length > 0)
);

// === Trigger logic ===
// Date locale (fuseau Europe/Zurich) — évite le drift UTC en fin de journée qui
// afficherait une date "-1" pendant les heures nocturnes CEST.
function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const state = loadState();
const today = todayLocalISO();
const daysSinceFullPass = state.lastFullPassDate
  ? Math.floor((new Date(today) - new Date(state.lastFullPassDate)) / 86400000)
  : null;
const overdue = daysSinceFullPass === null || daysSinceFullPass > DAYS_BEFORE_FORCED_FULL_PASS;
const triggerManual = flagged.length > 0 || overdue;

// === Rapport markdown ===
const lines = [];
lines.push(`# Daily audit — ${today}`);
lines.push("");
lines.push(`- **Total offres auditées** : ${results.length}${LIMIT ? ` (limité, catalogue total = ${pool.length})` : ""}`);
lines.push(`- **URLs uniques chargées** : ${urlCache.size}`);
lines.push(`- **Verdicts** : ${Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(", ")}`);
lines.push(`- **Mots-clés suspects** : ${withKeywords.length} offre(s)`);
lines.push(`- **Dernière passe complète manuelle** : ${state.lastFullPassDate || "(jamais)"}${daysSinceFullPass !== null ? ` (il y a ${daysSinceFullPass} j)` : ""}`);
lines.push("");
lines.push(triggerManual
  ? `## 🚨 AUDIT COMPLET REQUIS`
  : `## ✅ Pas de trigger — automatique OK`);
lines.push("");
if (triggerManual) {
  const reasons = [];
  if (flagged.length > 0) reasons.push(`${flagged.length} offre(s) flaguée(s) (écart/illisible/mots-clés)`);
  if (overdue) reasons.push(daysSinceFullPass === null
    ? `aucune passe complète manuelle enregistrée à ce jour`
    : `${daysSinceFullPass}j depuis dernière passe complète (seuil : ${DAYS_BEFORE_FORCED_FULL_PASS}j)`);
  lines.push(`**Raison** : ${reasons.join(" · ")}.`);
  lines.push("");
  lines.push(`**Action** : lancer un AUDIT COMPLET manuel (browser MCP + jugement) sur les cas ci-dessous.`);
  lines.push(`Une fois validé + pushé, exécuter :`);
  lines.push("```bash");
  lines.push("node scripts/_audit-catalog.mjs --mark-full-pass");
  lines.push("```");
  lines.push("pour remettre le compteur à zéro.");
  lines.push("");
}

// Section par verdict problématique
const groupBy = (verdict) => results.filter(r => r.verdict.status === verdict);
for (const v of ["ÉCART", "URL_MORTE", "PAGE_VIDE", "ERREUR"]) {
  const g = groupBy(v);
  if (!g.length) continue;
  lines.push(`### ${v} (${g.length})`);
  for (const { item, verdict } of g) {
    lines.push(`- **[${item.__cat}] ${item.operator ? item.operator + " — " : ""}${item.name}**`);
    lines.push(`  - URL : ${item.url}`);
    if (verdict.expected) lines.push(`  - Prix stocké : CHF ${verdict.expected}`);
    if (verdict.pricesOnPage?.length) lines.push(`  - Prix trouvés : ${verdict.pricesOnPage.join(", ")}`);
    if (verdict.near?.length) lines.push(`  - Prix proches (±15%) : ${verdict.near.join(", ")}`);
    if (verdict.httpStatus) lines.push(`  - HTTP : ${verdict.httpStatus}`);
    if (verdict.error) lines.push(`  - Erreur : \`${verdict.error}\``);
    if (verdict.keywords?.length) lines.push(`  - Mots-clés : ${verdict.keywords.join(", ")}`);
  }
  lines.push("");
}

// Section mots-clés (offres OK mais avec keywords suspects — à re-lire même
// si le prix matche, pour détecter fake urgency ou promo cachée)
const kwOnly = withKeywords.filter(r => r.verdict.status === "OK");
if (kwOnly.length) {
  lines.push(`### Mots-clés suspects sur offres OK (${kwOnly.length})`);
  lines.push(`> Ces offres ont un prix qui matche mais un vocabulaire marketing agressif — à re-vérifier périodiquement pour attraper les fake urgency / promos re-lancées.`);
  lines.push("");
  for (const { item, verdict } of kwOnly) {
    lines.push(`- **[${item.__cat}] ${item.operator || ""} ${item.name}** — mots-clés : ${verdict.keywords.join(", ")}`);
    lines.push(`  - URL : ${item.url}`);
  }
  lines.push("");
}

lines.push("---");
lines.push("");

// === Sauvegarde : append en tête (rolling log, récent en haut) ===
fs.mkdirSync("scripts", { recursive: true });
let prev = "";
if (fs.existsSync(LOG_PATH)) prev = fs.readFileSync(LOG_PATH, "utf8");
// Retire un éventuel bloc du jour existant (idempotence si run 2x le même jour)
prev = prev.replace(new RegExp(`# Daily audit — ${today}[\\s\\S]*?(?=# Daily audit — |$)`), "");
fs.writeFileSync(LOG_PATH, lines.join("\n") + prev);

// === État persistant ===
state.lastRunDate = today;
state.runs = state.runs || [];
state.runs.unshift({
  date: today,
  total: results.length,
  urlsUnique: urlCache.size,
  counts,
  withKeywords: withKeywords.length,
  flagged: flagged.length,
  overdue,
  triggerManual,
});
state.runs = state.runs.slice(0, 30); // 30 derniers runs
saveState(state);

console.log("");
console.log(`✅ Rapport écrit dans ${LOG_PATH}`);
console.log(`   Résumé : ${Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(", ")}`);
console.log(`   Mots-clés suspects : ${withKeywords.length}`);
console.log(triggerManual
  ? `🚨 AUDIT COMPLET requis (${flagged.length} flags${overdue ? `, ${daysSinceFullPass === null ? "aucune passe complète enregistrée" : daysSinceFullPass + "j sans passe complète"}` : ""})`
  : `✅ Pas de trigger manuel — pipeline auto OK`);

// === Helpers state ===
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
  catch { return { runs: [] }; }
}
function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}
