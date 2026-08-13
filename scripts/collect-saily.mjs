// Collecte des forfaits eSIM Saily — chantier Voyage (cf. VOYAGE-ESIM.md).
//
// Saily présente deux choses de nature différente sur la même page :
//   - des forfaits à volume fixe, listés en clair (« 1 Go / 7 jours / 3,99 CHF ») ;
//   - un forfait illimité dont la durée se choisit par puces, le prix étant
//     recalculé à chaque sélection. Lire la page une fois ne rend donc qu'une
//     seule des six durées illimitées.
//
// Le contexte fr-CH fait afficher Saily en CHF (son sélecteur de devise le
// confirme : US$, €, £, CHF).
//
//   node scripts/collect-saily.mjs esim-europe esim-united-kingdom
//   COLLECT_OUT=data/voyage-saily.json node scripts/collect-saily.mjs esim-europe

import fs from "fs";
import { chromium } from "playwright-core";

const slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!slugs.length) {
  console.error("usage: node scripts/collect-saily.mjs <slug> [slug…]  (ex. esim-europe)");
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
  const url = `https://saily.com/${slug}/`;
  const page = await ctx.newPage();
  const rec = { provider: "Saily", slug, url, plans: [], meta: {} };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4500);

    // Saily sert par moments un interstitiel Cloudflare (« Vérification de
    // sécurité en cours ») qui se résout tout seul en quelques secondes. On lui
    // laisse le temps plutôt que de conclure à une page vide.
    for (let i = 0; i < 6; i++) {
      const bloque = await page.evaluate(() =>
        /Vérification de sécurité|Just a moment|Ray ID/i.test(document.body.innerText || "")
      );
      if (!bloque) break;
      rec.meta.attenteCloudflare = (i + 1) * 3;
      await page.waitForTimeout(3000);
    }

    const txt = await page.evaluate(() => document.body.innerText || "");

    // Couverture : « Voir la liste des pays (35) ».
    const cov = txt.match(/liste des pays\s*\((\d+)\)/i) || txt.match(/\((\d+)\)\s*$/m);
    rec.meta.couverture = cov ? parseInt(cov[1], 10) : null;

    // Forfaits à volume fixe : « 1 Go \n 7 jours \n 3,99 CHF ».
    const reFixe = /(\d+(?:[.,]\d+)?)\s*Go\s*\n+\s*(\d+)\s*jours?\s*\n+\s*(\d+(?:[.,]\d+)?)\s*CHF/gi;
    let m;
    // Un même forfait figure souvent deux fois dans le texte — une fois dans la
    // grille, une fois dans le récapitulatif de commande. On dédoublonne sur le
    // triplet volume/durée/prix.
    const vus = new Set();
    while ((m = reFixe.exec(txt)) !== null) {
      const days = parseInt(m[2], 10);
      const cle = `${m[1]}|${days}|${m[3]}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      rec.plans.push({
        days,
        dataGB: num(m[1]),
        unlimited: false,
        price: num(m[3]),
        currency: "CHF",
        horsPerimetre: days > 31,
      });
    }

    // Illimité : la durée se choisit dans un <select> natif dont chaque option
    // porte l'UUID du forfait en valeur ; le prix suit la sélection.
    //
    // Un premier jet cherchait des puces cliquables parmi button/label/li/div/
    // span et n'en trouvait aucune — d'où les six durées illimitées manquantes
    // sur chaque destination. Ce n'étaient pas des puces, et <option> ne
    // figurait pas dans la liste des sélecteurs interrogés.
    const durees = await page.evaluate(() => {
      const sel = [...document.querySelectorAll("select")].find((s) =>
        [...s.options].some((o) => /jours?\s*$/i.test(o.textContent || ""))
      );
      if (!sel) return [];
      return [...sel.options]
        .map((o) => ({ jours: parseInt(o.textContent, 10), valeur: o.value }))
        .filter((x) => Number.isFinite(x.jours));
    });
    rec.meta.dureesIllimite = durees.map((d) => d.jours).sort((a, b) => a - b);

    for (const { jours: d, valeur } of durees) {
      // React n'écoute pas l'affectation de .value : il faut passer par le
      // setter natif puis émettre le change que le composant attend.
      const clique = await page.evaluate((v) => {
        const sel = [...document.querySelectorAll("select")].find((s) =>
          [...s.options].some((o) => /jours?\s*$/i.test(o.textContent || ""))
        );
        if (!sel) return false;
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, v);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, valeur);
      if (!clique) continue;
      await page.waitForTimeout(1600);
      // Le prix de l'illimité est celui affiché dans le bloc récapitulatif,
      // qui reprend « Illimitées » puis la durée choisie puis le montant.
      const prix = await page.evaluate(() => {
        const t = document.body.innerText || "";
        const m = t.match(/Illimit[ée]e?s?\s*\n+\s*(\d+)\s*jours?\s*\n+\s*(\d+(?:[.,]\d+)?)\s*CHF/i);
        return m ? { jours: parseInt(m[1], 10), montant: m[2] } : null;
      });
      if (!prix || prix.jours !== d) continue;
      if (rec.plans.some((p) => p.unlimited && p.days === d)) continue;
      rec.plans.push({
        days: d,
        dataGB: "Infinity",
        unlimited: true,
        price: num(prix.montant),
        currency: "CHF",
        // L'illimité Saily est bridé : la nuance doit suivre l'offre.
        dataNote: "3 Go/jour à pleine vitesse, puis 1 Mb/s",
        horsPerimetre: d > 31,
      });
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
        `  ${String(p.price).padStart(7)} CHF  ${String(p.days).padStart(3)} j  ${
          p.unlimited ? "illimité (bridé)" : p.dataGB + " Go"
        }${p.horsPerimetre ? "   ⟵ hors périmètre" : ""}`
      )
    );
}

if (process.env.COLLECT_OUT) {
  fs.writeFileSync(process.env.COLLECT_OUT, JSON.stringify(resultats, null, 1));
  console.log(`\nÉcrit : ${process.env.COLLECT_OUT}`);
}
await browser.close();
