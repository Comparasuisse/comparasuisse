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
function extractPrices(text) {
  const out = new Set();
  let m;
  while ((m = PRICE_RE.exec(text)) !== null) {
    const raw = (m[1] || m[2]).replace(",", ".");
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= 1 && n < 1000) out.add(n.toFixed(2));
  }
  return [...out].sort((a, b) => parseFloat(a) - parseFloat(b));
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
const N = parseInt(process.argv[2]) || 10;
const CATEGORY = process.argv[3] || null; // "mobile" | "internet" | "tv" | "combo" | "promo"

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
