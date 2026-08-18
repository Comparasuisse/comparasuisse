// Helpers partagés par les scripts d'audit (audit-random.mjs, _audit-catalog.mjs, verify-page.mjs).
// Extrait la logique commune : chargement des données depuis index.html, extraction/normalisation
// de prix depuis un innerText de page, vérification live d'une offre via Playwright.

import fs from "node:fs";

// === Regex d'extraction de prix ===
// Tolérante aux formats suisses courants : "CHF 12.95", "12.95 CHF", "12,95 CHF",
// "CHF 39", "CHF 39.-", "39.-/mois", "39.-/m.", "Fr. 12.90", etc.
// Décimales optionnelles. Le suffixe "/m." (Sunrise) est maintenant reconnu
// en plus de "/mois" (documenté 06.08.2026 après faux positifs Sunrise).
export const PRICE_RE =
  /(?:CHF|Fr\.)\s*(\d{1,3}(?:['.,]\d{2})?)(?:\s*\.?[-–]?)|(\d{1,3}(?:['.,]\d{2})?)\s*(?:CHF|Fr\.|\.[-–]|\.?[-–]\s*\/\s*m(?:ois|\.)|\/\s*m(?:ois|\.))/gi;

// Normalise le texte AVANT extraction pour rejoindre les prix coupés par des
// sauts de ligne. Patterns observés en prod :
//   - Salt/Wingo : "17\n.\n95" → "17.95" (tokens dans <span> séparés)
//   - Mucho     : "17.\n90"    → "17.90" (entier + centimes sur 2 lignes)
//   - Talk Talk : "CHF\n9.95"   → "CHF 9.95" (devise sur ligne, prix en dessous)
//     idem Spusu, Aldi, Mtel, MaxiMobile, Sunrise landing SPA
export function normalizePriceFragments(text) {
  return text
    // "CHF\n9.95" ou "Fr.\n9.95" → "CHF 9.95" (devise et prix sur lignes séparées)
    // Doit passer AVANT les autres normalisations pour que le prix rejoint la devise.
    .replace(/\b(CHF|Fr\.)\s*\n+\s*(\d)/gi, "$1 $2")
    // "17.\n90" → "17.90" (Mucho pattern : entier avec point suivi de centimes sur ligne d'après)
    .replace(/(\d{1,3})\.\s*\n+\s*(\d{2})\b/g, "$1.$2")
    // "17 . 95" → "17.95" et "17 , 95" → "17,95"
    .replace(/(\d{1,3})\s+([.,])\s*(\d{2})\b/g, "$1$2$3")
    // "17. 95" → "17.95"
    .replace(/(\d{1,3})([.,])\s+(\d{2})\b/g, "$1$2$3")
    // "39\n.-" → "39.-"
    .replace(/(\d{1,3})\s*\n\s*\.[-–]/g, "$1.-");
}

// Certains opérateurs écrivent le libellé et le montant sur deux lignes, sans
// aucun marqueur de devise accolé au nombre :
//     Prix par mois
//     70.95
// PRICE_RE exige « CHF », « Fr. », « .- » ou « /mois » collé au montant et ne
// voit donc rien. Constaté le 10.08.2026 sur les 9 pages produit /fr/lp/ de
// Talk Talk, toutes remontées en ÉCART avec « prix trouvés : (aucun) » alors
// qu'elles affichent bien leur tarif. On récupère ces cas en capturant le
// premier montant décimal qui suit un libellé de prix.
// Repère un libellé de prix ; les montants sont ensuite cherchés dans la
// fenêtre courte qui le suit (le prix promo, puis souvent le prix barré).
// « frais mensuels » ajouté le 11.08.2026 : le tunnel Migros écrit
// « Swiss Start / 13.95 / Frais mensuels / 13.95 » sans marqueur de devise, et
// le seul montant capté était le « 59.– » des frais d'activation — donnant un
// faux ÉCART sur les quatre abos Migros Mobile. « mensuel » couvre aussi les
// variantes « prix mensuel », « montant mensuel ».
const PRICE_LABEL_RE = /(?:prix|preis|price|tarif|mensuel|monatlich)\w*\b/gi;
const BARE_AMOUNT_RE = /\b(\d{1,3}[.,]\d{2})\b/g;
const LABEL_WINDOW = 48;

export function extractPrices(text) {
  const normalized = normalizePriceFragments(text);
  const out = new Set();
  const add = (raw) => {
    const n = parseFloat(String(raw).replace(",", "."));
    if (!isNaN(n) && n >= 1 && n < 1000) out.add(n.toFixed(2));
  };
  let m;
  const re = new RegExp(PRICE_RE.source, PRICE_RE.flags);
  while ((m = re.exec(normalized)) !== null) add(m[1] || m[2]);

  const lab = new RegExp(PRICE_LABEL_RE.source, PRICE_LABEL_RE.flags);
  while ((m = lab.exec(normalized)) !== null) {
    const win = normalized.slice(m.index + m[0].length, m.index + m[0].length + LABEL_WINDOW);
    const amt = new RegExp(BARE_AMOUNT_RE.source, BARE_AMOUNT_RE.flags);
    let a;
    while ((a = amt.exec(win)) !== null) add(a[1]);
  }
  return [...out].sort((a, b) => parseFloat(a) - parseFloat(b));
}

// === URLs structurellement non-vérifiables (whitelist) ===
// Certaines pages ne permettent PAS d'extraire le prix mensuel par lecture
// naïve du DOM finalisé, même avec Playwright + waitForLoadState. Causes
// documentées (06.08.2026 après faux positifs répétés dans daily-audit-log) :
//   - SPA sans interaction : les cards sont chargées mais le prix nécessite
//     un clic ou est calculé après scroll (Sunrise Young, Sunrise landings)
//   - Prix rendu en image/badge : le SVG ou l'image portait le nombre, pas
//     de texte extractible (Swisscom TV, Netplus, iWay TV, TeleKing)
//   - Deep-links catalogue : la page ne présente que l'appareil, le prix
//     mensuel est ailleurs (Migros online-shop/wireless/onl/*)
//   - Landings marketing : la page présente une gamme sans prix par tier
//     (Sunrise /fr/mobile/roaming)
//
// Ces URLs remontent en NON_VÉRIFIABLE au lieu d'ÉCART/PAGE_VIDE pour ne pas
// polluer le rapport quotidien avec des flags manuels inutiles. À revérifier
// manuellement en cas de doute, mais elles ne sont plus signalées automatiquement.
// ── Challenge de la whitelist, 18.08.2026 ────────────────────────────────
// Chaque URL de cette liste a été rechargée avec l'extracteur du scan
// lui-même, court-circuit désactivé, pour vérifier si elle est VRAIMENT
// illisible ou seulement jamais regardée. Neuf entrées en sont sorties :
// sunrise /mobile/young et /swiss-travel-plus, aldi-mobile /fr, vtx
// abo-mobile, talktalk abonnements-mobiles et internet-et-tv, spusu
// /fr/spusu*, mtel /fr/produits/* et netplus application-tv-mobile — toutes
// rendent leurs prix. Soit ~30 offres qui repassent sous surveillance
// quotidienne au lieu de rester dans un angle mort.
//
// Ce qui reste ici est documenté cas par cas ci-dessous, et chaque entrée
// doit dire POURQUOI la page ne peut structurellement pas livrer son prix.
// Une whitelist est un aveu d'impuissance, pas un classement par commodité :
// tant qu'elle contient une page seulement « difficile », elle cache un prix
// qui peut dériver sans que personne ne le voie.
export const NON_VERIFIABLE_EXACT_URLS = new Set([
  // Galaxus : les trois prix de chaque gamme sont dessinés en typographie
  // décorative (glyphes vectoriels), pas écrits en texte. Aucune lecture du
  // DOM ne peut les rendre — seul un screenshot les donne. Vérifiés ainsi le
  // 12.08.2026 : mobile 12/19/29, internet 27/34/39, tous conformes. Sans
  // cette entrée, ces 5 offres ressortaient en ÉCART à chaque passage, avec
  // des « prix rendus » qui n'étaient que des coordonnées de tracé SVG.
  "https://abos.galaxus.ch/fr/mobile",
  "https://abos.galaxus.ch/fr/internet",
  // SPA Sunrise (les cards ne rendent pas le prix mensuel côté innerText)
  "https://www.sunrise.ch/fr/mobile",
  "https://www.sunrise.ch/fr/mobile/roaming",
  // Landings multi-plans où la comparaison 1-vs-1 casse (une page = plusieurs
  // tiers, on ne peut pas savoir quel prix appartient à quel tier sans parsing
  // structurel)
  "https://www.quickline.ch/mobile",
  "https://abos.galaxus.ch/mobile",
  "https://abos.galaxus.ch/internet",
]);
// URL prefix patterns for broader classes of non-verifiable pages.
export const NON_VERIFIABLE_URL_PATTERNS = [
  // Deep-links Migros online-shop : la page présente l'appareil, pas le prix
  // mensuel de l'abo (le prix affiché est celui de l'appareil ou 59.- activation)
  // Migros wireless deep-links : motif RETIRÉ le 10.08.2026. Le commentaire
  // d'origine (« la page ne présente que l'appareil, le prix mensuel est
  // ailleurs ») était faux : vérifié en browser, /fr/wireless/onl/3070 à 3073
  // renvoient chacun exactement un prix — 13.95, 17.95, 25.95, 29.95 — soit
  // les quatre Migros Mobile Swiss. Ces offres sont donc vérifiables, et le
  // court-circuit les avait au contraire laissées sans aucun verifiedAt.
  // TV — prix rendus dans badges/images/SVG non captés par innerText.
  // (Vérifiés au cas par cas 06.08.2026 : les 4 opérateurs ci-dessous ont
  // tous été confirmés comme rendant leurs prix TV dans des éléments non
  // extractibles.)
  /^https:\/\/www\.swisscom\.ch\/.*\/tv\//i,
  /^https:\/\/www\.netplus\.ch\/tv/i,
  /^https:\/\/www\.iway\.ch\/tv\//i,
  // Landings partagées documentées comme légitimes dans AUDIT-COMPLET.md §
  // "Cas légitimes de landing partagée" : plusieurs plans (parfois 5-8) pointent
  // sur une même URL landing car l'opérateur n'expose PAS de page produit
  // individuelle. L'extraction naïve ne peut pas distinguer les tiers ; on doit
  // vérifier manuellement.
  //
  // Vérifié 06.08.2026 sur le DOM réel via Playwright :
  //   - Talk Talk /fr/ : format "39.95\n102.95" (nouveau/ancien prix sans CHF)
  //   - Aldi /fr/, MaxiConnect /fr/, Lycamobile /fr/plans/ : cards multiples
  //     sans distinction 1-vs-1 possible
  //   - VTX /residential/mobile/abo-mobile : landing groupée
  //   - Digital Republic /en/smart-devices/ : 6 tiers SIM Data groupés
  //
  // Ajouté 09.08.2026 :
  //   - Digital Republic /fr/mobile/ : l'opérateur a fusionné Flat Mobile
  //     Swiss / Flat Mobile / Flat Mobile Plus sur une page unique à ancres.
  //     Les anciennes pages produit individuelles n'existent plus (404), les
  //     3 plans partagent donc la même URL et leurs 3 prix cohabitent sur la
  //     page sans attribution 1-vs-1 possible.
  // NB : talktalk.ch/fr/ (landing nue) a été retiré de cette liste le 09.08.2026.
  // Les 9 abos mobile qui y étaient groupés pointent désormais chacun sur leur
  // page /fr/lp/<plan>.html, qui rend son prix — ils redeviennent donc
  // vérifiables automatiquement et ne doivent plus être court-circuités.
  // Chemins réalignés le 09.08.2026 sur les cibles de redirection réelles
  // (AUDIT LIENS) : Talk Talk et VTX ont réorganisé leur arborescence, et
  // Lycamobile /fr/plans/ redirigeait vers la homepage ALLEMANDE.
  /^https:\/\/(www\.)?talktalk\.ch\/fr\/mobile-prepaye\/prepaid\.html$/i,
  // MaxiConnect RETIRÉ de la whitelist le 18.08.2026. Le motif d'origine
  // — « 8 montants pour 5 plans, attribution 1-vs-1 impossible » — était faux :
  // chaque plan vit dans un .plan-card portant un .plan-name, prix compris. Ce
  // n'est pas la page qui était illisible, c'est l'extraction à plat qui ne
  // savait pas attribuer. Les 9 prix (5 MaxiMobile + 4 MaxiData) ont été relevés
  // nom par nom et sont tous conformes. Cf. WHITELIST-INVESTIGATION.md.
  // Ancien commentaire conservé pour mémoire :
  // MaxiConnect : sitemap de 441 URLs passé en revue le 09.08.2026, aucune page
  // par plan n'existe — seulement des pages catégorie. Les 5 MaxiMobile quittent
  // la racine pour /fr/mobile (qui rend bien les prix, mais 8 montants pour 5
  // plans : attribution 1-vs-1 impossible, d'où la whitelist).
  // /fr/television n'est PAS whitelistée : MaxiTV y est seule et son prix 13.90
  // est directement vérifiable.
  // Lycamobile : le site FR est quasi inexistant — /fr/plans/ redirige vers la
  // homepage ALLEMANDE, /fr/abonnements/ et /fr/plans-mobiles/ vers l'ANGLAISE,
  // et la racine du domaine vers /de/. Seul /fr/ répond en 200 sans redirection
  // (vérifié 09.08.2026). C'est donc la seule cible acceptable en français.
  /^https:\/\/(www\.)?lycamobile\.ch\/fr\/?$/i,
  // Digital Republic : les deux motifs (/en/smart-devices/ et /fr/mobile/) ont
  // été RETIRÉS le 09.08.2026. Le sitemap expose en réalité une page produit par
  // plan sous /fr/produit/<slug>/ — 9 offres y ont été rebasculées, chacune sur
  // sa fiche affichant son propre prix. Plus rien à court-circuiter ici.
  // Sunrise /fr/internet-tv/abonnement-combine — vérifié 09.08.2026 : les
  // cards de packs sont rendues avec des placeholders U+200C (zero-width
  // non-joiner) à la place des libellés et des prix. Le seul nombre lisible
  // est « 159.80 », qui est l'économie sur les FRAIS D'ACTIVATION, pas un
  // prix mensuel — d'où un ÉCART quotidien garanti si on ne whiteliste pas.
  // (La landing internet /fr/internet-tv/abonnement-internet, elle, rend
  // correctement et reste vérifiée normalement.)
  /^https:\/\/(www\.)?sunrise\.ch\/fr\/internet-tv\/abonnement-combine\/?$/i,
  // Migros wireline (online-shop, éligibilité par adresse) : motif RETIRÉ le
  // 10.08.2026. Les 2 offres internet ont quitté le shop pour la page
  // marketing mobile.migros.ch/fr/internet-tv-et-telephonie-fixe/internet,
  // qui affiche les prix sans demander d'adresse. Elles redeviennent donc
  // vérifiables automatiquement.
  // Netplus La Box TV — conservé. C'est bien la page produit du boîtier, donc
  // la bonne destination visiteur, mais elle ne porte aucun tarif : le prix de
  // 18.- n'est énoncé que dans le configurateur /fr/offres-combo/ (« Box &
  // Application TV — CHF 18.- », relevé le 10.08.2026, conforme à notre
  // valeur). Le court-circuit reste donc nécessaire pour cette URL.
  /^https:\/\/(www\.)?netplus\.ch\/fr\/television\/la-box-tv/i,
  // Galaxus abos — vérifié 10.08.2026 en browser : les cards affichent le nom
  // du plan et ses caractéristiques, mais AUCUN montant n'apparaît dans le
  // texte rendu, ni en FR ni en DE. Les valeurs 12/19/29 et 27/34/39 sont
  // présentes dans le HTML brut mais hors innerText (image ou pseudo-élément
  // CSS). Le scan remontait « 16.00, 34.00 » : ce sont des nombres captés
  // ailleurs sur la page, pas des prix d'abonnement.
  /^https:\/\/abos\.galaxus\.ch\/(fr|de|it|en)?\/?(mobile|internet|tv)\/?$/i,
  // Spusu /fr/tariffs — même famille que /fr/spusu* déjà listé : tableau de
  // tarifs rendu en composants Vue dont les montants ne sortent pas au texte.
  /^https:\/\/(www\.)?spusu\.ch\/fr\/tariffs\/?$/i,
  /^https:\/\/(www\.)?lidl-connect\.ch\/fr\/?$/i,
  // CHmobile : les deux plans partagent la landing, désambiguïsés par ancres
  // #plus / #europe le 09.08.2026 — le motif doit donc tolérer un fragment.
  /^https:\/\/(www\.)?chmobile\.ch\/fr\/?(#.*)?$/i,
  // CANAL+ a migré sa boutique de boutique.suisse.canalplus.com vers
  // subscribe.canalplus.com/ch/ (constaté par redirection le 09.08.2026).
  /^https:\/\/subscribe\.canalplus\.com\/ch\/?$/i,
  // Mtel — DOM Angular où les prix sont dans des composants custom non lus
  // par innerText. Les scans du 03.08 remontaient systématiquement 7.50/9.95
  // (mentions marketing "à partir de") au lieu du prix du plan concerné.
  // Vérifié : mtel.ch/fr/produits/{sha}/{slug} = même problème sur toutes.
  // Spusu — DOM Vue.js où les prix sont dans des tokens {{price}} non
  // extractibles côté innerText après rendu partiel.
];
export function isNonVerifiableUrl(url) {
  if (!url) return false;
  if (NON_VERIFIABLE_EXACT_URLS.has(url)) return true;
  return NON_VERIFIABLE_URL_PATTERNS.some((re) => re.test(url));
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
    // travelData n'a ni network ni price mensuel : ce sont des eSIM de voyage,
    // facturées à la durée et parfois en USD ou en EUR (cf. VOYAGE-ESIM.md).
    // `price` est exprimé dans la devise native du fournisseur, celle-là même
    // qui est affichée sur sa page — la comparaison au prix extrait reste donc
    // valide ; `priceCHF` est la conversion, elle n'apparaît sur aucune page.
    // Le tableau est généré par scripts/build-travel-data.mjs, pas édité à la
    // main : une dérive détectée ici se corrige en régénérant (`--inject`),
    // jamais en patchant index.html, sinon le prochain build l'écrase.
    // Scanné quotidiennement au même titre que les autres catégories depuis le
    // 17.08.2026 (348 offres pour 81 URLs uniques).
    travel: (() => { try { return extract("travelData"); } catch { return []; } })(),
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
  // Short-circuit : URLs connues comme structurellement non-vérifiables.
  // Évite un scan Playwright inutile ET remonte NON_VÉRIFIABLE plutôt qu'ÉCART
  // pour éviter de polluer le rapport quotidien. Cf. NON_VERIFIABLE_EXACT_URLS.
  if (isNonVerifiableUrl(item.url)) {
    return { status: "NON_VÉRIFIABLE", raison: "URL whitelistée (SPA sans interaction, deep-link, prix en image, ou landing multi-plans)" };
  }
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
    let pricesOnPage = extractPrices(text);
    const expected = typeof item.price === "number" ? item.price.toFixed(2) : null;
    if (!expected || item.price === 0) return { status: "NON_VÉRIFIABLE", raison: "prix inclus/à partir de", pricesOnPage, text };
    // Repli sur le HTML rendu quand innerText ne donne pas le prix attendu.
    // Plusieurs sites servent bien le montant mais ne l'exposent pas en texte :
    // il vit dans un attribut, un pseudo-élément, ou un noeud que le navigateur
    // ne restitue pas via innerText tant qu'un consentement n'a pas été donné.
    // Cas d'école teleking.ch/tv/angebote : innerText ne rend que le bandeau
    // cookies, alors que le HTML porte 14.00, 19.00 et 23.00 — les trois prix
    // KingTV, exacts. Le repli n'invente rien : il lit la même page autrement,
    // et n'est tenté que si la lecture normale a échoué, donc sans coût quand
    // elle suffit.
    if (!pricesOnPage.includes(expected)) {
      const html = await page.content().catch(() => "");
      if (html) {
        const htmlTexte = html
          .replace(/<script[\s\S]*?<\/script>/g, " ")
          .replace(/<style[\s\S]*?<\/style>/g, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ");
        const prixHtml = extractPrices(htmlTexte);
        if (prixHtml.includes(expected)) {
          return { status: "OK", expected, pricesOnPage: prixHtml.slice(0, 15), text, source: "html-rendu" };
        }
        // On garde l'union pour le rapport : plus le lecteur voit de montants
        // réellement présents, mieux il juge un écart.
        pricesOnPage = [...new Set([...pricesOnPage, ...prixHtml])].sort((a, b) => parseFloat(a) - parseFloat(b));
      }
    }
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
