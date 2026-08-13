// Collecte des forfaits eSIM Holafly — chantier Voyage (cf. VOYAGE-ESIM.md).
//
// Holafly ne vend qu'un produit par destination — données illimitées — dont le
// prix dépend du nombre de jours, choisi dans un sélecteur maison allant de 1 à
// une soixantaine de jours. Il n'y a donc pas une grille de forfaits à lire
// mais un prix à relever durée par durée.
//
// Choix assumé : on ne retient pas les 31 durées du périmètre mais les huit
// durées de référence (1, 3, 5, 7, 10, 15, 20, 30 jours). Enregistrer le jour
// 22 à côté du jour 23 remplirait le comparateur de quasi-doublons que personne
// ne compare. Que Holafly vende la journée à la carte reste une singularité :
// elle est signalée dans la description de l'offre, pas dupliquée en trente
// lignes.
//
// Deux pièges du site :
//   - sa bannière de consentement injecte des milliers de caractères ; il faut
//     retirer les nœuds, un display:none ne suffit pas ;
//   - le sélecteur « [class*=cookie] » attrape le <body> lui-même sur ce site.
//     Retirer le body fait disparaître la page entière. On cible précisément.
//
//   node scripts/collect-holafly.mjs esim-europe esim-royaume-uni
//   COLLECT_OUT=data/voyage-holafly.json node scripts/collect-holafly.mjs esim-europe

import fs from "fs";
import { chromium } from "playwright-core";

const slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!slugs.length) {
  console.error("usage: node scripts/collect-holafly.mjs <slug> [slug…]  (ex. esim-europe)");
  process.exit(2);
}

const DUREES = [1, 3, 5, 7, 10, 15, 20, 30];

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

const num = (s) => parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
const resultats = [];

for (const slug of slugs) {
  const url = `https://esim.holafly.com/fr/${slug}/`;
  const page = await ctx.newPage();
  const rec = { provider: "Holafly", slug, url, plans: [], meta: {} };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 50000 });
    await page.waitForTimeout(4000);
    // Ciblage précis : viser large ici retire le <body> et vide la page.
    rec.meta.noeudsRetires = await page.evaluate(() => {
      let n = 0;
      document
        .querySelectorAll("#CybotCookiebotDialog,[id*=Cookiebot],[id*=onetrust],[class*=CookieDeclaration]")
        .forEach((e) => {
          if (e === document.body || e === document.documentElement) return;
          e.remove();
          n++;
        });
      return n;
    });
    await page.waitForTimeout(1200);

    const txt0 = await page.evaluate(() => document.body.innerText || "");
    rec.meta.devise = /CHF/.test(txt0) ? "CHF" : (txt0.match(/\b(EUR|USD)\b/) || [])[1] || "?";
    rec.meta.illimite = /Données illimitées/i.test(txt0);
    // Le partage est proposé mais plafonné : « Partagez 1 Go de données par jour ».
    const partage = txt0.match(/Partagez\s+(\d+)\s*Go\s+de données par jour/i);
    rec.meta.hotspotGoParJour = partage ? parseInt(partage[1], 10) : null;
    // Combien de durées Holafly propose-t-il réellement ?
    rec.meta.dureesDisponibles = await page.evaluate(
      () =>
        [...document.querySelectorAll("button")].filter((e) => !e.children.length && /^\s*\d+\s*$/.test(e.textContent || ""))
          .length
    );

    for (const j of DUREES) {
      const clique = await page.evaluate((n) => {
        const b = [...document.querySelectorAll("button")].find(
          (e) => !e.children.length && e.textContent.trim() === String(n)
        );
        if (!b) return false;
        b.click();
        return true;
      }, j);
      if (!clique) continue;
      await page.waitForTimeout(1800);
      const prix = await page.evaluate(() => {
        const t = document.body.innerText || "";
        // « Total \n 24,50 Fr \n CHF » — on prend le montant qui suit Total.
        const m = t.match(/Total\s*\n+\s*([\d.,]+)\s*Fr/i) || t.match(/([\d.,]+)\s*Fr\s*CHF/i);
        return m ? m[1] : null;
      });
      if (!prix) continue;
      rec.plans.push({
        days: j,
        dataGB: "Infinity",
        unlimited: true,
        price: num(prix),
        currency: rec.meta.devise,
        horsPerimetre: j > 31,
      });
    }
  } catch (e) {
    rec.err = e.message.slice(0, 140);
  }
  await page.close().catch(() => {});
  resultats.push(rec);

  console.log("──────────────────────────────────────────");
  console.log(`${slug}  —  ${rec.err ? "ERREUR " + rec.err : rec.plans.length + " forfait(s)"}  [${rec.meta.devise || "?"}]`);
  if (rec.meta.dureesDisponibles)
    console.log(`  durées vendues par Holafly : ${rec.meta.dureesDisponibles}  (on en retient ${DUREES.length})`);
  if (rec.meta.hotspotGoParJour) console.log(`  partage de connexion : ${rec.meta.hotspotGoParJour} Go/jour`);
  rec.plans.forEach((p) => console.log(`  ${String(p.price).padStart(7)} ${p.currency}  ${String(p.days).padStart(3)} j  illimité`));
}

if (process.env.COLLECT_OUT) {
  fs.writeFileSync(process.env.COLLECT_OUT, JSON.stringify(resultats, null, 1));
  console.log(`\nÉcrit : ${process.env.COLLECT_OUT}`);
}
await browser.close();
