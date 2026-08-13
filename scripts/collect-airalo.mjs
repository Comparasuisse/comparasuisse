// Collecte des forfaits eSIM Airalo — chantier Voyage (cf. VOYAGE-ESIM.md).
//
// Airalo répartit ses forfaits sur des onglets (Standard = volume fixe,
// Unlimited = illimité). Lire la page sans cliquer ne rend que l'onglet actif :
// c'est le même piège que les tableaux repliés de Wingo, et il coûterait ici la
// moitié du catalogue.
//
// Le contexte navigateur est réglé sur fr-CH / Europe/Zurich : Airalo localise
// alors ses prix en CHF, ce qui évite une conversion.
//
//   node scripts/collect-airalo.mjs europe united-kingdom united-states
//   COLLECT_OUT=data/voyage-airalo.json node scripts/collect-airalo.mjs europe

import fs from "fs";
import { chromium } from "playwright-core";

const slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!slugs.length) {
  console.error("usage: node scripts/collect-airalo.mjs <slug> [slug…]  (ex. europe united-kingdom)");
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
  viewport: { width: 1400, height: 1400 },
  extraHTTPHeaders: { "accept-language": "fr-CH,fr;q=0.9,en;q=0.5" },
});

// Une ligne de forfait ressemble à « 3 days | Unlimited | GB | 10.00 | CHF ».
function parseRow(txt) {
  const t = txt.replace(/\s+/g, " ").trim();
  const jours = t.match(/(\d+)\s*(?:days?|jours?)/i);
  // Le montant et le code devise sont deux nœuds distincts : aplatis, ils
  // arrivent séparés par le « | » que l'on a substitué aux retours à la ligne.
  const prix = t.match(/(\d+(?:[.,]\d{2}))\s*\|?\s*([A-Z]{3})/);
  if (!jours || !prix) return null;
  const illimite = /unlimited|illimit/i.test(t);
  const volume = t.match(/(\d+(?:[.,]\d+)?)\s*\|?\s*(GB|Go|MB|Mo)\b/i);
  const days = parseInt(jours[1], 10);
  return {
    days,
    dataGB: illimite ? "Infinity" : volume ? parseFloat(volume[1].replace(",", ".")) : null,
    unlimited: illimite,
    price: parseFloat(prix[1].replace(",", ".")),
    currency: prix[2],
    // Périmètre du chantier : le voyage ponctuel, pas l'abonnement déguisé.
    // Seuil fixé à 31 jours plutôt qu'aux 28 de « quatre semaines » : le
    // forfait 30 jours est la durée de référence de toute la profession, il
    // s'achète sans engagement et couvre le séjour d'un mois. L'écarter aurait
    // retiré six des vingt forfaits Airalo Europe pour une lecture littérale du
    // calendrier. Restent dehors les 90 et 180 jours, et les formules à 12 mois
    // d'Ubigi, qui sont autre chose qu'un voyage.
    horsPerimetre: days > 31,
    brut: t.slice(0, 90),
  };
}

const resultats = [];

for (const slug of slugs) {
  const url = `https://www.airalo.com/${slug}-esim`;
  const page = await ctx.newPage();
  const rec = { provider: "Airalo", slug, url, plans: [], meta: {} };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);

    // Couverture annoncée : « 41 Countries and Networks ».
    rec.meta.couverture = await page.evaluate(() => {
      const m = (document.body.innerText || "").match(/(\d+)\s+Countries?\s+and\s+Networks?/i);
      return m ? parseInt(m[1], 10) : null;
    });

    // Onglets : on passe sur chacun et on cumule, en dédupliquant à la fin.
    const onglets = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
        .filter((t) => /^(Standard|Unlimited|Illimité)$/i.test(t))
    );
    rec.meta.onglets = [...new Set(onglets)];

    // Lecture par bouton de forfait, pas par ligne : l'onglet Standard groupe
    // plusieurs volumes sous une même durée, si bien qu'un découpage par ligne
    // n'en retiendrait qu'un par groupe. La durée se lit en remontant jusqu'à
    // l'ancêtre qui la porte.
    const lire = async () =>
      page.evaluate(() => {
        const btns = [...document.querySelectorAll('[data-testid="package-grouped-packages_package-button"]')];
        return btns.map((b) => {
          const val = b.querySelector('[data-testid="card-package_spec-value"]');
          const unit = b.querySelector('[data-testid="card-package_spec-unit"]');
          const amount = b.querySelector('[data-testid="price_amount"]');
          const code = b.querySelector('[data-testid="price_code"]');
          let jours = null;
          for (let e = b.parentElement, i = 0; e && i < 5; e = e.parentElement, i++) {
            const m = (e.innerText || "").match(/(\d+)\s*(?:days?|jours?)/i);
            if (m) { jours = m[1]; break; }
          }
          return [
            jours ? jours + " days" : "",
            (val && val.textContent) || "",
            (unit && unit.textContent) || "",
            (amount && amount.textContent) || "",
            (code && code.textContent) || "",
          ].join(" | ");
        });
      });

    const vues = new Set();
    const pousser = (lignes, onglet) => {
      for (const l of lignes) {
        const p = parseRow(l);
        if (!p) continue;
        const cle = `${p.days}|${p.dataGB}|${p.price}`;
        if (vues.has(cle)) continue;
        vues.add(cle);
        rec.plans.push({ ...p, onglet });
      }
    };

    pousser(await lire(), "(défaut)");
    for (const nom of rec.meta.onglets) {
      // Clic via le DOM : page.click() exige que l'élément soit « actionnable »
      // au sens Playwright et part en timeout sur ces onglets, alors qu'un
      // click() direct passe sans difficulté.
      const etat = await page.evaluate((n) => {
        const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === n);
        if (!b) return "introuvable";
        b.click();
        return "cliqué";
      }, nom);
      rec.meta[`onglet_${nom}`] = etat;
      if (etat !== "cliqué") continue;
      await page.waitForTimeout(2800);
      pousser(await lire(), nom);
    }
  } catch (e) {
    rec.err = e.message.slice(0, 140);
  }
  await page.close().catch(() => {});
  resultats.push(rec);

  console.log("──────────────────────────────────────────");
  console.log(`${slug}  —  ${rec.err ? "ERREUR " + rec.err : rec.plans.length + " forfait(s)"}`);
  if (rec.meta.couverture) console.log(`  couverture annoncée : ${rec.meta.couverture} pays`);
  rec.plans
    .sort((a, b) => a.price - b.price)
    .forEach((p) =>
      console.log(
        `  ${String(p.price).padStart(7)} ${p.currency}  ${String(p.days).padStart(3)} j  ${
          p.unlimited ? "illimité" : p.dataGB + " Go"
        }   [${p.onglet}]`
      )
    );
}

if (process.env.COLLECT_OUT) {
  fs.writeFileSync(process.env.COLLECT_OUT, JSON.stringify(resultats, null, 1));
  console.log(`\nÉcrit : ${process.env.COLLECT_OUT}`);
}
await browser.close();
