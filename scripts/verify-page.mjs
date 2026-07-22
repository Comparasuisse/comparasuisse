// Vérification ponctuelle de pages opérateur (SPA / bot-protected) via un vrai
// Chrome headless. Usage strictement à la demande de l'utilisateur — cf. règle
// [[feedback-verify-all-offers-workflow]] : jamais de scraping automatisé sans
// supervision, jamais utilisé pour de la publication de données massivement scrapées.
//
// Usage : node scripts/verify-page.mjs <url1> [url2] [url3] ...
//
// Comportement : ouvre un contexte Chrome fr-CH / Europe/Zurich avec un UA
// standard (pas HeadlessChrome), attend le network idle + un délai supplémentaire
// pour laisser les SPA finir de rendre, extrait le texte visible et un tableau
// des liens produit détectés.

import { chromium } from "playwright-core";

const CHROME_PATH =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

// UA Chrome stable sur Windows 11 — évite le token "HeadlessChrome".
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("Usage: node scripts/verify-page.mjs <url> [url...]");
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
});
const ctx = await browser.newContext({
  userAgent: UA,
  locale: "fr-CH",
  timezoneId: "Europe/Zurich",
  viewport: { width: 1280, height: 900 },
  extraHTTPHeaders: {
    "accept-language": "fr-CH,fr;q=0.9,en;q=0.5",
  },
});

for (const url of urls) {
  const page = await ctx.newPage();
  const start = Date.now();
  try {
    const resp = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    // Attendre soit networkidle (SPA), soit un délai plafonné
    await page
      .waitForLoadState("networkidle", { timeout: 15000 })
      .catch(() => {});
    // Petit délai supplémentaire pour que les SPA React/Vue rendent la donnée.
    await page.waitForTimeout(1800);

    const text = await page.evaluate(() => document.body.innerText);
    const productLinks = await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")]
        .map((a) => a.href)
        .filter(
          (h) =>
            /abo|abonnement|plan|mobile|internet|forfait|offer|swiss|europe|max|home|fiber/i.test(
              h
            ) && !h.startsWith("javascript:")
        )
        .slice(0, 30)
    );

    console.log(`\n===== ${url} =====`);
    console.log(`HTTP ${resp?.status?.() ?? "?"} · ${Date.now() - start}ms`);
    console.log(`--- TEXTE (max 3500 char) ---`);
    console.log(text.replace(/\n{3,}/g, "\n\n").slice(0, 3500));
    if (productLinks.length) {
      console.log(`--- LIENS DÉTECTÉS ---`);
      productLinks.forEach((l) => console.log(l));
    }
  } catch (e) {
    console.log(`\n===== ${url} =====`);
    console.log(`ERROR après ${Date.now() - start}ms : ${e.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();
