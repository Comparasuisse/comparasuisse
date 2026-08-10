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

function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const TODAY = todayLocalISO();
const age = (v) => (!v ? Infinity : Math.round((new Date(TODAY) - new Date(v)) / 86400000));

const data = await loadData();
let offers = [];
for (const [cat, arr] of Object.entries(data)) {
  if (cat === "promo") continue;
  for (const it of arr) if (it.url) offers.push({ cat, name: String(it.name), price: it.price, url: it.url, verifiedAt: it.verifiedAt });
}
offers = offers.filter((o) => age(o.verifiedAt) > 0);
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
const ctx = await browser.newContext({ userAgent: UA, locale: "fr-CH", timezoneId: "Europe/Zurich" });

const okNames = [];
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
    if (verdict === "OK") okNames.push(o.name);
    const detail =
      verdict === "OK" ? "" : verdict === "ERR" ? `  ${err}` : `  stocké ${p} · rendus ${prices.slice(0, 7).join(", ") || "(aucun)"}`;
    console.log(`  ${verdict.padEnd(6)} [${o.cat}] ${o.name.slice(0, 40).padEnd(41)} ${age(o.verifiedAt) === Infinity ? "∞" : age(o.verifiedAt) + "j"}${detail}`);
  }
}
await browser.close();

console.log(`\n${Object.entries(stats).map(([k, v]) => `${k}=${v}`).join("  ")}`);

if (APPLY && okNames.length) {
  const F = "C:/Users/cicer/Documents/comparasuisse/index.html";
  const L = fs.readFileSync(F, "utf8").split("\n");
  let n = 0;
  for (const nm of okNames) {
    const i = L.findIndex((l) => l.includes(`name:"${nm}"`));
    if (i < 0) continue;
    L[i] = /verifiedAt:/.test(L[i])
      ? L[i].replace(/verifiedAt:"[^"]*"/, `verifiedAt:"${TODAY}"`)
      : L[i].replace(/\burl:/, `sourceType:"product-page", verifiedAt:"${TODAY}", url:`);
    n++;
  }
  fs.writeFileSync(F, L.join("\n"));
  console.log(`\n--apply : ${n} verifiedAt posés au ${TODAY} (verdicts OK uniquement)`);
}
