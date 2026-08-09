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
const LOCK_PATH = "scripts/daily-audit.lock";

// === Watchdog global processus ===
// Dernier rempart : quoi qu'il arrive dans Playwright/Chrome/réseau, le
// processus DOIT se terminer avant cette borne. Un run normal dure 5-10 min
// (~180 URLs × 1-2s hit-cache + ~50 URLs × 5-15s cold-load). 30 min = 3× le
// pire cas raisonnable. Cf. incident 07.08.2026 : yallo Home Max Fiber a
// bloqué le script 25h à cause d'une coupure réseau, sans que le
// Promise.race interne ne libère le processus (le hard timeout logiciel
// a bien fired mais le browser.close() final a hangé indéfiniment).
const MAX_TOTAL_RUN_TIME_MS = 30 * 60 * 1000;
// Seuil de failures consécutives (TIMEOUT/ERREUR/PAGE_VIDE) après lequel
// on recycle le browser+context — évite qu'un contexte saturé/dégradé
// pollue les URLs suivantes.
const RECYCLE_BROWSER_AFTER_N_CONSECUTIVE_FAILURES = 3;

// Nombre de jours max entre 2 passes complètes AVANT que le trigger « manuel »
// soit forcé, même sans flag. Cf. AUDIT-COMPLET.md.
// Seuil à 1j + comparateur `>=` → trigger dès le lendemain d'une passe complète
// (audit exhaustif quotidien souhaité par le mainteneur).
const DAYS_BEFORE_FORCED_FULL_PASS = 1;
// Nombre maximum de runs (bloc `# Daily audit — YYYY-MM-DD`) conservés dans
// le fichier de log rolling. Les runs plus vieux sont supprimés au run suivant
// pour éviter que le fichier explose en taille en cas d'audits multi-quotidiens
// (déclenchés à la main pour debug par exemple).
const MAX_RUNS_KEPT_IN_LOG = 7;

// === Lock file ===
// Un run précédent qui traîne (hang Playwright, PC en veille pendant un run,
// etc.) ne doit pas se voir marcher dessus par un nouveau run. Cf. incident
// 03.08.2026 : plusieurs runs empilés sur le même daily-audit-log.md car les
// runs précédents hanguaient jusqu'à 82 min sans jamais terminer.
function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) {
    let staleLock = false;
    try {
      const raw = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
      // PID vivant ? Sous Windows, process.kill(pid, 0) renvoie true si le
      // process existe, throw sinon.
      try { process.kill(raw.pid, 0); }
      catch { staleLock = true; }
      // Sécurité : un lock de plus de 90 min est forcément mort (ExecutionTimeLimit
      // Task Scheduler = 1h, donc au-delà on est en zombie).
      if (!staleLock && raw.startedAt) {
        const ageMs = Date.now() - new Date(raw.startedAt).getTime();
        if (ageMs > 90 * 60 * 1000) staleLock = true;
      }
      if (!staleLock) {
        console.error(`⛔ Un run est déjà en cours (PID ${raw.pid} depuis ${raw.startedAt}). Exit.`);
        process.exit(75); // EX_TEMPFAIL — Task Scheduler retry-friendly
      }
      console.warn(`⚠ Lock obsolète détecté (PID ${raw.pid}), nettoyage.`);
    } catch {
      // Lock corrompu → on écrase.
    }
    try { fs.unlinkSync(LOCK_PATH); } catch {}
  }
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
}
function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch {}
}
process.on("exit", releaseLock);
process.on("SIGINT", () => { releaseLock(); process.exit(130); });
process.on("SIGTERM", () => { releaseLock(); process.exit(143); });

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
  // Date LOCALE, pas UTC. toISOString() renvoyait la veille entre minuit et
  // 02:00 heure suisse (constaté le 10.08.2026 à 00:47 : UTC disait encore
  // 08-09), alors que le run du jour, lui, se date via todayLocalISO(). Les
  // deux valeurs divergeaient d'un jour dans le state, ce qui redéclenchait
  // le trigger « overdue » 24 h trop tôt.
  const today = todayLocalISO();
  state.lastFullPassDate = today;
  saveState(state);
  console.log(`✅ Passe complète manuelle enregistrée le ${today}.`);
  process.exit(0);
}

const LIMIT = parseInt(argVal("limit") || "0", 10);
const CATEGORY = argVal("category"); // "mobile" | "internet" | "tv" | "combo" | "promo"
const DRY = flag("dry-run");

// Acquiert le verrou avant tout autre traitement lourd. `--dry-run` peut
// passer sans lock (inventaire seul).
if (!DRY) acquireLock();

// === Watchdog processus ===
// Ce setTimeout tourne indépendamment de la boucle event Node : si tout le
// reste hangue (page.goto qui ne rend jamais la main, browser.close() qui
// bloque sur un contexte saturé, socket TCP mort qui n'est jamais fermé
// côté Chrome), ce timer fait sortir le processus manu militari.
// process.exit(124) = code Unix "command exited due to timeout" — le
// script cron peut le distinguer d'un exit propre (0) ou d'une erreur (1).
if (!DRY) {
  const watchdog = setTimeout(() => {
    console.error(`\n⏰⏰⏰ WATCHDOG : run > ${MAX_TOTAL_RUN_TIME_MS/1000}s, kill forcé du processus.`);
    // Libère le lock file explicitement avant d'exit — process.on('exit') ne
    // s'exécute pas toujours quand le processus est tué violemment.
    try { fs.unlinkSync(LOCK_PATH); } catch {}
    process.exit(124);
  }, MAX_TOTAL_RUN_TIME_MS);
  // .unref() : ne bloque pas la sortie propre du processus quand le script
  // finit normalement avant le timeout (sinon Node attendrait 30 min).
  watchdog.unref();
}

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
// Factorisé pour permettre le recyclage browser+context si trop de failures
// consécutives (contexte Chrome pollué par une SPA malformée ou par un pic
// de saturation mémoire).
async function launchBrowser() {
  const br = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const c = await br.newContext({
    userAgent: UA,
    locale: "fr-CH",
    timezoneId: "Europe/Zurich",
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "accept-language": "fr-CH,fr;q=0.9,en;q=0.5" },
  });
  return { br, c };
}

// Ferme le browser sans jamais hanguer : race entre browser.close() propre
// et un kill SIGKILL du process Chrome sous-jacent au bout de 8s.
// Le vrai risque scénario 07.08 : browser.close() attend qu'un socket TCP
// mort réponde, mais Chrome ne libère jamais la connection → hang infini.
async function hardCloseBrowser(br) {
  if (!br) return;
  const proc = br.process?.();
  try {
    await Promise.race([
      br.close().catch(() => {}),
      new Promise((resolve) => setTimeout(() => {
        console.warn("  ⚠ browser.close() > 8s, kill Chrome subprocess");
        try { proc?.kill("SIGKILL"); } catch {}
        resolve();
      }, 8000)),
    ]);
  } catch {}
  // Garde-fou paranoïaque : même si Promise.race retourne, vérifie que le
  // process est mort. Si non, kill.
  try { if (proc && !proc.killed) proc.kill("SIGKILL"); } catch {}
}

let { br: browser, c: ctx } = await launchBrowser();

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
let consecutiveFailures = 0;
const FAILURE_STATUSES = new Set(["TIMEOUT", "ERREUR", "PAGE_VIDE"]);
for (const item of subset) {
  idx++;
  const t0 = Date.now();
  process.stdout.write(`  [${idx}/${subset.length}] ${item.__cat}/${item.operator || ""}/${item.name} `);
  const snap = await getUrlSnapshot(item.url);
  // Track failure streak & recycle browser si contexte semble bloqué.
  // On ignore les URLs cache-hit (déjà comptées au premier passage) et
  // les whitelist NON_VÉRIFIABLE (pas d'appel Playwright).
  const isFailure = FAILURE_STATUSES.has(snap.status);
  if (isFailure) consecutiveFailures++;
  else if (snap.status !== "NON_VÉRIFIABLE" || snap.text) consecutiveFailures = 0;
  if (consecutiveFailures >= RECYCLE_BROWSER_AFTER_N_CONSECUTIVE_FAILURES) {
    console.log(`\n  ♻ ${consecutiveFailures} failures consécutives → recyclage browser`);
    await hardCloseBrowser(browser);
    urlCache.clear(); // invalidate le cache : le nouveau browser doit tout re-tester
    ({ br: browser, c: ctx } = await launchBrowser());
    consecutiveFailures = 0;
  }
  let verdict;
  if (snap.status === "URL_MORTE" || snap.status === "PAGE_VIDE" || snap.status === "ERREUR" || snap.status === "TIMEOUT") {
    verdict = { ...snap };
  } else if (snap.status === "NON_VÉRIFIABLE" && !snap.text) {
    // Court-circuit whitelist (isNonVerifiableUrl dans audit-lib.mjs) : URL
    // structurellement inextractable. Le stub-item ci-dessus RETOURNE
    // NON_VÉRIFIABLE parce que price=null, mais ce cas-là a text + pricesOnPage
    // (donc snap.text est présent). Le short-circuit whitelist retourne
    // NON_VÉRIFIABLE SANS text (Playwright pas exécuté). Discriminant = text.
    verdict = { status: "NON_VÉRIFIABLE", raison: snap.raison || "URL whitelistée" };
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
  const icon = { OK: "✅", ÉCART: "⚠️", URL_MORTE: "❌", PAGE_VIDE: "📭", TIMEOUT: "⏱", ERREUR: "💥", NON_VÉRIFIABLE: "ℹ️", SKIP_NO_URL: "⏭" }[verdict.status] || "?";
  const kwFlag = keywords.length ? ` [kw:${keywords.length}]` : "";
  console.log(`${icon} ${verdict.status}${kwFlag} (${ms}ms)`);
  results.push({ item, verdict, ms });
}

await hardCloseBrowser(browser);

// === Agrégation par verdict ===
const counts = { OK: 0, ÉCART: 0, URL_MORTE: 0, PAGE_VIDE: 0, TIMEOUT: 0, ERREUR: 0, NON_VÉRIFIABLE: 0 };
for (const r of results) counts[r.verdict.status] = (counts[r.verdict.status] || 0) + 1;
const withKeywords = results.filter(r => r.verdict.keywords?.length > 0);
const flagged = results.filter(r =>
  r.verdict.status === "ÉCART" ||
  r.verdict.status === "URL_MORTE" ||
  r.verdict.status === "PAGE_VIDE" ||
  r.verdict.status === "TIMEOUT" ||
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
const overdue = daysSinceFullPass === null || daysSinceFullPass >= DAYS_BEFORE_FORCED_FULL_PASS;
const triggerManual = flagged.length > 0 || overdue;

// === Rapport markdown ===
const lines = [];
lines.push(`# Daily audit — ${today}`);
lines.push("");
lines.push(`> **Lecture du rapport** : les verdicts sont produits par un scan _automatique_`);
lines.push(`> basé sur une extraction de prix par regex (voir \`scripts/lib/audit-lib.mjs\`).`);
lines.push(`> Ils indiquent des cas **à investiguer manuellement**, pas des vérités.`);
lines.push(`>`);
lines.push(`> - **OK** = le prix stocké apparaît dans le texte visible de la page — présomption`);
lines.push(`>   de validité, pas confirmation absolue (un prix identique par coïncidence sur`);
lines.push(`>   une autre offre au même prix passe aussi OK).`);
lines.push(`> - **ÉCART** = différence de prix détectée automatiquement — **à vérifier manuellement**`);
lines.push(`>   avant toute correction. Peut inclure des faux positifs : SPA qui n'a pas rendu`);
lines.push(`>   les cards, prix d'activation confondu avec prix mensuel, biffé/promo lu à`);
lines.push(`>   l'envers, prix caché derrière une action utilisateur, etc.`);
lines.push(`> - **URL_MORTE** = HTTP 4xx/5xx — attention aux 429 (rate-limit temporaire, URL`);
lines.push(`>   toujours valide) vs 404 (URL réellement à corriger dans \`index.html\`).`);
lines.push(`> - **PAGE_VIDE** = HTTP 200 mais < 100 caractères visibles — protection bot ou`);
lines.push(`>   JS bloqué. À vérifier via browser MCP interactif.`);
lines.push(`> - **TIMEOUT** = dépassement du hard timeout 20 s — la page ne répond pas`);
lines.push(`>   normalement. Cf. AUDIT-COMPLET.md § Garde-fous.`);
lines.push(`> - **NON_VÉRIFIABLE** = pas de \`price\` numérique dans notre data (\`null\`, \`0\`,`);
lines.push(`>   entrée « à partir de… »).`);
lines.push(``);
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
for (const v of ["ÉCART", "URL_MORTE", "PAGE_VIDE", "TIMEOUT", "ERREUR"]) {
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
    if (verdict.hardTimeoutMs) lines.push(`  - Hard timeout : ${verdict.hardTimeoutMs}ms`);
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
// Idempotence : si un bloc du jour existe déjà, on le remplace au lieu de doubler.
// Limite : on ne conserve que les MAX_RUNS_KEPT_IN_LOG derniers blocs — évite
// que le fichier explose (chaque run pèse 30-50 KB, un empilement d'une semaine
// se lit encore d'un coup, au-delà on perd la vue d'ensemble).
fs.mkdirSync("scripts", { recursive: true });
let prev = "";
if (fs.existsSync(LOG_PATH)) prev = fs.readFileSync(LOG_PATH, "utf8");
prev = prev.replace(new RegExp(`# Daily audit — ${today}[\\s\\S]*?(?=# Daily audit — |$)`), "");
// Découpe le prev en blocs et garde les N-1 plus récents (le nouveau bloc
// qu'on ajoute en tête complètera à N).
const prevBlocks = prev.split(/(?=# Daily audit — )/).filter(b => b.trim().length);
const kept = prevBlocks.slice(0, Math.max(0, MAX_RUNS_KEPT_IN_LOG - 1));
fs.writeFileSync(LOG_PATH, lines.join("\n") + kept.join(""));

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
