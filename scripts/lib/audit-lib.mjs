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
//
// Certaines entrées référencent des constantes helpers (WINGO_MIGRATION_TITLE,
// WINGO_RED_UNAVAILABLE_WARNING, YALLO_TV_CHANNELS…) déclarées AVANT les arrays.
// On AUTO-DÉCOUVRE toutes les `const NAME = ...;` top-level en ALL_CAPS (ligne unique
// se terminant par `;`) et on les prépend au corps de la Function pour que l'eval
// résolve les références. Ce mécanisme est zero-maintenance : ajouter une nouvelle
// constante dans index.html ne demande AUCUNE mise à jour de ce script (bug résolu
// le 06.08.2026 après que WINGO_RED_UNAVAILABLE_* aient cassé le daily audit 2 jours).
export function extractTopLevelConstants(html) {
  // Matches lines starting with `const NAME_IN_CAPS = <one-line expr>;`
  // NAME must be at least 2 chars, uppercase + digits + underscores, and start with a letter.
  // Only single-line consts sont capturées (suffisant pour tous nos helpers actuels).
  const re = /^const ([A-Z][A-Z0-9_]{1,})\s*=\s*[^\n;]+;/gm;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ name: m[1], decl: m[0] });
  }
  return out;
}
export function loadData() {
  const html = fs.readFileSync("index.html", "utf8");
  const helperPrefix = extractTopLevelConstants(html).map((c) => c.decl).join("\n");
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
//   - TIMEOUT         : la vérification a dépassé opts.hardTimeout (défaut 20s)
//                       (le Playwright interne peut hanger : page.evaluate ou
//                        page.close bloquent parfois indéfiniment sur SPA lourde
//                        ou context saturé). Un wrapper Promise.race gère ce cas.
//   - NON_VÉRIFIABLE  : prix null/0 ou pas de champ price
//   - SKIP_NO_URL     : aucune URL enregistrée pour l'offre
//   - ERREUR          : timeout / réseau / autre
export async function checkOffer(ctx, item, opts = {}) {
  if (!item.url) return { status: "SKIP_NO_URL" };
  const navigationTimeout = opts.timeout || 15000;
  const waitAfter = opts.waitAfter || 800;
  // Hard timeout : borne TOTALE de la vérification. Nécessaire parce que
  // Playwright peut hanger sur page.evaluate ou page.close (constaté 03.08.2026
  // sur Sunrise Swiss Travel+ = 82 min, Lebara Relax S = 68 min, etc.).
  const hardTimeout = opts.hardTimeout || 20000;

  const page = await ctx.newPage();
  // Timers Playwright internes courts pour ne pas dépendre du hardTimeout.
  page.setDefaultNavigationTimeout(navigationTimeout);
  page.setDefaultTimeout(navigationTimeout);

  const runCheck = async () => {
    const resp = await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
    const status = resp?.status?.() ?? 0;
    if (status < 200 || status >= 400) return { status: "URL_MORTE", httpStatus: status };
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(waitAfter);
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    if (!text || text.length < 100) return { status: "PAGE_VIDE", httpStatus: status, textLength: text.length };
    const pricesOnPage = extractPrices(text);
    const expected = typeof item.price === "number" ? item.price.toFixed(2) : null;
    if (!expected || item.price === 0) return { status: "NON_VÉRIFIABLE", raison: "prix inclus/à partir de", pricesOnPage, text };
    if (pricesOnPage.includes(expected)) return { status: "OK", expected, pricesOnPage: pricesOnPage.slice(0, 15), text };
    const near = pricesOnPage
      .map(p => ({ p, diff: Math.abs(parseFloat(p) - parseFloat(expected)) }))
      .filter(x => x.diff <= parseFloat(expected) * 0.15)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 3)
      .map(x => x.p);
    return { status: "ÉCART", expected, pricesOnPage: pricesOnPage.slice(0, 15), near, text };
  };

  let timedOut = false;
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => { timedOut = true; resolve({ status: "TIMEOUT", hardTimeoutMs: hardTimeout }); }, hardTimeout);
  });

  try {
    const result = await Promise.race([runCheck().catch(e => ({ status: "ERREUR", error: e.message })), timeoutPromise]);
    return result;
  } finally {
    // Ferme la page en fire-and-forget : si Playwright hangue sur close,
    // on ne bloque pas le run suivant. Un léger fuite mémoire est tolérable.
    Promise.resolve().then(() => page.close({ runBeforeUnload: false }).catch(() => {}));
    if (timedOut) {
      // Signale au caller que ce run a laissé une page ouverte : au bout de
      // ~10 runs consécutifs en TIMEOUT, le caller peut décider de recycler
      // le context Playwright pour libérer la mémoire.
    }
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
