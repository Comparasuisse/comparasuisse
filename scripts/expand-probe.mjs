// Sonde « landing dépliée » — complément d'audit-probe.mjs.
//
// Plusieurs opérateurs replient une partie de leur tableau comparatif derrière un
// bouton « Afficher tous les produits ». Les lignes repliées sont absentes de
// document.body.innerText alors que le produit est bel et bien au catalogue :
// conclure un retrait depuis innerText seul est un faux négatif garanti
// (cas Wingo Red, 11.08.2026 — cf. AUDIT-COMPLET.md § tableaux repliés).
//
// Cette sonde clique tout ce qui ressemble à un déplieur, attend, puis dump les
// lignes de tableau et les liens de commande. Elle répond à deux questions que
// innerText ne sait pas trancher : le plan est-il listé, et est-il commandable.
//
//   node scripts/expand-probe.mjs <url> [--rows] [--links=motif]
//     --rows          liste toutes les lignes de tableau (défaut : celles avec un prix)
//     --links=motif   liste les liens dont le texte ou le href matche le motif

import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const allRows = args.includes("--rows");
const linksArg = args.find((a) => a.startsWith("--links="));
const linksRe = linksArg ? linksArg.slice(8) : null;

if (!url) {
  console.error("usage: node scripts/expand-probe.mjs <url> [--rows] [--links=motif]");
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
  viewport: { width: 1400, height: 1200 },
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page
  .evaluate(() =>
    document
      .querySelectorAll('[class*="cookie"],[class*="consent"],[id*="onetrust"],[id*="usercentrics"],[role="dialog"]')
      .forEach((e) => (e.style.display = "none"))
  )
  .catch(() => {});
await page.waitForTimeout(2500);

const EXPAND = /afficher|voir tous|tous les|plus de produits|alle produkte|mehr anzeigen|show all/i;
const labels = await page.evaluate(
  (src) =>
    [...document.querySelectorAll("button,a,[role='button']")]
      .filter((e) => new RegExp(src, "i").test(e.textContent || ""))
      .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
      .filter((t) => t && t.length < 60),
  EXPAND.source
);
console.log(`DÉPLIEURS DÉTECTÉS : ${JSON.stringify([...new Set(labels)])}`);

for (const label of [...new Set(labels)]) {
  try {
    await page.click(`text="${label}"`, { timeout: 4000 });
    await page.waitForTimeout(2000);
    console.log(`  ✔ cliqué : ${label}`);
  } catch {
    console.log(`  ✖ non cliquable : ${label}`);
  }
}
await page.waitForTimeout(1500);

const out = await page.evaluate(
  ({ allRows, linksRe }) => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const rows = [...document.querySelectorAll('tr,[role="row"]')].map((r) => clean(r.innerText)).filter(Boolean);
    const withPrice = rows.filter((r) => /\d+[.,]\d{2}|\d+\.-/.test(r));
    const links = linksRe
      ? [...document.querySelectorAll("a")]
          .filter((a) => new RegExp(linksRe, "i").test(clean(a.textContent) + " " + (a.getAttribute("href") || "")))
          .map((a) => `${clean(a.textContent).slice(0, 45)} -> ${a.getAttribute("href")}`)
      : [];
    const shop = [...new Set([...document.querySelectorAll("a")].map((a) => a.getAttribute("href") || "").filter((h) => /online-shop|shop\.|\/checkout|\/commander|\/bestellen/i.test(h)))];
    return { rows: allRows ? rows : withPrice, total: rows.length, links, shop: shop.slice(0, 15) };
  },
  { allRows, linksRe }
);

console.log(`\n--- LIGNES DE TABLEAU (${out.rows.length} retenues sur ${out.total}) ---`);
out.rows.forEach((r) => console.log("  •", r.slice(0, 200)));
if (linksRe) {
  console.log(`\n--- LIENS matchant /${linksRe}/i (${out.links.length}) ---`);
  [...new Set(out.links)].forEach((l) => console.log("  ", l));
}
console.log(`\n--- LIENS DE COMMANDE (${out.shop.length}) ---`);
out.shop.forEach((s) => console.log("  ", s));

await browser.close();
