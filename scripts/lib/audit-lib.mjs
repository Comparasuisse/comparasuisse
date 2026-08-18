// Helpers partagés par les scripts d'audit (audit-random.mjs, _audit-catalog.mjs, verify-page.mjs).
// Extrait la logique commune : chargement des données depuis index.html, extraction/normalisation
// de prix depuis un innerText de page, vérification live d'une offre via Playwright.

import fs from "node:fs";

// === Regex d'extraction de prix ===
// Tolérante aux formats suisses courants : "CHF 12.95", "12.95 CHF", "12,95 CHF",
// "CHF 39", "CHF 39.-", "39.-/mois", "39.-/m.", "Fr. 12.90", etc.
// Décimales optionnelles. Le suffixe "/m." (Sunrise) est maintenant reconnu
// en plus de "/mois" (documenté 06.08.2026 après faux positifs Sunrise).
// Les abréviations ALÉMANIQUES du mois sont reconnues depuis le 18.08.2026 :
// "/Mt.", "/Mte.", "/Monat". Un bon tiers du catalogue pointe sur des pages
// germanophones, et "34.50/Mt." (Quickline Mobile XL) était le seul des quatre
// prix de sa page à échapper à l'extracteur — pas parce qu'il était caché,
// mais parce qu'on ne savait lire le mois qu'en français.
export const PRICE_RE =
  /(?:CHF|Fr\.)\s*(\d{1,3}(?:['.,]\d{2})?)(?:\s*\.?[-–]?)|(\d{1,3}(?:['.,]\d{2})?)\s*(?:CHF|Fr\.|\.[-–]|\.?[-–]\s*\/\s*m(?:ois|onat\.?|te?\.?|\.)|\/\s*m(?:ois|onat\.?|te?\.?|\.))/gi;

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
    .replace(/(\d{1,3})\s*\n\s*\.[-–]/g, "$1.-")
    // "CHF\n/Mt.25.50" → "CHF 25.50" : devise et montant séparés par la mention
    // de périodicité, qui se glisse AVANT le nombre au lieu de le suivre.
    // Constaté le 18.08.2026 sur iway.ch/tv/, où les trois abos s'écrivent
    // "CHF / Mt. 15.–". Les deux premiers étaient captés grâce à leur "–"
    // final ; TV Top 2.0, écrit "25.50" sans tiret, ne l'était pas — un prix
    // invisible sur une page parfaitement lisible.
    .replace(/\b(CHF|Fr\.)\s*\n*\s*\/\s*m(?:ois|onat|te?)?\.?\s*(?=\d)/gi, "$1 ");
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

// Le montant peut aussi n'être annoncé par AUCUN libellé, seulement suivi de son
// bouton d'achat :
//     Season 6 Months
//     […]
//     149.95
//     AJOUTER AU PANIER
// Aucun « CHF », aucun « /mois », et le seul mot de tarif de la page
// (« Détails du tarif ») arrive APRÈS le nombre — la fenêtre de PRICE_LABEL_RE
// regarde en avant, elle ne pouvait pas le voir. Constaté le 18.08.2026 sur les
// quatre formules prépayées de Talk Talk, page dont on croyait qu'elle ne
// livrait pas ses prix alors qu'elle les affiche en clair.
// Un nombre à décimales posé juste avant un bouton d'achat est un prix : on le
// lit en regardant EN ARRIÈRE depuis l'appel à l'action. Les entiers nus
// (quantités, numéros d'étape) restent hors de portée puisque BARE_AMOUNT_RE
// exige deux décimales.
const CTA_RE = /(?:ajouter au panier|au panier|add to cart|in den warenkorb|zum warenkorb|jetzt (?:bestellen|kaufen)|commander maintenant|acheter maintenant|s['’]abonner|abonnieren|abbonarsi)/gi;
const CTA_BACK_WINDOW = 40;

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

  // Montant nu adossé à un bouton d'achat : on lit la fenêtre qui PRÉCÈDE
  // l'appel à l'action et on ne retient que le dernier montant, celui qui
  // touche le bouton — les autres appartiennent au descriptif de l'offre.
  const cta = new RegExp(CTA_RE.source, CTA_RE.flags);
  while ((m = cta.exec(normalized)) !== null) {
    const win = normalized.slice(Math.max(0, m.index - CTA_BACK_WINDOW), m.index);
    const amt = new RegExp(BARE_AMOUNT_RE.source, BARE_AMOUNT_RE.flags);
    let a, last = null;
    while ((a = amt.exec(win)) !== null) last = a[1];
    if (last !== null) add(last);
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
  // Galaxus RETIRÉ le 18.08.2026. Le motif — « prix dessinés en glyphes
  // vectoriels, seul un screenshot les donne » — décrivait bien le dessin,
  // mais pas la page : chaque montant est une animation Lottie qui déclare son
  // nombre dans l'id de son conteneur ET dans le fichier qu'elle télécharge.
  // Les six prix se lisent donc sans OCR (cf. readLottieNumbers).
  // Quickline RETIRÉ le 18.08.2026. Le motif — « landing multi-plans,
  // attribution 1-vs-1 impossible » — ne tient plus : les quatre abos rendent
  // chacun leur prix en clair (14.–/Mt., 24.– 12.–/Mt., 29.– 9.–/Mt.,
  // 69.– 34.50/Mt.). Seul 34.50 échappait à l'extracteur, faute de savoir lire
  // l'abréviation alémanique du mois.
  // SPA Sunrise (les cards ne rendent pas le prix mensuel côté innerText)
  "https://www.sunrise.ch/fr/mobile",
  "https://www.sunrise.ch/fr/mobile/roaming",
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
  // iWay RETIRÉ le 18.08.2026 : les trois prix sont en clair dans le texte,
  // écrits "CHF / Mt. 15.–". TV Classic et TV Premium étaient déjà lus ; seul
  // TV Top 2.0 ("25.50", sans tiret final) manquait. Rien d'illisible ici,
  // seulement une périodicité écrite en allemand.
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
  // Talk Talk prépayé RETIRÉ le 18.08.2026 : la page affiche ses quatre
  // montants en clair (19.95 / 44.95 / 79.95 / 149.95), chacun collé à son
  // bouton « AJOUTER AU PANIER ». Ce n'est pas la page qui cachait ses prix,
  // c'est l'extracteur qui ne savait lire un montant que précédé d'un libellé.
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
  // Sunrise /fr/internet-tv/abonnement-combine RETIRÉ le 18.08.2026 au profit
  // d'une recette de pré-clic (cf. PRE_CLICK_RECIPES). Les placeholders U+200C
  // constatés le 09.08.2026 ont disparu : la page rend son texte, et le prix
  // 85.60 apparaît dès qu'on bascule l'onglet « Avec TV ». Le nombre « 159.80 »
  // qui trompait le scan est toujours là, mais il ne fait plus autorité
  // puisqu'on trouve désormais le vrai prix.
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
  // Galaxus abos — motif RETIRÉ le 18.08.2026. Le constat du 10.08 était juste
  // (aucun montant dans le texte rendu, et « 16.00 / 34.00 » captés ailleurs
  // sur la page sont les tarifs étudiants, pas les abos) mais la conclusion
  // était trop courte : les montants sont des animations Lottie qui nomment
  // leur nombre. Ils se lisent, cf. readLottieNumbers.
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

// === Recettes de pré-clic ===
// Certaines pages affichent bien leur prix, mais seulement après UNE action :
// un onglet à basculer, un tableau à déplier. Jusqu'ici ces offres partaient en
// whitelist, c'est-à-dire dans un angle mort — plus personne ne regardait leur
// prix. Une recette de pré-clic est l'inverse d'un renoncement : on écrit une
// fois le geste que fait un visiteur, et l'offre repasse sous surveillance
// quotidienne.
//
// Trois règles pour qu'une recette reste honnête :
//   1. le geste doit être celui d'un visiteur ordinaire (basculer un onglet,
//      déplier une liste) — jamais franchir un paiement ou une authentification ;
//   2. le clic ne doit RIEN changer au prix : il le révèle, il ne le négocie
//      pas (pas de code promo, pas de durée d'engagement modifiée) ;
//   3. l'échec du clic n'est pas fatal — on lit la page telle quelle et
//      l'offre ressort en ÉCART, ce qui est le bon signal si la page a changé.
export const PRE_CLICK_RECIPES = [
  {
    // Sunrise combiné : les trois packs s'affichent d'abord "Sans TV". Notre
    // offre est la variante AVEC TV du pack Neighbors, dont le prix (85.60)
    // n'apparaît qu'après avoir basculé l'onglet. Relevé le 18.08.2026 :
    // sans TV 69.80 / 75.60 / 80.60, avec TV 79.80 / 85.60 / 90.60.
    // Le motif de whitelist d'origine (placeholders U+200C à la place des
    // libellés, 09.08.2026) ne s'observe plus : la page rend son texte.
    pattern: /^https:\/\/(www\.)?sunrise\.ch\/fr\/internet-tv\/abonnement-combine\/?$/i,
    texts: ["Avec TV"],
  },
];
export function preClickRecipeFor(url) {
  if (!url) return null;
  return PRE_CLICK_RECIPES.find((r) => r.pattern.test(url)) || null;
}

// === Lecture des nombres dessinés en animation Lottie ===
// Galaxus n'écrit pas ses prix : il les ANIME. Chaque montant est une animation
// Lottie (After Effects exporté en JSON) rendue en tracés vectoriels — aucun
// texte, donc rien à lire ni dans innerText ni dans le HTML servi. C'est le
// motif qui justifiait leur whitelist depuis le 12.08.2026.
//
// Sauf que l'animation dit son nombre deux fois, ailleurs que dans son dessin :
//   - le conteneur porte un id parlant : id="lottie-karotti-12-image" ;
//   - le fichier chargé le répète : /assets/img/lottie/mobile/data-12.json,
//     dont la racine JSON s'appelle "Zahl_12" (relevé le 18.08.2026).
// On ne retient un nombre que s'il apparaît DANS LES DEUX — dans le DOM et dans
// une ressource réellement téléchargée. Cette double confirmation est ce qui
// rend la lecture sûre : un id parlant seul pourrait survivre à un changement
// de prix, une ressource seule pourrait appartenir à une autre section. Les
// deux ensemble signifient que la page a chargé, pour cette carte, l'animation
// de ce nombre-là.
export async function readLottieNumbers(page) {
  const tokens = await page
    .evaluate(() => {
      const dom = [...document.querySelectorAll('[id*="lottie" i],[class*="lottie" i]')]
        .map((e) => (e.id || "") + " " + (e.getAttribute("class") || ""))
        .join(" ");
      const res = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .filter((n) => /lottie/i.test(n))
        .join(" ");
      return { dom, res };
    })
    .catch(() => null);
  if (!tokens) return [];
  const nombres = (str) => {
    // Le tiret bas fait partie des caractères de mot : sans cette normalisation,
    // "data-19_neu.json" ne livre pas son 19, faute de frontière de mot après le
    // nombre — et c'était exactement le fichier de Galaxus Mobile CH illimité.
    // On ne relâche que ce séparateur-là : les empreintes du type
    // "lottie-2cc95b689867ea4e9770cc1a6147d2d1.js" restent protégées par leurs
    // lettres, et ne peuvent donc pas se faire passer pour des prix.
    str = str.replace(/_/g, "-");
    const out = new Set();
    let m;
    const re = /\b(\d{1,3}(?:[.,]\d{1,2})?)\b/g;
    while ((m = re.exec(str)) !== null) {
      const n = parseFloat(m[1].replace(",", "."));
      if (!isNaN(n) && n >= 1 && n < 1000) out.add(n.toFixed(2));
    }
    return out;
  };
  const dom = nombres(tokens.dom);
  const res = nombres(tokens.res);
  return [...dom].filter((n) => res.has(n)).sort((a, b) => parseFloat(a) - parseFloat(b));
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
  // Une recette de pré-clic ajoute une recherche d'élément et une attente de
  // rendu : on lui alloue son propre budget plutôt que de la faire tenir dans
  // celui d'une page ordinaire, sinon elle expirerait avant d'avoir lu.
  const recette = preClickRecipeFor(item.url);
  const hardTimeout = (opts.hardTimeout || 20000) + (recette ? 12000 : 0);

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
    // Pré-clic éventuel : on révèle ce qu'un visiteur révélerait, puis on laisse
    // la page se redessiner. Un échec est silencieux par conception (cf. règle 3
    // de PRE_CLICK_RECIPES) : mieux vaut un ÉCART visible qu'une erreur muette.
    if (recette) {
      for (const t of recette.texts) {
        await page.getByText(t, { exact: true }).first().click({ timeout: 6000 }).catch(() => {});
      }
      await page.waitForTimeout(2500);
    }
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
    // Dernier repli : les nombres dessinés en animation (cf. readLottieNumbers).
    // Tenté seulement quand les deux lectures textuelles ont échoué, donc sans
    // coût sur une page normale.
    const lottie = await readLottieNumbers(page);
    if (lottie.includes(expected)) {
      return { status: "OK", expected, pricesOnPage: lottie, text, source: "lottie" };
    }
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
