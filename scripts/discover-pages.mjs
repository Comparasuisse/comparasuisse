// Découverte de pages produit chez un opérateur (chantier url-audit).
//
// Raison d'être : chez Talk Talk, un répertoire entier /fr/lp/<plan>.html —
// une page produit par abonnement — n'était lié depuis AUCUNE page de
// navigation du site. Seul le sitemap le révélait. Ne jamais conclure
// « pas de page produit » sans avoir lu le sitemap complet.
//
// Usage : node scripts/discover-pages.mjs <url-de-depart> [motif-regex]
//   node scripts/discover-pages.mjs https://www.talktalk.ch/fr/ "fr/(lp|mobile)"
//
// 1) sitemap.xml / sitemap_index.xml / robots.txt (sitemaps imbriqués suivis)
// 2) crawl des liens internes de la page de départ, rendue dans un vrai Chrome

import { chromium } from "playwright-core";

const start = process.argv[2];
if (!start) {
  console.error("Usage: node scripts/discover-pages.mjs <url> [motif-regex]");
  process.exit(2);
}
const filter = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const origin = new URL(start).origin;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── 1. Sitemaps (récursif sur les index)
const fromSitemap = new Set();
const seenSitemaps = new Set();
async function trySitemap(u, depth = 0) {
  if (depth > 3 || seenSitemaps.has(u)) return;
  seenSitemaps.add(u);
  try {
    const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return;
    const xml = await r.text();
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const loc = m[1];
      if (/\.xml(\.gz)?$/i.test(loc)) await trySitemap(loc, depth + 1);
      else fromSitemap.add(loc);
    }
  } catch {}
}

for (const p of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"]) {
  await trySitemap(origin + p);
}
try {
  const r = await fetch(origin + "/robots.txt", {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(12000),
  });
  if (r.ok) {
    const t = await r.text();
    for (const m of t.matchAll(/Sitemap:\s*(\S+)/gi)) await trySitemap(m[1]);
  }
} catch {}
console.log(`Sitemap : ${fromSitemap.size} URLs`);

// ── 2. Crawl des liens de la page de départ (DOM rendu)
const fromCrawl = new Set();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const page = await (await browser.newContext({ userAgent: UA, locale: "fr-CH" })).newPage();
  await page.goto(start, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  const hrefs = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.href));
  hrefs
    .filter((h) => h.startsWith(origin))
    .forEach((h) => fromCrawl.add(h.replace(/[?#].*$/, "")));
} catch (e) {
  console.log("crawl : échec — " + e.message.slice(0, 70));
}
await browser.close();
console.log(`Crawl   : ${fromCrawl.size} liens internes\n`);

const all = [...new Set([...fromSitemap, ...fromCrawl])].sort();
const shown = filter ? all.filter((u) => filter.test(u)) : all;
console.log(`=== ${shown.length} URL(s)${filter ? ` matchant /${filter.source}/` : ""} ===`);
shown.forEach((u) => console.log("  " + u));

// Indice : motifs de page produit fréquemment rencontrés
if (!filter) {
  const hints = all.filter((u) => /\/(lp|produit|product|p|plans?|abo|abos|tarif)s?\//i.test(u));
  if (hints.length) console.log(`\n=== ${hints.length} URL(s) ressemblant à des pages produit ===`);
  hints.slice(0, 40).forEach((u) => console.log("  " + u));
}
