// Ajoute un point à la priceHistory d'une offre dans index.html.
// À utiliser à la main quand tu corriges un prix suite à une vérif directe
// (pas via audit-random.mjs qui automatise ce cas).
//
// Usage :
//   node scripts/append-price-point.mjs "<name exact>" <price>
//   node scripts/append-price-point.mjs "CANAL+ Ciné Séries" 24.90
//   node scripts/append-price-point.mjs "Mucho Nano" 4.50
//
// Comportement :
// - Idempotent : ne double pas un point si (date == aujourd'hui && price == identique).
// - Bumpe verifiedAt à la date du jour aussi.
// - N'ajoute PAS de priceHistory si l'offre n'a pas encore verifiedAt : il faut d'abord
//   documenter la source (feature du workflow CHECKLIST-OFFRE.md).

import fs from "node:fs";
import { verifyIndexHtmlSyntax } from "./lib/verify-index-syntax.mjs";

// Wrapper local : backup + write + verify. Restaure + exit(1) si syntaxe cassée.
function safeWriteIndex(newContent) {
  const bak = ".index.html.append-price-point.bak";
  fs.copyFileSync("index.html", bak);
  fs.writeFileSync("index.html", newContent);
  verifyIndexHtmlSyntax({ backupPath: bak });
  try { fs.unlinkSync(bak); } catch {}
}

const [, , nameArg, priceArg] = process.argv;
if (!nameArg || !priceArg) {
  console.error(`Usage : node scripts/append-price-point.mjs "<name>" <price>`);
  process.exit(2);
}
const price = parseFloat(priceArg);
if (isNaN(price)) {
  console.error(`Prix invalide : "${priceArg}"`);
  process.exit(2);
}

const today = new Date().toISOString().slice(0, 10);
const nameEsc = nameArg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let html = fs.readFileSync("index.html", "utf8");

// Cas 1 : l'offre a déjà un champ priceHistory → append (avec idempotence)
const withHistoryRe = new RegExp(
  `(name:"${nameEsc}"[^}]*?priceHistory:\\[)([^\\]]*)(\\])`,
  ""
);
const mWith = html.match(withHistoryRe);
if (mWith) {
  const existing = mWith[2].trim();
  const lastMatch = existing.match(/\{date:"([^"]+)",price:([\d.]+)\}(?!.*\{date:)/);
  if (lastMatch && lastMatch[1] === today && parseFloat(lastMatch[2]) === price) {
    console.log(`⏭  Point identique déjà présent (${today} · ${price}) — aucun changement`);
    process.exit(0);
  }
  const newPoint = (existing ? "," : "") + `{date:"${today}",price:${price}}`;
  html = html.replace(withHistoryRe, `$1$2${newPoint}$3`);
  // Aussi bump verifiedAt
  const verifRe = new RegExp(`(name:"${nameEsc}"[^}]*?verifiedAt:")[^"]+(")`, "");
  html = html.replace(verifRe, `$1${today}$2`);
  safeWriteIndex(html);
  console.log(`✅ Point ajouté à priceHistory de "${nameArg}" : ${today} · CHF ${price.toFixed(2)}`);
  console.log(`   verifiedAt aussi bumpé à ${today}`);
  process.exit(0);
}

// Cas 2 : pas encore de priceHistory mais verifiedAt présent → créer priceHistory
const withVerifRe = new RegExp(`(name:"${nameEsc}"[^}]*?verifiedAt:")[^"]+(")`, "");
if (withVerifRe.test(html)) {
  html = html.replace(withVerifRe, `$1${today}$2, priceHistory:[{date:"${today}",price:${price}}]`);
  safeWriteIndex(html);
  console.log(`✅ priceHistory créé pour "${nameArg}" : [${today} · CHF ${price.toFixed(2)}]`);
  console.log(`   Note : 1 seul point → pas encore de graphique visible (règle : ≥ 2 points)`);
  process.exit(0);
}

// Cas 3 : offre sans verifiedAt → refuser (workflow exige de documenter la source d'abord)
console.error(`❌ L'offre "${nameArg}" n'a pas encore de verifiedAt.`);
console.error(`   Le workflow exige de documenter d'abord la source (sourceType + verifiedAt)`);
console.error(`   avant d'ajouter un point d'historique. Voir CHECKLIST-OFFRE.md.`);
process.exit(1);
