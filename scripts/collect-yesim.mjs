// Collecte des forfaits eSIM Yesim — chantier Voyage (cf. VOYAGE-ESIM.md).
//
// Yesim sépare ses forfaits en deux onglets, « Unlimited plans » et « Prepaid
// plans ». Le second n'est pas rendu tant qu'on ne l'a pas cliqué.
//
// Format d'une ligne :
//     ∞ GB • 15 days / €2.20 / day / €33.00 / €45.00 / -27%
// soit volume, durée, prix par jour, prix total, prix barré et remise.
// C'est le prix TOTAL qui nous intéresse : le « par jour » est un argument de
// présentation, pas ce que le voyageur paie.
//
// Yesim affiche en EUR et non en CHF, contrairement à Airalo, Saily et Nomad.
// La devise est enregistrée telle quelle : convertir à la collecte figerait un
// taux dans les données. La conversion est affaire de modélisation.
//
//   node scripts/collect-yesim.mjs regions/europe country/united-kingdom
//   COLLECT_OUT=data/voyage-yesim.json node scripts/collect-yesim.mjs regions/europe

import fs from "fs";
import { chromium } from "playwright-core";

const slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!slugs.length) {
  console.error("usage: node scripts/collect-yesim.mjs <chemin> [chemin…]  (ex. regions/europe)");
  process.exit(2);
}

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
  const url = `https://yesim.app/${slug}/`;
  const page = await ctx.newPage();
  const rec = { provider: "Yesim", slug, url, plans: [], meta: {} };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page
      .evaluate(() =>
        document.querySelectorAll('[class*="cookie"],[class*="consent"],[id*="onetrust"]').forEach((e) => e.remove())
      )
      .catch(() => {});
    await page.waitForTimeout(4500);

    const lireTexte = () => page.evaluate(() => document.body.innerText || "");
    let txt = await lireTexte();

    const cov = txt.match(/View\s+(\d+)\s+countr/i);
    rec.meta.couverture = cov ? parseInt(cov[1], 10) : null;
    rec.meta.devise = /€,\s*EUR/.test(txt) ? "EUR" : (txt.match(/\b(CHF|USD|EUR)\b/) || [])[1] || "?";

    const vus = new Set();
    const extraire = (t, onglet) => {
      // « ∞ GB • 15 days », « 5 GB • 30 days » ou « 500 MB • 1 day », suivi du
      // prix unitaire puis du total. L'unité de référence change d'un onglet à
      // l'autre — « / day » pour les illimités, « / GB » pour les prépayés —
      // et le volume peut être en Mo : les trois cas doivent être admis, sinon
      // un onglet entier ressort vide.
      const re =
        /(∞|\d+(?:[.,]\d+)?)\s*(GB|MB)\s*[•·]\s*(\d+)\s*days?\s*\n+\s*€\s*[\d.,]+\s*\/\s*(?:day|GB)\s*\n+\s*€\s*([\d.,]+)(?:\s*\n+\s*€\s*([\d.,]+))?/gi;
      let m;
      while ((m = re.exec(t)) !== null) {
        const illimite = m[1] === "∞";
        const days = parseInt(m[3], 10);
        const price = num(m[4]);
        const cle = `${m[1]}${m[2]}|${days}|${price}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        rec.plans.push({
          days,
          // Conversion Mo → Go en base 1000, la convention des opérateurs :
          // 500 Mo se lit 0.5 Go sur une fiche tarifaire, pas 0.488.
          dataGB: illimite ? "Infinity" : /MB/i.test(m[2]) ? num(m[1]) / 1000 : num(m[1]),
          unlimited: illimite,
          price,
          beforePrice: m[5] ? num(m[5]) : null,
          currency: "EUR",
          onglet,
          horsPerimetre: days > 31,
        });
      }
    };

    extraire(txt, "(défaut)");

    for (const nom of ["Prepaid plans", "Unlimited plans"]) {
      const etat = await page.evaluate((n) => {
        const candidats = [...document.querySelectorAll("button,a,div,span,li")].filter(
          (e) => (e.textContent || "").trim() === n && e.offsetParent !== null
        );
        // Le premier élément trouvé est le conteneur du groupe, inerte au clic ;
        // c est le dernier, la puce elle-meme, qui bascule l onglet.
        const cible = candidats[candidats.length - 1];
        if (!cible) return "introuvable";
        (cible.closest("button,a,li") || cible).click();
        return "cliqué";
      }, nom);
      rec.meta[`onglet_${nom}`] = etat;
      if (etat !== "cliqué") continue;
      await page.waitForTimeout(2600);
      extraire(await lireTexte(), nom);
    }
  } catch (e) {
    rec.err = e.message.slice(0, 140);
  }
  await page.close().catch(() => {});
  resultats.push(rec);

  console.log("──────────────────────────────────────────");
  console.log(`${slug}  —  ${rec.err ? "ERREUR " + rec.err : rec.plans.length + " forfait(s)"}  [${rec.meta.devise || "?"}]`);
  if (rec.meta.couverture) console.log(`  couverture annoncée : ${rec.meta.couverture} pays`);
  rec.plans
    .sort((a, b) => a.price - b.price)
    .forEach((p) =>
      console.log(
        `  ${String(p.price).padStart(7)} EUR  ${String(p.days).padStart(3)} j  ${
          p.unlimited ? "illimité" : p.dataGB + " Go"
        }${p.beforePrice ? "  (avant " + p.beforePrice + ")" : ""}${p.horsPerimetre ? "   ⟵ hors périmètre" : ""}`
      )
    );
}

if (process.env.COLLECT_OUT) {
  fs.writeFileSync(process.env.COLLECT_OUT, JSON.stringify(resultats, null, 1));
  console.log(`\nÉcrit : ${process.env.COLLECT_OUT}`);
}
await browser.close();
