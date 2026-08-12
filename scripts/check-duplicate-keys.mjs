// Détecte les clés dupliquées dans les objets-offres d'index.html.
//
// Motivé par un incident réel (10.08.2026). Plusieurs objets s'étendent sur
// PLUSIEURS lignes, avec des commentaires intercalés au milieu. Un patch qui
// remplace « la ligne contenant name:"X" » ajoute alors une seconde occurrence
// d'une clé déjà présente plus bas dans le même objet — et JavaScript retient
// la DERNIÈRE. Le fichier affiche une valeur, le comparateur en utilise une
// autre. Silencieux, et invisible au contrôle syntaxique.
// Cas constaté : Green Internet Home portait verifiedAt "2026-08-10" en tête
// d'objet et "2026-08-08" huit lignes plus bas ; c'est la seconde qui gagnait.
//
// Méthode : on compare la valeur ÉVALUÉE (ce que le site utilise réellement)
// à la PREMIÈRE occurrence trouvée dans le texte source (ce qu'un humain lit
// en ouvrant le fichier). Toute divergence trahit une clé en double.

import fs from "fs";
import { loadData } from "./lib/audit-lib.mjs";

const html = fs.readFileSync("index.html", "utf8");
const data = await loadData();
// warning / warningTitle ajoutés le 11.08.2026 : un patch a inséré un second
// `warning:"…"` dans trois entrées Wingo Red qui portaient déjà un
// `warning: WINGO_RED_UNAVAILABLE_WARNING`, et le contrôle est passé au vert
// parce que la clé n'était pas surveillée. Ce sont pourtant des textes lus par
// le visiteur : un doublon lui montre autre chose que ce que dit la source.
const KEYS = ["price", "beforePrice", "verifiedAt", "sourceType", "url", "promoNote", "warning", "warningTitle"];

// Une valeur non quotée est une référence de constante (WINGO_MIGRATION_TITLE,
// WINGO_RED_UNAVAILABLE_WARNING…). La source lit l'identifiant, le site utilise
// la chaîne résolue : l'écart est normal et ne prouve aucun doublon.
const isConstRef = (s) => /^[A-Z_][A-Z0-9_]*$/.test(s);

const seen = new Map();
let bad = 0;
let checked = 0;
for (const [cat, arr] of Object.entries(data)) {
  for (const it of arr) {
    // « Swype Surf » et « Teleboy TV » existent dans deux catégories AVEC LE
    // MÊME nom et la MÊME url : ni l'un ni l'autre ne les distingue. On prend
    // donc la k-ième occurrence dans le fichier, k comptant les entrées déjà
    // traitées portant cette même signature (constaté le 11.08.2026, faux
    // positif de clé dupliquée sur Swype Surf).
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Le compteur d'occurrences doit être tenu SÉPARÉMENT pour les promos et pour
    // les offres, puisque l'appariement ci-dessous filtre déjà sur ce critère.
    // Sans ça, « Teleboy TV » côté promo héritait de k=1 et n'avait aucune
    // seconde ligne promo à trouver : l'entrée sortait du contrôle sans un mot.
    const sig = `${cat === "promo" ? "P" : "O"}|${it.name}|${it.url || ""}`;
    const k = (seen.get(sig) || 0);
    seen.set(sig, k + 1);
    // « Teleboy TV » existe dans tvData ET dans promoData, avec le même nom et la
    // même url. Prendre la k-ième occurrence dans l'ordre du fichier ne suffit pas :
    // l'entrée promoData précède l'entrée tvData dans index.html alors que loadData
    // renvoie tv avant promo, si bien que chaque entrée était comparée à la ligne de
    // l'autre et sortait en faux positif (12.08.2026). Le champ `category` n'existe
    // que sur promoData : il départage sans ambiguïté.
    const veutPromo = cat === "promo";
    const re = new RegExp(`name:"${esc(it.name)}"[^\n]*`, "g");
    let m = null, vus = 0, cand;
    while ((cand = re.exec(html)) !== null) {
      const estPromo = /category:"/.test(cand[0]);
      if (estPromo !== veutPromo) continue;
      if (vus++ === k) { m = cand; break; }
    }
    if (!m) continue;
    // Borner le segment à l'objet courant par appariement d'accolades, en
    // ignorant celles qui vivent dans une chaîne. Une fenêtre de taille fixe
    // débordait sur l'entrée suivante (Wingo International Pro héritait du
    // warningTitle de Wingo Red Swiss), et se caler sur le prochain `{name:"`
    // ne marche pas non plus : les entrées promoData ouvrent sur `{operator:"`,
    // si bien que le segment avalait des entrées entières (11.08.2026).
    const objStart = html.lastIndexOf("{", m.index);
    let depth = 0, inStr = false, end = objStart;
    for (let p = objStart; p < html.length; p++) {
      const c = html[p];
      if (inStr) {
        if (c === "\\") p++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = p + 1; break; } }
    }
    const seg = html.slice(objStart, end);
    // Comptage structurel : une clé présente deux fois dans la MÊME entrée est
    // un doublon, quelles que soient les valeurs. C'est le seul contrôle qui
    // tienne quand la première occurrence est une référence de constante et la
    // seconde un littéral — cas exact des trois Wingo Red le 11.08.2026, que la
    // comparaison de valeurs laissait passer (la première étant sautée comme
    // constante, plus rien n'était comparé).
    // On neutralise d'abord chaînes puis tableaux, sinon `priceHistory:[{…,
    // price:…}]` ferait sortir `price` en double sur presque toutes les offres.
    const skeleton = seg
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/\[[^\][]*\]/g, "[]");
    for (const k of KEYS) {
      const occurrences = (skeleton.match(new RegExp(`\\b${k}:`, "g")) || []).length;
      if (occurrences > 1) {
        console.log(`  ❌ [${cat}] ${it.name}`);
        console.log(`     ${k} : ${occurrences} occurrences dans la même entrée → clé dupliquée (JS retient la dernière)`);
        bad++;
      }
    }
    for (const k of KEYS) {
      if (it[k] === undefined) continue;
      // `\\s*` après le deux-points : sans lui, « warningTitle: CONSTANTE »
      // (avec espace) ne matchait pas et la recherche filait sur l'occurrence
      // littérale suivante.
      const found = seg.match(new RegExp(`\\b${k}:\\s*("([^"]*)"|[^,}\\s]+)`));
      if (!found) continue;
      const src = (found[2] !== undefined ? found[2] : found[1]).trim();
      if (found[2] === undefined && isConstRef(src)) continue;
      const evalv = String(it[k]);
      checked++;
      // La source porte les échappements JS (\n, \", \\), la valeur évaluée les
      // a résolus : comparer brut faisait sortir Green Internet Home, dont le
      // warning contient deux \n littéraux, en faux positif.
      const unesc = (s) => s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\(["'\\])/g, "$1");
      // tolère les écritures numériques équivalentes (25 vs 25.00)
      const same =
        unesc(src) === evalv || (!isNaN(+src) && !isNaN(+evalv) && +src === +evalv);
      if (!same) {
        console.log(`  ❌ [${cat}] ${it.name}`);
        console.log(`     ${k} : source lit « ${src} » mais le site utilise « ${evalv} » → clé dupliquée`);
        bad++;
      }
    }
  }
}
console.log(
  bad
    ? `\n${bad} divergence(s) sur ${checked} champs contrôlés — clés dupliquées à corriger`
    : `\nAucune divergence sur ${checked} champs contrôlés ✅`
);
process.exit(bad ? 1 : 0);
