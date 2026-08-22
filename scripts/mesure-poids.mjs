// Décompose le poids d'index.html : JS inline, CSS, JSON-LD, et surtout la
// part des tableaux de catalogue dans le JavaScript. C'est le chiffre sur
// lequel repose le chantier B9 (cf. seo/baseline-b9.md) : 82 % du JS de ce
// site est un catalogue, pas du code — donc externalisable.
//
//   node scripts/mesure-poids.mjs

import fs from "node:fs";
const h = fs.readFileSync("index.html", "utf8");
const ko = (s) => Math.round(Buffer.byteLength(s, "utf8") / 1024);
const scripts = [...h.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("");
const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("");
const css = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("");
const jsPur = ko(scripts) - ko(ld);

console.log(`index.html          ${String(ko(h)).padStart(4)} Ko`);
console.log(`  JS inline         ${String(jsPur).padStart(4)} Ko`);
console.log(`  JSON-LD           ${String(ko(ld)).padStart(4)} Ko`);
console.log(`  CSS inline        ${String(ko(css)).padStart(4)} Ko`);
console.log();
console.log("--- part des tableaux de données dans le JS inline ---");
let total = 0;
const tailles = {};
for (const nom of ["mobileData", "prepaidData", "internetData", "dataOnlyData", "tvData", "comboData", "promoData", "travelData"]) {
  const m = h.match(new RegExp(`const ${nom} = \\[[\\s\\S]*?\\n\\];`));
  if (!m) { console.log(`  ${nom.padEnd(14)} absent`); continue; }
  const k = ko(m[0]);
  tailles[nom] = k;
  total += k;
  console.log(`  ${nom.padEnd(14)} ${String(k).padStart(4)} Ko`);
}
console.log("  " + "-".repeat(20));
console.log(`  données        ${String(total).padStart(4)} Ko  = ${Math.round((100 * total) / jsPur)} % du JS inline`);
console.log(`  logique        ${String(jsPur - total).padStart(4)} Ko  = ${Math.round((100 * (jsPur - total)) / jsPur)} %`);
console.log();
console.log("--- ce que porterait chaque page si le catalogue était découpé ---");
const parPage = {
  "/mobile/": ["mobileData"], "/prepaid/": ["prepaidData"], "/internet/": ["internetData"],
  "/dataonly/": ["dataOnlyData"], "/tv/": ["tvData"], "/combo/": ["comboData"],
  "/promotions/": ["promoData"], "/voyage/": ["travelData"],
  "/couverture-reseau/": [], "/comparateur/": Object.keys(tailles),
};
for (const [page, arrs] of Object.entries(parPage)) {
  const k = arrs.reduce((s, n) => s + (tailles[n] || 0), 0);
  console.log(`  ${page.padEnd(20)} ${String(k).padStart(4)} Ko  (au lieu de ${total} Ko)`);
}
