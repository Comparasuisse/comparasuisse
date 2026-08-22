// Prérendu par route — génère un vrai index.html statique par onglet.
//
// LE PROBLÈME. Les dix routes (/tv, /voyage…) sont servies par la règle
// `/* /index.html 200` de _redirects. Elles renvoient donc toutes le MÊME
// fichier, dont le <head> statique annonce le titre générique et
// canonical="https://comparasuisse.ch/". Le script réécrit ensuite ces balises
// à l'exécution, mais un robot qui ne rend pas le JS — beaucoup d'aperçus de
// messageries et de réseaux sociaux — ne voit que la version statique. Vérifié
// en production le 17.08.2026 : `curl https://comparasuisse.ch/tv` renvoyait
// bien un canonical vers la racine.
//
// LA SOLUTION. Écrire tv/index.html, voyage/index.html, etc. : des fichiers
// réels. Les fichiers présents ont priorité sur les règles de _redirects
// (confirmé en production sur sitemap.xml et robots.txt), donc Netlify les
// sert directement.
//
// CE QUI DIFFÈRE D'UNE PAGE À L'AUTRE (élargi le 22.08.2026). Au départ, seules
// six balises du <head> changeaient : les onze pages servaient donc 20 525
// caractères de texte identiques au caractère près. Google ne les a pas
// pénalisées, il les a DÉDUPLIQUÉES — une seule page indexée sur douze au
// 22.08.2026, les autres en « Détectée, actuellement non indexée ». Un titre
// unique ne suffit pas à distinguer deux pages dont le corps est le même.
// Le générateur produit maintenant, pour chaque page :
//   - le <head> (titre, description, canonical, og:, twitter:) ;
//   - un <h1> qui lui est propre ;
//   - le sous-ensemble de questions FAQ qui la concerne, et lui seul ;
//   - le JSON-LD FAQPage correspondant, reconstruit à partir de ces questions.
//
// POURQUOI CES FICHIERS NE SONT PAS COMMITÉS. index.html pèse ~900 Ko et change
// à chaque passe d'audit. Dix copies, c'est ~9 Mo réécrits à chaque commit
// touchant le catalogue, et surtout le risque qu'on oublie de régénérer : les
// robots verraient alors des prix périmés. Ils sont donc produits au
// déploiement (cf. netlify.toml) et ignorés par git.
//
// DÉGRADATION GRACIEUSE. Si cette génération échoue, aucun dossier de route
// n'existe et la règle `/*` de _redirects reprend la main : le site fonctionne
// exactement comme avant ce chantier. On perd le prérendu, jamais le site.
//
//   node scripts/build-route-pages.mjs           → génère
//   node scripts/build-route-pages.mjs --check    → vérifie sans écrire (code 1 si
//                                                   une route manque ou a dérivé)
//   node scripts/build-route-pages.mjs --clean    → supprime les dossiers générés

import fs from "fs";
import path from "path";

const SITE = "https://comparasuisse.ch";
const SOURCE = "index.html";
const CHECK = process.argv.includes("--check");
const CLEAN = process.argv.includes("--clean");
// --home : écrit AUSSI la variante d'accueil par-dessus index.html. Réservé au
// déploiement (cf. netlify.toml), parce que index.html est le fichier qu'on
// édite à chaque passe d'audit : le filtrer en local reviendrait à perdre les
// dix-huit questions qui ne sont pas celles de l'accueil. Sur Netlify, la
// copie de travail est un clone jetable — la source du dépôt n'est pas touchée.
const HOME = process.argv.includes("--home");

const html = fs.readFileSync(SOURCE, "utf8");

// --- Source de vérité unique : les tables vivent dans index.html -------------
// Les redéclarer ici les ferait diverger au premier ajout d'onglet. On les lit
// donc dans le fichier lui-même, exactement comme audit-lib.mjs lit les données.
function extraire(nom, motif) {
  const m = html.match(motif);
  if (!m) throw new Error(`${nom} introuvable dans ${SOURCE} — le prérendu ne peut pas deviner les routes.`);
  return new Function(`return ${m[1]};`)();
}
const TAB_ROUTES = extraire("TAB_ROUTES", /const TAB_ROUTES = (\{[^\n]*\});/);
const TAB_META = extraire("TAB_META", /const TAB_META = (\{[\s\S]*?\n\});/);

// --- Un <h1> par page --------------------------------------------------------
// Aligné sur les <title> déjà en place, sans les répéter mot pour mot : le
// titre est écrit pour la SERP, le h1 pour la personne qui vient d'arriver.
// La clé « home » désigne index.html lui-même.
const H1 = {
  home:     "Comparateur d'abonnements mobile, internet et TV en Suisse",
  mobile:   "Comparatif des abonnements mobiles en Suisse — 60+ offres 2026",
  prepaid:  "Cartes prépayées mobiles en Suisse : le comparatif des offres",
  internet: "Comparatif des abonnements internet en Suisse : fibre, câble, DSL et 5G",
  dataonly: "Cartes SIM data only en Suisse : le comparatif",
  tv:       "Comparatif des abonnements TV en Suisse : Swisscom blue, Sunrise TV, Zattoo",
  combo:    "Abonnements Internet + TV en Suisse : les offres combinées comparées",
  promo:    "Promotions télécom en Suisse : rabais à vie et offres flash",
  travel:   "eSIM et roaming à l'étranger : le comparatif des offres suisses",
  coverage: "Couverture réseau mobile en Suisse : Swisscom, Salt et Sunrise",
  compare:  "Comparateur croisé : mobile, internet et TV côte à côte",
};

// Intitulé du bloc FAQ, par page. Un « Questions fréquentes » générique sur
// onze pages était une redondance de plus ; ici chaque bloc annonce son sujet.
const FAQ_TITRE = {
  home:     "Questions fréquentes sur Comparasuisse",
  mobile:   "Questions fréquentes sur les abonnements mobiles",
  internet: "Questions fréquentes sur les abonnements internet",
  tv:       "Questions fréquentes sur les abonnements TV",
  combo:    "Questions fréquentes sur les offres Internet + TV",
  promo:    "Questions fréquentes sur les promotions télécom",
  travel:   "Questions fréquentes sur le roaming et les eSIM",
  coverage: "Questions fréquentes sur la couverture réseau",
};

const routes = Object.entries(TAB_ROUTES);
if (!routes.length) throw new Error("TAB_ROUTES est vide.");

if (CLEAN) {
  let n = 0;
  for (const [, route] of routes) {
    if (fs.existsSync(route)) { fs.rmSync(route, { recursive: true, force: true }); n++; }
  }
  console.log(`${n} dossier(s) de route supprimé(s).`);
  process.exit(0);
}

// --- Réécriture du <head> ----------------------------------------------------
// Strictement bornée au <head> : le corps contient des gabarits JS avec des
// <title> SVG (les sparklines) qu'un remplacement global corromprait.
const coupe = html.indexOf("</head>");
if (coupe === -1) throw new Error("</head> introuvable.");
const TETE = html.slice(0, coupe);
const RESTE = html.slice(coupe);

const echapper = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// --- La FAQ, découpée en questions ------------------------------------------
// Chaque question porte dans index.html un id="faq-…" et un data-faq="<page>"
// posés à la main, à côté du texte. Le générateur ne décide donc pas du
// classement : il l'applique. Ajouter une question, c'est l'écrire et
// l'étiqueter — le prérendu suit sans que ce fichier bouge.
const BLOC_FAQ_RE = /<details id="(faq-[^"]+)" data-faq="([^"]+)"[\s\S]*?<\/details>/g;

function questionsDeLaSource() {
  const out = [];
  let m;
  const re = new RegExp(BLOC_FAQ_RE.source, BLOC_FAQ_RE.flags);
  while ((m = re.exec(RESTE)) !== null) {
    const [html, ancre, page] = m;
    const titre = (html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [, ""])[1].replace(/<[^>]+>/g, "").trim();
    // La réponse du JSON-LD est DÉRIVÉE du paragraphe visible, jamais saisie à
    // côté. Les deux ne peuvent donc plus diverger — ils divergeaient : au
    // 22.08.2026 le JSON-LD annonçait encore « Mucho Nano à 3.90 » comme abo le
    // moins cher quand la page affichait Quickline à 9.—, avec une deadline
    // périmée depuis cinq jours. Un balisage qui ment sur le contenu visible
    // est précisément ce que Google sanctionne.
    const reponse = (html.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [, ""])[1]
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!titre || !reponse) throw new Error(`question ${ancre} : titre ou réponse illisible`);
    out.push({ ancre, page, titre, reponse, html });
  }
  return out;
}

const QUESTIONS = questionsDeLaSource();
if (QUESTIONS.length < 20) {
  // Garde-fou : si la source a déjà été filtrée (double passage sur un même
  // arbre de travail), on refuse plutôt que de publier onze pages amputées.
  throw new Error(`${QUESTIONS.length} questions trouvées dans ${SOURCE} — la source semble déjà filtrée, régénération refusée.`);
}

// --- Réécriture du corps -----------------------------------------------------
function corpsPour(tab) {
  let corps = RESTE;

  // <h1> propre à la page.
  const h1 = H1[tab];
  if (!h1) throw new Error(`aucun <h1> défini pour l'onglet « ${tab} »`);
  if (!/<h1>[\s\S]*?<\/h1>/.test(corps)) throw new Error("<h1> introuvable dans le corps");
  corps = corps.replace(/<h1>[\s\S]*?<\/h1>/, `<h1>${echapper(h1)}</h1>`);

  // FAQ : on ne garde que les questions de cette page.
  const miennes = QUESTIONS.filter((q) => q.page === tab);
  for (const q of QUESTIONS) {
    if (q.page !== tab) corps = corps.replace(q.html, "");
  }

  if (!miennes.length) {
    // Aucune question ne correspond : on retire la section entière plutôt que
    // de laisser un bloc vide (cas /prepaid/, /dataonly/, /comparateur/).
    corps = corps.replace(/<section id="faq"[\s\S]*?<\/section>\n/, "");
    return corps;
  }

  // Intitulé du bloc + sommaire interne. Le sommaire donne à Google des points
  // d'accroche nommés vers chaque réponse — c'est ce qui permet les sitelinks
  // vers des ancres, observés chez des concurrents à autorité bien plus faible.
  corps = corps.replace(">Questions fréquentes</h2>", `>${echapper(FAQ_TITRE[tab] || "Questions fréquentes")}</h2>`);
  const sommaire =
    `<nav class="faq-sommaire" aria-label="Sommaire des questions" style="margin:0 0 14px; font-size:14px; line-height:1.8;">` +
    `<ul style="margin:0; padding-left:20px;">` +
    miennes.map((q) => `<li><a href="#${q.ancre}">${echapper(q.titre)}</a></li>`).join("") +
    `</ul></nav>`;
  corps = corps.replace('<div style="margin-top:14px;">', `<div style="margin-top:14px;">\n${sommaire}`);
  return corps;
}

// --- Réécriture du nœud FAQPage ---------------------------------------------
// Le @graph existant est modifié, jamais doublé : deux FAQPage sur une page
// s'annulent. Quand la page n'a aucune question, le nœud disparaît du graphe —
// un FAQPage vide est une erreur de balisage, pas une page sans FAQ.
function graphePour(tete, tab) {
  const miennes = QUESTIONS.filter((q) => q.page === tab);
  const debut = tete.indexOf('      "@type": "FAQPage",');
  if (debut === -1) throw new Error("nœud FAQPage introuvable dans le <head>");
  const ouvrant = tete.lastIndexOf("{", debut);
  const fermant = tete.indexOf("\n    }", debut);
  if (ouvrant === -1 || fermant === -1) throw new Error("nœud FAQPage mal délimité");
  const finNoeud = fermant + "\n    }".length;

  if (!miennes.length) {
    // Retire aussi la virgule qui précède, sinon le JSON devient invalide.
    const avant = tete.slice(0, ouvrant).replace(/,\s*$/, "");
    return avant + tete.slice(finNoeud).replace(/^\s*,/, "");
  }
  const noeud = {
    "@type": "FAQPage",
    "@id": `${SITE}/${TAB_ROUTES[tab] ? TAB_ROUTES[tab] + "/" : ""}#faq`,
    mainEntity: miennes.map((q) => ({
      "@type": "Question",
      name: q.titre,
      acceptedAnswer: { "@type": "Answer", text: q.reponse },
    })),
  };
  const json = JSON.stringify(noeud, null, 2)
    .split("\n")
    .map((l, i) => (i === 0 ? l : "    " + l))
    .join("\n");
  return tete.slice(0, ouvrant) + json + tete.slice(finNoeud);
}

function tetePour(tab, route) {
  const meta = TAB_META[tab];
  if (!meta) throw new Error(`TAB_META ne décrit pas l'onglet « ${tab} ».`);
  const [titre, desc] = meta;
  // Avec barre finale : c'est la forme que Netlify sert (301 depuis /tv vers /tv/).
  const url = `${SITE}/${route}/`;
  let t = TETE;
  const remplacer = (motif, valeur, quoi) => {
    if (!motif.test(t)) throw new Error(`balise ${quoi} introuvable dans le <head> pour /${route}`);
    t = t.replace(motif, valeur);
  };
  remplacer(/<title>[\s\S]*?<\/title>/, `<title>${echapper(titre)}</title>`, "<title>");
  remplacer(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${echapper(desc)}">`, "description");
  remplacer(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`, "canonical");
  remplacer(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${echapper(titre)}">`, "og:title");
  remplacer(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${echapper(desc)}">`, "og:description");
  remplacer(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`, "og:url");
  remplacer(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${echapper(titre)}">`, "twitter:title");
  remplacer(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${echapper(desc)}">`, "twitter:description");
  return t;
}

function pagePour(tab, route) {
  return graphePour(tetePour(tab, route), tab) + corpsPour(tab);
}

let ecrits = 0, derives = [];
for (const [tab, route] of routes) {
  const contenu = pagePour(tab, route);
  const cible = path.join(route, "index.html");
  if (CHECK) {
    if (!fs.existsSync(cible)) { derives.push(`${cible} : absent`); continue; }
    if (fs.readFileSync(cible, "utf8") !== contenu) derives.push(`${cible} : contenu périmé`);

    continue;
  }
  fs.mkdirSync(route, { recursive: true });
  fs.writeFileSync(cible, contenu);
  ecrits++;
}

if (CHECK) {
  if (derives.length) {
    console.error("Pages de route non synchronisées avec index.html :");
    for (const d of derives) console.error("  ✗ " + d);
    console.error("\nRelancer : node scripts/build-route-pages.mjs");
    process.exit(1);
  }
  console.log(`✅ ${routes.length} pages de route à jour.`);
  process.exit(0);
}

if (HOME) {
  // L'accueil garde son <head> d'origine (canonical racine, titre générique) :
  // seuls le <h1> et la FAQ changent.
  fs.writeFileSync(SOURCE, graphePour(TETE, "home") + corpsPour("home"));
  console.log(`✅ ${SOURCE} réécrit en variante d'accueil (${QUESTIONS.filter((q) => q.page === "home").length} questions).`);
}

console.log(`✅ ${ecrits} pages de route générées :`);
for (const [tab, route] of routes) {
  const n = QUESTIONS.filter((q) => q.page === tab).length;
  console.log(`   /${route.padEnd(20)} ${String(n).padStart(2)} question(s)  ${H1[tab]}`);
}
const orphelines = QUESTIONS.filter((q) => q.page !== "home" && !TAB_ROUTES[q.page]);
if (orphelines.length) {
  console.warn("⚠ questions étiquetées vers une page inexistante :", orphelines.map((q) => `${q.ancre}→${q.page}`).join(", "));
}
