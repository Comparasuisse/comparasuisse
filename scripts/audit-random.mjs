// Audit périodique d'un échantillon aléatoire d'offres.
// Tire N offres au hasard (seed = date du jour, reproductible dans la journée),
// fetch chaque URL via Playwright, extrait les prix affichés visuellement,
// et compare avec ce qu'on a en base. Génère un rapport markdown pour revue.
//
// PAS D'AUTO-CORRECTION : le script signale les écarts, la décision revient
// à l'utilisateur (règle [[feedback-verify-offers-live]] + [[feedback-show-before-push]]).
//
// Usage :
//   node scripts/audit-random.mjs             # 10 offres au hasard
//   node scripts/audit-random.mjs 20          # 20 offres au hasard
//   node scripts/audit-random.mjs 5 mobile    # 5 offres au hasard, catégorie mobile
//
// Sortie : data/audit-YYYY-MM-DD.md avec 4 sections par offre :
//   - Prix attendu vs prix trouvé sur la page
//   - HTTP status
//   - Extrait de texte visible autour du prix
//   - Verdict : OK / ÉCART / URL_MORTE / NON_VÉRIFIABLE

import { chromium } from "playwright-core";
import { verifyIndexHtmlSyntax } from "./lib/verify-index-syntax.mjs";
import fs from "node:fs";
import path from "node:path";

const CHROME_PATH =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// === Lecture des données depuis index.html ===
// On charge le HTML et on eval les arrays. C'est un pattern éprouvé sur ce site
// puisque scripts/apply-channels.mjs fait déjà ça implicitement.
function loadData() {
  const html = fs.readFileSync("index.html", "utf8");
  const extract = (name) => {
    const re = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`);
    const m = html.match(re);
    if (!m) throw new Error(`Impossible d'extraire ${name}`);
    // eval sécurisé via Function : évalue le tableau JS en isolation.
    // (Le contenu de index.html est trusted — écrit par nous.)
    const arr = new Function(`return [${m[1]}\n];`)();
    return arr;
  };
  return {
    mobile: extract("mobileData"),
    internet: extract("internetData"),
    tv: extract("tvData"),
    combo: extract("comboData"),
    promo: extract("promoData"),
  };
}

// === Seed reproductible dans la journée (Mulberry32) ===
function seedFromDate() {
  const d = new Date();
  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// === Extraction de prix depuis la page visible ===
// Regex tolérante : "CHF 12.95", "12.95 CHF", "12,95 CHF", "CHF 39", "CHF 39.-",
// "39.-/mois", "Fr. 12.90", etc. Les 2 décimales sont OPTIONNELLES.
const PRICE_RE =
  /(?:CHF|Fr\.)\s*(\d{1,3}(?:['.,]\d{2})?)(?:\s*\.?[-–]?)|(\d{1,3}(?:['.,]\d{2})?)\s*(?:CHF|Fr\.|\.[-–]|\.?[-–]\s*\/\s*mois|\/mois)/gi;

// Normalise le texte AVANT extraction pour rejoindre les prix coupés par des
// sauts de ligne. Ex. sur salt.ch/swiss-max le prix est rendu :
//   "23\n.95\n/mois" (chaque token dans un <span>, innerText insère \n).
// Sans cette étape, le regex ci-dessus rate ces prix → faux "ÉCART" dans l'audit.
// Cas couverts :
//   "23\n.95"     → "23.95"
//   "4 . 50"      → "4.50"
//   "12\n,\n95"   → "12,95"  (comma preserved, regex accepte ['.,])
//   "23.-"        → "23.-"   (dash decimals inchangé)
function normalizePriceFragments(text) {
  return text
    // Fusionne "chiffre \s* [.,] \s* deux chiffres" quand le séparateur ou l'un des
    // deux membres est séparé par des whitespace (dont newline).
    .replace(/(\d{1,3})\s+([.,])\s*(\d{2})\b/g, "$1$2$3")
    .replace(/(\d{1,3})([.,])\s+(\d{2})\b/g, "$1$2$3")
    // Fusionne "chiffre \n .- /mois" (rare mais vu chez Wingo)
    .replace(/(\d{1,3})\s*\n\s*\.[-–]/g, "$1.-");
}

function extractPrices(text) {
  const normalized = normalizePriceFragments(text);
  const out = new Set();
  let m;
  while ((m = PRICE_RE.exec(normalized)) !== null) {
    const raw = (m[1] || m[2]).replace(",", ".");
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= 1 && n < 1000) out.add(n.toFixed(2));
  }
  return [...out].sort((a, b) => parseFloat(a) - parseFloat(b));
}

// Tests inline (self-check au démarrage) — signalent tout de suite si un
// changement de regex/normalisation casse un des cas connus.
// Note : ce regex ne capture QUE les prix explicitement marqués (CHF, Fr.,
// "/mois", ".-"). Les prix nus type "au lieu de 73.95" ne sont pas capturés
// délibérément — trop de faux positifs sur des durées, dates, codes postaux.
// Conséquence acceptée : le prix "au lieu de X" peut manquer dans pricesOnPage.
// Ce n'est pas grave pour l'audit puisqu'on cherche à confirmer notre item.price
// principal, pas les catalogues barrés.
const _tests = [
  { in: "CHF 23.95/mois", expect: ["23.95"] },
  { in: "23\n.95\n/mois", expect: ["23.95"] },
  { in: "CHF\n4\n.\n50", expect: ["4.50"] },
  { in: "CHF 39", expect: ["39.00"] },
  { in: "Fr. 12.90/mois", expect: ["12.90"] },
  { in: "CHF 39.-", expect: ["39.00"] },
  { in: "22,90 CHF", expect: ["22.90"] },
];
let _passed = 0, _failed = [];
for (const t of _tests) {
  const got = extractPrices(t.in);
  const missing = t.expect.filter(e => !got.includes(e));
  if (missing.length) _failed.push({ in: t.in.replace(/\n/g, "\\n"), got, missing });
  else _passed++;
}
if (_failed.length) {
  console.error(`⚠️ regex self-check : ${_passed}/${_tests.length} OK, ${_failed.length} FAIL`);
  for (const f of _failed) console.error(`   "${f.in}" → [${f.got.join(",")}] (manque ${f.missing.join(",")})`);
} else if (process.env.DEBUG_REGEX) {
  console.log(`✓ regex self-check : ${_passed}/${_tests.length} tests OK`);
}

// === Vérification d'une offre ===
async function checkOffer(ctx, item, category) {
  if (!item.url) return { status: "SKIP_NO_URL" };
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(item.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const status = resp?.status?.() ?? 0;
    if (status < 200 || status >= 400) {
      await page.close();
      return { status: "URL_MORTE", httpStatus: status };
    }
    await page
      .waitForLoadState("networkidle", { timeout: 12000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    await page.close();

    if (!text || text.length < 100) {
      return { status: "PAGE_VIDE", httpStatus: status };
    }
    const pricesOnPage = extractPrices(text);
    const expected = typeof item.price === "number" ? item.price.toFixed(2) : null;
    if (!expected || item.price === 0) {
      return { status: "NON_VÉRIFIABLE", raison: "prix inclus/à partir de", pricesOnPage };
    }
    const found = pricesOnPage.includes(expected);
    if (found) return { status: "OK", expected, pricesOnPage: pricesOnPage.slice(0, 15) };
    // Écart : cherche une valeur proche (±10%)
    const near = pricesOnPage
      .map(p => ({ p, diff: Math.abs(parseFloat(p) - parseFloat(expected)) }))
      .filter(x => x.diff <= parseFloat(expected) * 0.15)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 3)
      .map(x => x.p);
    return { status: "ÉCART", expected, pricesOnPage: pricesOnPage.slice(0, 15), near };
  } catch (e) {
    try { await page.close(); } catch {}
    return { status: "ERREUR", error: e.message };
  }
}

// === Pipeline principal ===
// Flags optionnels : --history pour ajouter automatiquement des points priceHistory
// dans index.html après un verdict OK confirmé.
const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const APPLY_HISTORY = process.argv.includes("--history");
const N = parseInt(args[0]) || 10;
const CATEGORY = args[1] || null; // "mobile" | "internet" | "tv" | "combo" | "promo"

const DAYS_BEFORE_CONFIRM_POINT = 30; // ne pas polluer priceHistory avec des points inchangés < 30j

const data = loadData();
const pool = [];
for (const cat of ["mobile", "internet", "tv", "combo", "promo"]) {
  if (CATEGORY && cat !== CATEGORY) continue;
  for (const item of data[cat]) pool.push({ ...item, __cat: cat });
}
if (pool.length === 0) {
  console.error(`Aucune offre pour catégorie ${CATEGORY}`);
  process.exit(2);
}

const rng = makeRng(seedFromDate() + N * 7);
const sample = [...pool]
  .map((x, i) => ({ x, k: rng() }))
  .sort((a, b) => a.k - b.k)
  .slice(0, Math.min(N, pool.length))
  .map(o => o.x);

console.log(`▶ Audit random ${sample.length}/${pool.length} offres${CATEGORY ? ` (${CATEGORY})` : ""}`);

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
});
const ctx = await browser.newContext({
  userAgent: UA,
  locale: "fr-CH",
  timezoneId: "Europe/Zurich",
  viewport: { width: 1280, height: 900 },
  extraHTTPHeaders: { "accept-language": "fr-CH,fr;q=0.9,en;q=0.5" },
});

const results = [];
for (const item of sample) {
  const t0 = Date.now();
  process.stdout.write(`  · ${item.__cat}/${item.operator ? item.operator + "/" : ""}${item.name} `);
  const r = await checkOffer(ctx, item, item.__cat);
  const ms = Date.now() - t0;
  const icon = { OK: "✅", ÉCART: "⚠️", URL_MORTE: "❌", ERREUR: "💥", NON_VÉRIFIABLE: "ℹ️", SKIP_NO_URL: "⏭", PAGE_VIDE: "📭" }[r.status] || "?";
  console.log(`${icon} ${r.status} (${ms}ms)`);
  results.push({ item, result: r, ms });
}

await browser.close();

// === Rapport markdown ===
fs.mkdirSync("data", { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const md = [
  `# Audit random — ${today}`,
  "",
  `Généré par \`scripts/audit-random.mjs\`. Échantillon : ${sample.length}/${pool.length} offres${CATEGORY ? ` (catégorie ${CATEGORY})` : ""}.`,
  "",
  `**Verdicts** :`,
];
const counts = {};
for (const r of results) counts[r.result.status] = (counts[r.result.status] || 0) + 1;
for (const [k, v] of Object.entries(counts)) md.push(`- ${k} : ${v}`);
md.push("", "---", "");

for (const { item, result, ms } of results) {
  md.push(`## [${item.__cat}] ${item.operator ? item.operator + " — " : ""}${item.name}`);
  md.push(`- **Verdict** : \`${result.status}\` (${ms}ms)`);
  md.push(`- **URL** : ${item.url || "(aucune)"}`);
  md.push(`- **Prix attendu** : ${typeof item.price === "number" ? "CHF " + item.price.toFixed(2) : "(non chiffré)"}`);
  if (result.pricesOnPage) md.push(`- **Prix trouvés sur la page** : ${result.pricesOnPage.length ? result.pricesOnPage.join(", ") : "(aucun)"}`);
  if (result.near && result.near.length) md.push(`- **Prix proches détectés** : ${result.near.join(", ")}`);
  if (result.httpStatus) md.push(`- **HTTP** : ${result.httpStatus}`);
  if (result.error) md.push(`- **Erreur** : ${result.error}`);
  if (result.raison) md.push(`- **Raison** : ${result.raison}`);
  if (item.verifiedAt) md.push(`- **Dernière vérif enregistrée** : ${item.verifiedAt} (\`${item.sourceType || "?"}\`)`);
  md.push("");
}

md.push("---", "");
md.push("## Interprétation");
md.push("- **OK** : le prix attendu apparaît quelque part sur la page → présomption de validité");
md.push("- **ÉCART** : le prix attendu n'apparaît PAS sur la page (mais d'autres prix oui) → à vérifier manuellement, l'offre a peut-être changé de prix");
md.push("- **URL_MORTE** : HTTP 4xx/5xx → URL cassée à corriger");
md.push("- **PAGE_VIDE** : page chargée mais < 100 caractères visibles → probable protection bot ou JS bloqué");
md.push("- **NON_VÉRIFIABLE** : prix 0 (inclus) ou `null` (rabais combo) → impossible à comparer automatiquement");
md.push("- **ERREUR** : timeout / réseau / autre → réessayer manuellement");

const outPath = `data/audit-${today}.md`;
fs.writeFileSync(outPath, md.join("\n"));
console.log(`\n✅ Rapport écrit dans ${outPath}`);
console.log(`   Résumé : ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);

// === Append automatique dans priceHistory si flag --history ===
// Règle : verdict OK (prix confirmé sur la page) → ajouter un point uniquement
// si dernier point priceHistory > 30 jours (évite le bruit d'audits successifs
// mais garantit une "trace de vie" du suivi dans le graphique sur la durée).
if (APPLY_HISTORY) {
  const daysBetween = (d1, d2) =>
    Math.abs((new Date(d1) - new Date(d2)) / (1000 * 60 * 60 * 24));
  let html = fs.readFileSync("index.html", "utf8");
  let appended = 0, skipped = 0;
  for (const { item, result } of results) {
    if (result.status !== "OK") continue; // seuls les verdicts OK confirment un prix
    if (typeof item.price !== "number") continue;
    const existing = Array.isArray(item.priceHistory) ? item.priceHistory : [];
    const last = existing[existing.length - 1];
    if (last && last.date === today) { skipped++; continue; }
    if (last && daysBetween(last.date, today) < DAYS_BEFORE_CONFIRM_POINT) {
      skipped++;
      continue;
    }
    // Injection : mettre à jour priceHistory de l'entrée dans index.html.
    // Cible via name + operator (comme apply-channels.mjs).
    const nameEsc = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const entryRe = new RegExp(
      `(name:"${nameEsc}"[^}]*?priceHistory:\\[)([^\\]]*)(\\])`,
      ""
    );
    const m = html.match(entryRe);
    if (!m) {
      // Pas encore de priceHistory, on l'ajoute juste après verifiedAt
      const verifRe = new RegExp(
        `(name:"${nameEsc}"[^}]*?verifiedAt:"[^"]+")`,
        ""
      );
      if (verifRe.test(html)) {
        html = html.replace(verifRe, `$1, priceHistory:[{date:"${today}",price:${item.price}}]`);
        appended++;
      }
      continue;
    }
    const newPoint = `,{date:"${today}",price:${item.price}}`;
    html = html.replace(entryRe, `$1$2${newPoint}$3`);
    appended++;
  }
  const bak = ".index.html.audit-random.bak";
  fs.copyFileSync("index.html", bak);
  fs.writeFileSync("index.html", html);
  verifyIndexHtmlSyntax({ backupPath: bak });
  try { fs.unlinkSync(bak); } catch {}
  console.log(`   priceHistory : ${appended} point(s) ajouté(s), ${skipped} skip(s) (< ${DAYS_BEFORE_CONFIRM_POINT}j depuis dernier point)`);
}
