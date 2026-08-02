// Helpers partagés par les scripts d'audit (audit-random.mjs, _audit-catalog.mjs, verify-page.mjs).
// Extrait la logique commune : chargement des données depuis index.html, extraction/normalisation
// de prix depuis un innerText de page, vérification live d'une offre via Playwright.

import fs from "node:fs";

// === Regex d'extraction de prix ===
// Tolérante aux formats suisses courants : "CHF 12.95", "12.95 CHF", "12,95 CHF",
// "CHF 39", "CHF 39.-", "39.-/mois", "Fr. 12.90", etc. Décimales optionnelles.
export const PRICE_RE =
  /(?:CHF|Fr\.)\s*(\d{1,3}(?:['.,]\d{2})?)(?:\s*\.?[-–]?)|(\d{1,3}(?:['.,]\d{2})?)\s*(?:CHF|Fr\.|\.[-–]|\.?[-–]\s*\/\s*mois|\/mois)/gi;

// Normalise le texte AVANT extraction pour rejoindre les prix coupés par des
// sauts de ligne (Salt/Wingo/etc. rendent les tokens dans des <span> séparés).
export function normalizePriceFragments(text) {
  return text
    .replace(/(\d{1,3})\s+([.,])\s*(\d{2})\b/g, "$1$2$3")
    .replace(/(\d{1,3})([.,])\s+(\d{2})\b/g, "$1$2$3")
    .replace(/(\d{1,3})\s*\n\s*\.[-–]/g, "$1.-");
}

export function extractPrices(text) {
  const normalized = normalizePriceFragments(text);
  const out = new Set();
  let m;
  const re = new RegExp(PRICE_RE.source, PRICE_RE.flags);
  while ((m = re.exec(normalized)) !== null) {
    const raw = (m[1] || m[2]).replace(",", ".");
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= 1 && n < 1000) out.add(n.toFixed(2));
  }
  return [...out].sort((a, b) => parseFloat(a) - parseFloat(b));
}

// === Chargement des données depuis index.html ===
// Pattern : les arrays de données sont écrits en JavaScript inline dans index.html.
// On les extrait par regex + eval sécurisé (Function). Le contenu est trusted (écrit par nous).
// Certaines entrées référencent des constantes helpers (WINGO_MIGRATION_TITLE,
// WINGO_MIGRATION_WARNING, YALLO_TV_CHANNELS…) déclarées AVANT les arrays. On les
// extrait aussi et on les prépend au corps de la Function pour que l'eval résolve.
const HELPER_CONST_NAMES = [
  "WINGO_MIGRATION_WARNING",
  "WINGO_MIGRATION_TITLE",
  "YALLO_TV_CHANNELS",
];
export function loadData() {
  const html = fs.readFileSync("index.html", "utf8");
  // Extrait les `const NAME = ...;` (une seule ligne, terminé par ";")
  const helperPrefix = HELPER_CONST_NAMES
    .map((name) => {
      const re = new RegExp(`^const ${name}\\s*=\\s*[^;]+;`, "m");
      const m = html.match(re);
      return m ? m[0] : `const ${name} = undefined;`;
    })
    .join("\n");
  const extract = (name) => {
    const re = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`);
    const m = html.match(re);
    if (!m) throw new Error(`Impossible d'extraire ${name}`);
    return new Function(`${helperPrefix}\nreturn [${m[1]}\n];`)();
  };
  return {
    mobile: extract("mobileData"),
    internet: extract("internetData"),
    tv: extract("tvData"),
    combo: extract("comboData"),
    promo: extract("promoData"),
    // prepaidData et dataOnlyData sont aussi présents mais avec des schémas
    // différents (periodDays, prepaidType) — les inclure aussi.
    prepaid: (() => { try { return extract("prepaidData"); } catch { return []; } })(),
    dataOnly: (() => { try { return extract("dataOnlyData"); } catch { return []; } })(),
  };
}

// === Vérification live d'une offre via Playwright ===
// Retourne un objet { status, ...détails } :
//   - OK              : prix stocké trouvé sur la page
//   - ÉCART           : prix stocké absent de la page (mais d'autres prix présents)
//   - URL_MORTE       : HTTP 4xx/5xx
//   - PAGE_VIDE       : < 100 chars visible (protection bot / JS bloqué)
//   - NON_VÉRIFIABLE  : prix null/0 ou pas de champ price
//   - SKIP_NO_URL     : aucune URL enregistrée pour l'offre
//   - ERREUR          : timeout / réseau / autre
export async function checkOffer(ctx, item, opts = {}) {
  const timeout = opts.timeout || 30000;
  const waitAfter = opts.waitAfter || 1200;
  if (!item.url) return { status: "SKIP_NO_URL" };
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(item.url, { waitUntil: "domcontentloaded", timeout });
    const status = resp?.status?.() ?? 0;
    if (status < 200 || status >= 400) {
      await page.close();
      return { status: "URL_MORTE", httpStatus: status };
    }
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(waitAfter);
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    await page.close();

    if (!text || text.length < 100) {
      return { status: "PAGE_VIDE", httpStatus: status, textLength: text.length };
    }
    const pricesOnPage = extractPrices(text);
    const expected = typeof item.price === "number" ? item.price.toFixed(2) : null;
    if (!expected || item.price === 0) {
      return { status: "NON_VÉRIFIABLE", raison: "prix inclus/à partir de", pricesOnPage, text };
    }
    const found = pricesOnPage.includes(expected);
    if (found) return { status: "OK", expected, pricesOnPage: pricesOnPage.slice(0, 15), text };
    const near = pricesOnPage
      .map(p => ({ p, diff: Math.abs(parseFloat(p) - parseFloat(expected)) }))
      .filter(x => x.diff <= parseFloat(expected) * 0.15)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 3)
      .map(x => x.p);
    return { status: "ÉCART", expected, pricesOnPage: pricesOnPage.slice(0, 15), near, text };
  } catch (e) {
    try { await page.close(); } catch {}
    return { status: "ERREUR", error: e.message };
  }
}

// === Détection de mots-clés suspects sur la page ===
// Utilisé par audit-daily pour flaguer les offres marketing-agressives à
// re-vérifier manuellement (fake urgency, countdowns cachés, promos re-lancées).
// Les mots-clés sont volontairement en français ET dans les formats vus sur les
// sites suisses (Wingo/yallo/CHmobile/Sky/Lidl utilisent ces expressions).
export const SUSPICIOUS_KEYWORDS = [
  "à vie",
  "à vie une fois souscrit",
  "pour toujours",
  "rabais à vie",
  "countdown",
  "compte à rebours",
  "il te reste",
  "expire",
  "expiration",
  "offre limitée",
  "durée limitée",
  "à saisir",
  "jusqu'au",
  "flash promo",
  "aktion",
  "national day",
  "summer deal",
  "last chance",
];

export function detectSuspiciousKeywords(text) {
  if (!text) return [];
  const lc = text.toLowerCase();
  const hits = [];
  for (const kw of SUSPICIOUS_KEYWORDS) {
    if (lc.includes(kw.toLowerCase())) hits.push(kw);
  }
  return hits;
}
