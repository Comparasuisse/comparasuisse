// Vérification en lot : charge chaque URL dans un vrai Chrome, extrait les prix
// rendus et les confronte au prix stocké. Sortie d'une ligne par offre.
//
//   node scripts/verify-batch.mjs --host yallo.ch
//   node scripts/verify-batch.mjs --stale 8        # offres de 8 jours et plus
//   node scripts/verify-batch.mjs --names "Mtel"   # filtre sur le nom
//   node scripts/verify-batch.mjs --host salt.ch --apply   # pose verifiedAt si OK
//
// Verdicts :
//   OK      le prix stocké figure parmi les prix rendus
//   ÉCART   des prix sont rendus mais pas le nôtre → à examiner à la main
//   VIDE    aucun prix extractible (SPA, image, page gated)
//   ERR     réseau / timeout / HTTP >= 400
//
// Règle 9 : VIDE et ERR ne valent PAS vérification. Seul OK autorise --apply.

import fs from "fs";
import { chromium } from "playwright-core";
import { loadData } from "./lib/audit-lib.mjs";
import { extractPrices } from "./lib/audit-lib.mjs";

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const HOST = arg("host");
const STALE = parseInt(arg("stale") || "0", 10);
const NAMES = arg("names");
const APPLY = process.argv.includes("--apply");
// Une passe AUDIT COMPLET doit repasser sur TOUTES les offres, y compris celles
// déjà datées du jour par un scan antérieur : « vérifiée ce matin » ne vaut pas
// « vérifiée pendant cette passe ». Sans --all, le filtre d âge les escamote.
const ALL = process.argv.includes("--all");
// Les entrées promoData portent elles aussi un prix et une url : les exclure
// laissait 41 lignes du rapport de couverture éternellement en « JAMAIS ».
const WITH_PROMO = process.argv.includes("--with-promo");

function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const TODAY = todayLocalISO();
const age = (v) => (!v ? Infinity : Math.round((new Date(TODAY) - new Date(v)) / 86400000));

const data = await loadData();
let offers = [];
for (const [cat, arr] of Object.entries(data)) {
  if (cat === "promo" && !WITH_PROMO) continue;
  for (const it of arr) if (it.url) offers.push({ cat, name: String(it.name), price: it.price, url: it.url, verifiedAt: it.verifiedAt });
}
if (!ALL) offers = offers.filter((o) => age(o.verifiedAt) > 0);
if (HOST) offers = offers.filter((o) => o.url.includes(HOST));
if (STALE) offers = offers.filter((o) => age(o.verifiedAt) >= STALE);
if (NAMES) offers = offers.filter((o) => o.name.includes(NAMES));

const byUrl = new Map();
for (const o of offers) {
  if (!byUrl.has(o.url)) byUrl.set(o.url, []);
  byUrl.get(o.url).push(o);
}
console.log(`${offers.length} offre(s) sur ${byUrl.size} URL(s)\n`);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
// accept-language explicite : sans lui, certains sites servent une variante
// régionale au contenu tarifaire différent (Talk Talk prepaid rendait une
// grille 10/15/20/25/30 au lieu de la grille suisse 19.95/44.95/79.95/149.95).
const ctx = await browser.newContext({
  userAgent: UA,
  locale: "fr-CH",
  timezoneId: "Europe/Zurich",
  extraHTTPHeaders: { "accept-language": "fr-CH,fr;q=0.9,en;q=0.5" },
});

const okEntries = [];
const stats = { OK: 0, "ÉCART": 0, VIDE: 0, ERR: 0 };

for (const [url, group] of byUrl) {
  let prices = [];
  let err = null;
  const page = await ctx.newPage();
  try {
    const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (r && r.status() >= 400) err = `HTTP ${r.status()}`;
    else {
      await page
        .evaluate(() => {
          document
            .querySelectorAll('[class*="cookie"],[class*="consent"],[id*="onetrust"],[id*="usercentrics"],[role="dialog"]')
            .forEach((e) => (e.style.display = "none"));
        })
        .catch(() => {});
      // Sans attendre networkidle, les pages qui peuplent leurs tarifs en JS après
      // le premier rendu sortaient en faux ÉCART : les 4 prepaid Talk Talk
      // (19.95/44.95/79.95/149.95) sont bien affichés, mais après ce délai.
      await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
      await page.waitForTimeout(2600);
      const txt = await page.evaluate(() => document.body.innerText || "");
      prices = extractPrices(txt);
    }
  } catch (e) {
    err = e.message.slice(0, 40);
  }
  await page.close().catch(() => {});

  for (const o of group) {
    const p = typeof o.price === "number" ? o.price.toFixed(2) : null;
    let verdict;
    if (err) verdict = "ERR";
    else if (!prices.length) verdict = "VIDE";
    else if (p === null) verdict = "OK"; // price:null volontaire (remise décrite)
    else verdict = prices.includes(p) ? "OK" : "ÉCART";
    stats[verdict]++;
    if (verdict === "OK") okEntries.push({ name: o.name, url: o.url, cat: o.cat });
    const detail =
      verdict === "OK" ? "" : verdict === "ERR" ? `  ${err}` : `  stocké ${p} · rendus ${prices.slice(0, 7).join(", ") || "(aucun)"}`;
    console.log(`  ${verdict.padEnd(6)} [${o.cat}] ${o.name.slice(0, 40).padEnd(41)} ${age(o.verifiedAt) === Infinity ? "∞" : age(o.verifiedAt) + "j"}${detail}`);
  }
}
await browser.close();

console.log(`\n${Object.entries(stats).map(([k, v]) => `${k}=${v}`).join("  ")}`);

if (APPLY && okEntries.length) {
  const F = "C:/Users/cicer/Documents/comparasuisse/index.html";
  const L = fs.readFileSync(F, "utf8").split("\n");
  let n = 0;
  // Ancrage name + url : « Swype Surf » et « Teleboy TV » existent dans deux
  // catégories. Chercher par le seul nom mettait à jour deux fois la première
  // entrée et laissait l'homonyme silencieusement non vérifié (11.08.2026).
  const used = new Set();
  for (const { name: nm, url: u, cat } of okEntries) {
    // Une entrée promoData peut partager nom ET url avec une offre (« Teleboy TV »
    // existe dans tvData et dans promoData). Sans ce garde-fou, --apply datait la
    // promo à la place de l offre, et le contrôle de clés dupliquées sortait rouge
    // (12.08.2026). Le champ category n existe que sur promoData : on s en sert
    // pour viser le bon bloc, dans un sens comme dans l autre depuis --with-promo.
    const estPromo = (l) => /category:"/.test(l);
    const bonBloc = cat === "promo" ? estPromo : (l) => !estPromo(l);
    let i = L.findIndex((l, k) => !used.has(k) && bonBloc(l) && l.includes(`name:"${nm}"`) && l.includes(`url:"${u}"`));
    if (i < 0) i = L.findIndex((l, k) => !used.has(k) && bonBloc(l) && l.includes(`name:"${nm}"`));
    if (i < 0) continue;
    used.add(i);
    L[i] = /verifiedAt:/.test(L[i])
      ? L[i].replace(/verifiedAt:"[^"]*"/, `verifiedAt:"${TODAY}"`)
      : L[i].replace(/\burl:/, `sourceType:"product-page", verifiedAt:"${TODAY}", url:`);
    n++;
  }
  fs.writeFileSync(F, L.join("\n"));
  console.log(`\n--apply : ${n} verifiedAt posés au ${TODAY} (verdicts OK uniquement)`);
}
