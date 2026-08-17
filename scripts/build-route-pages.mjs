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
// réels, identiques au principal À L'EXCEPTION de six balises du <head>. Les
// fichiers présents ont priorité sur les règles de _redirects (confirmé en
// production sur sitemap.xml et robots.txt), donc Netlify les sert directement.
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

function tetePour(tab, route) {
  const meta = TAB_META[tab];
  if (!meta) throw new Error(`TAB_META ne décrit pas l'onglet « ${tab} ».`);
  const [titre, desc] = meta;
  const url = `${SITE}/${route}`;
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

let ecrits = 0, derives = [];
for (const [tab, route] of routes) {
  const contenu = tetePour(tab, route) + RESTE;
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

console.log(`✅ ${ecrits} pages de route générées :`);
for (const [tab, route] of routes) console.log(`   /${route.padEnd(20)} ${TAB_META[tab][0]}`);
