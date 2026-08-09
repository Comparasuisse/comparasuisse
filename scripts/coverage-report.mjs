// Inventaire de couverture : 100% des offres du catalogue avec leur verifiedAt.
//
// Répond à une exigence non négociable : un AUDIT COMPLET doit PROUVER qu'aucune
// offre n'a été oubliée, par un inventaire ligne par ligne — pas par un résumé
// des écarts trouvés. Motivé par le cas Salt Travel Max (10.08.2026), promo à
// -43% restée invisible six scans d'affilée sans figurer dans aucun récap.
//
//   node scripts/coverage-report.mjs            # inventaire complet
//   node scripts/coverage-report.mjs --stale 7  # seulement les >= 7 jours
//   node scripts/coverage-report.mjs --md       # sortie Markdown (data/)

import fs from "fs";
import { loadData, isNonVerifiableUrl } from "./lib/audit-lib.mjs";

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const STALE = parseInt(arg("stale") || "0", 10);
const AS_MD = process.argv.includes("--md");

function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const TODAY = todayLocalISO();
const days = (iso) =>
  !iso ? Infinity : Math.round((new Date(TODAY) - new Date(iso)) / 86400000);

const data = await loadData();
const rows = [];
for (const [cat, arr] of Object.entries(data))
  for (const it of arr)
    rows.push({
      cat,
      name: String(it.name),
      price: it.price,
      verifiedAt: it.verifiedAt || null,
      age: days(it.verifiedAt),
      whitelisted: it.url ? isNonVerifiableUrl(it.url) : false,
      url: it.url || "",
    });

rows.sort((a, b) => b.age - a.age || a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
const shown = STALE ? rows.filter((r) => r.age >= STALE) : rows;

const line = (r) =>
  `${r.cat.padEnd(9)} ${r.name.slice(0, 44).padEnd(45)} ${String(r.price ?? "—").padStart(7)}  ${(r.verifiedAt || "JAMAIS").padEnd(11)} ${r.age === Infinity ? "  ∞" : String(r.age).padStart(3)}j${r.whitelisted ? "  [whitelist]" : ""}`;

if (AS_MD) {
  const out = [
    `# Couverture de vérification — ${TODAY}`,
    "",
    `Total : **${rows.length} offres**. Inventaire ligne par ligne, trié du plus ancien au plus récent.`,
    "",
    "| Catégorie | Offre | Prix | verifiedAt | Âge | Note |",
    "|---|---|---|---|---|---|",
    ...shown.map(
      (r) =>
        `| ${r.cat} | ${r.name.replace(/\|/g, "/")} | ${r.price ?? "—"} | ${r.verifiedAt || "**jamais**"} | ${r.age === Infinity ? "∞" : r.age + " j"} | ${r.whitelisted ? "whitelist NON_VÉRIFIABLE" : ""} |`
    ),
  ].join("\n");
  const p = `C:/Users/cicer/Documents/comparasuisse/data/coverage-${TODAY}.md`;
  fs.writeFileSync(p, out);
  console.log(`Écrit : ${p} (${shown.length} lignes)`);
} else {
  console.log(`INVENTAIRE DE COUVERTURE — ${TODAY} — ${rows.length} offres\n`);
  shown.forEach((r) => console.log(line(r)));
}

// Synthèse
const buckets = {
  "vérifiées aujourd'hui": rows.filter((r) => r.age === 0).length,
  "1 à 3 jours": rows.filter((r) => r.age >= 1 && r.age <= 3).length,
  "4 à 7 jours": rows.filter((r) => r.age >= 4 && r.age <= 7).length,
  "8 à 14 jours": rows.filter((r) => r.age >= 8 && r.age <= 14).length,
  "plus de 14 jours": rows.filter((r) => r.age > 14 && r.age !== Infinity).length,
  "JAMAIS vérifiées": rows.filter((r) => r.age === Infinity).length,
};
console.log(`\n=== SYNTHÈSE (${rows.length} offres) ===`);
for (const [k, v] of Object.entries(buckets))
  console.log(`  ${k.padEnd(24)} ${String(v).padStart(4)}  ${((v / rows.length) * 100).toFixed(1)}%`);
console.log(`  dont whitelistées NON_VÉRIFIABLE : ${rows.filter((r) => r.whitelisted).length}`);
