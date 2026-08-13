// Collecte des forfaits eSIM Ubigi — chantier Voyage (cf. VOYAGE-ESIM.md).
//
// Bonne surprise : contrairement aux cinq autres fournisseurs, Ubigi n'oblige
// pas à lire des prix dans du texte. Chaque ligne de sa grille est un
// <div class="plan row"> porteur de tout le forfait en attributs data-* :
//
//   data-label="EUROPE" data-type="one-off" data-allowance="0.5"
//   data-validity="2" data-price="2" data-countrylist="DNK,CHE,IRL,…"
//
// On lit donc la source de vérité du composant, pas son rendu. En prime,
// data-countrylist donne la couverture réelle en ISO-3 — de quoi alimenter la
// recherche par destination sans déduire quoi que ce soit du mot « Europe ».
//
// Piège corrigé après coup : les URL par destination annoncées dans la
// documentation (`/rates-and-coverage/uk-data-plans/`) ne servent pas de page
// de destination. Elles redirigent — vers la grille générale filtrée pour les
// régions, vers une fiche produit unique pour les pays (`turkey-data-plans/`
// atterrit sur « turkey-3gb-30-days »), voire vers un 404 (`usa`). Les
// interroger l'une après l'autre donnait des lots incohérents : la page « uk »
// renvoyait les zones européennes, la page « world » l'Afrique. La seule
// source fiable est la grille complète, qui porte les 1100+ lignes de tout le
// catalogue dans le DOM ; on la charge une fois et on filtre sur data-label.
//
// Trois encodages à connaître :
//   - `data-type="monthly"` est un abonnement reconductible, `"annual"` une
//     formule à 12 mois. Ni l'un ni l'autre n'est un forfait de voyage : seul
//     `one-off` est retenu. Les mensuels se repèrent aussi à leur validité
//     sentinelle de 1000 jours ;
//   - l'illimité s'encode par une allowance de 1000 ou 1001 Go — c'est le
//     texte de la ligne qui tranche, pas l'attribut ;
//   - la devise est celle du sélecteur WooCommerce (EUR/USD/GBP/JPY/CNY/AUD/
//     CAD, jamais CHF). On force ?wmc-currency=USD pour que data-price soit
//     stable d'une exécution à l'autre.
//
//   node scripts/collect-ubigi.mjs EUROPE UK USA CANADA TURKEY WORLD
//   COLLECT_OUT=data/voyage-ubigi.json node scripts/collect-ubigi.mjs EUROPE

import fs from "fs";
import { chromium } from "playwright-core";

const cibles = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((s) => s.toUpperCase());
if (!cibles.length) {
  console.error("usage: node scripts/collect-ubigi.mjs <DESTINATION> [DESTINATION…]  (ex. EUROPE UK USA)");
  process.exit(2);
}

const GRILLE = "https://cellulardata.ubigi.com/data-plans-and-coverage/ubigi-esim-data-plans/?wmc-currency=USD";
const MAX_JOURS = 31; // au-delà, on quitte le voyage pour l'abonnement

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  locale: "fr-CH",
  timezoneId: "Europe/Zurich",
  viewport: { width: 1400, height: 1600 },
  extraHTTPHeaders: { "accept-language": "fr-CH,fr;q=0.9,en;q=0.5" },
});

const page = await ctx.newPage();
await page.goto(GRILLE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector(".plan.row", { timeout: 45000 });
await page.waitForTimeout(5000);

const devise = await page.evaluate(() => {
  const t = document.body.innerText || "";
  return /US\$/.test(t) ? "USD" : (t.match(/\b(EUR|GBP|CHF)\b/) || [])[1] || "?";
});

const brut = await page.evaluate(() =>
  [...document.querySelectorAll(".plan.row")].map((e) => ({
    label: e.dataset.label || "",
    type: e.dataset.type || "",
    plantype: e.dataset.plantype || "",
    allowance: e.dataset.allowance,
    validity: e.dataset.validity,
    price: e.dataset.price,
    pays: (e.dataset.countrylist || "").split(",").filter(Boolean),
    bestseller: e.dataset.bestseller === "1",
    texte: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200),
    href: (e.querySelector("a") || {}).href || null,
  }))
);
console.log(`Grille chargée : ${brut.length} lignes, ${new Set(brut.map((r) => r.label)).size} destinations  [${devise}]`);

const resultats = [];

for (const cible of cibles) {
  const lignes = brut.filter((r) => r.label === cible);
  const rec = {
    provider: "Ubigi",
    slug: cible,
    url: GRILLE.replace(/\?.*$/, ""),
    plans: [],
    meta: { devise, lignesLues: lignes.length },
  };
  if (!lignes.length) rec.err = "destination absente de la grille";

  const vus = new Set();
  for (const r of lignes) {
    const illimite = /unlimited/i.test(r.texte);
    const days = parseInt(r.validity, 10);
    const price = parseFloat(r.price);
    if (!Number.isFinite(price) || !Number.isFinite(days)) continue;
    const dataGB = illimite ? "Infinity" : parseFloat(r.allowance);
    const cle = `${dataGB}|${days}|${price}|${r.type}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    rec.plans.push({
      destination: r.label,
      type: r.type,
      days,
      dataGB,
      unlimited: illimite,
      price,
      currency: devise,
      countries: r.pays,
      countryCount: r.pays.length,
      bestseller: r.bestseller,
      url: r.href ? r.href.replace(/\?.*$/, "") : rec.url,
      horsPerimetre: r.type !== "one-off" || days > MAX_JOURS,
    });
    if (rec.meta.couverture == null && r.pays.length) rec.meta.couverture = r.pays.length;
  }
  resultats.push(rec);

  const retenus = rec.plans.filter((p) => !p.horsPerimetre);
  console.log("──────────────────────────────────────────");
  console.log(
    `${cible}  —  ${rec.err ? "ERREUR " + rec.err : retenus.length + " retenu(s) / " + rec.plans.length + " lu(s)"}  (${rec.meta.couverture || "?"} pays)`
  );
  rec.plans
    .slice()
    .sort((a, b) => a.price - b.price)
    .forEach((p) =>
      console.log(
        `  ${String(p.price).padStart(6)} ${p.currency}  ${String(p.days).padStart(4)} j  ${(p.unlimited ? "illimité" : p.dataGB + " Go").padEnd(10)}  ${p.type}${
          p.horsPerimetre ? "   ⟵ hors périmètre" : ""
        }`
      )
    );
}

if (process.env.COLLECT_OUT) {
  fs.writeFileSync(process.env.COLLECT_OUT, JSON.stringify(resultats, null, 1));
  console.log(`\nÉcrit : ${process.env.COLLECT_OUT}`);
}
await browser.close();
