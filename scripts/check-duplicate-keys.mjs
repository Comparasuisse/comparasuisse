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
const KEYS = ["price", "beforePrice", "verifiedAt", "sourceType", "url", "promoNote"];

let bad = 0;
let checked = 0;
for (const [cat, arr] of Object.entries(data)) {
  for (const it of arr) {
    const anchor = `name:"${String(it.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`;
    const m = html.match(new RegExp(anchor));
    if (!m) continue;
    const seg = html.slice(m.index, m.index + 2500);
    for (const k of KEYS) {
      if (it[k] === undefined) continue;
      const found = seg.match(new RegExp(`\\b${k}:("([^"]*)"|[^,}\\s]+)`));
      if (!found) continue;
      const src = (found[2] !== undefined ? found[2] : found[1]).trim();
      const evalv = String(it[k]);
      checked++;
      // tolère les écritures numériques équivalentes (25 vs 25.00)
      const same = src === evalv || (!isNaN(+src) && !isNaN(+evalv) && +src === +evalv);
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
