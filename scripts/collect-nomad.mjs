// Collecte des forfaits eSIM Nomad — chantier Voyage (cf. VOYAGE-ESIM.md).
//
// Nomad liste ses forfaits en clair, sous la forme :
//     Unlimited / For 5 DAYS / CHF15.36
//     20 GB / For 30 DAYS / 29.92 / CHF21.83 / ON SALE
// avec un prix barré facultatif avant le prix courant.
//
// Piège à éviter : la page ouvre sur le « NOMAD PASS », un abonnement à
// reconduction automatique tous les 30 jours. Ce n'est pas un forfait de
// voyage et il n'a rien à faire dans cette catégorie — on l'écarte
// explicitement plutôt que de le laisser passer pour un forfait à 2.43.
//
//   node scripts/collect-nomad.mjs europe united-kingdom
//   COLLECT_OUT=data/voyage-nomad.json node scripts/collect-nomad.mjs europe

import fs from "fs";
import { chromium } from "playwright-core";

const slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!slugs.length) {
  console.error("usage: node scripts/collect-nomad.mjs <slug> [slug…]  (ex. europe)");
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

const resultats = [];

for (const slug of slugs) {
  const url = `https://www.getnomad.app/en/${slug}-eSIM`;
  const page = await ctx.newPage();
  const rec = { provider: "Nomad", slug, url, plans: [], meta: {} };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page
      .evaluate(() =>
        document.querySelectorAll('[class*="cookie"],[class*="consent"],[id*="onetrust"]').forEach((e) => e.remove())
      )
      .catch(() => {});
    await page.waitForTimeout(4500);

    const txt = await page.evaluate(() => document.body.innerText || "");

    const cov = txt.match(/(\d+)\s+(?:countries|destinations)/i);
    rec.meta.couverture = cov ? parseInt(cov[1], 10) : null;

    // data | For N DAYS | [prix barré] | CHF prix
    const re =
      /(Unlimited|\d+(?:[.,]\d+)?\s*GB)\s*\n+\s*For\s+(\d+)\s+DAYS?\s*\n+\s*(?:([\d.,]+)\s*\n+\s*)?CHF\s*([\d.,]+)/gi;
    const vus = new Set();
    let m;
    while ((m = re.exec(txt)) !== null) {
      const illimite = /unlimited/i.test(m[1]);
      const days = parseInt(m[2], 10);
      const price = parseFloat(m[4].replace(",", "."));
      const cle = `${m[1]}|${days}|${price}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      const vol = m[1].match(/([\d.,]+)/);
      rec.plans.push({
        days,
        dataGB: illimite ? "Infinity" : vol ? parseFloat(vol[1].replace(",", ".")) : null,
        unlimited: illimite,
        price,
        beforePrice: m[3] ? parseFloat(m[3].replace(",", ".")) : null,
        currency: "CHF",
        horsPerimetre: days > 31,
      });
    }

    // Le Nomad Pass s'affiche « Auto-renews every 30 DAYS » : abonnement, pas
    // forfait de voyage. On note sa présence sans le retenir.
    rec.meta.nomadPassPresent = /Auto-renews every/i.test(txt);
  } catch (e) {
    rec.err = e.message.slice(0, 140);
  }
  await page.close().catch(() => {});
  resultats.push(rec);

  console.log("──────────────────────────────────────────");
  console.log(`${slug}  —  ${rec.err ? "ERREUR " + rec.err : rec.plans.length + " forfait(s)"}`);
  if (rec.meta.couverture) console.log(`  couverture annoncée : ${rec.meta.couverture}`);
  rec.plans
    .sort((a, b) => a.price - b.price)
    .forEach((p) =>
      console.log(
        `  ${String(p.price).padStart(7)} CHF  ${String(p.days).padStart(3)} j  ${
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
