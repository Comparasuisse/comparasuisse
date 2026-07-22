#!/usr/bin/env node
// Met à jour les <lastmod> de sitemap.xml pour les URLs correspondant aux
// chemins passés en argument. Utilisé par le hook git pre-commit — cf.
// .githooks/pre-commit — pour que le sitemap reflète vraiment les changements
// de contenu, pas juste la date de création du fichier.
//
// Usage : node scripts/update-sitemap.mjs <chemin> [chemin...]
//   - `index.html` matche l'URL racine (https://comparasuisse.ch/)
//   - tout autre chemin matche `https://comparasuisse.ch/<chemin>`

import fs from "node:fs";

const SITEMAP = "sitemap.xml";
const paths = process.argv.slice(2);

if (paths.length === 0) {
  console.log("update-sitemap: aucun chemin fourni, rien à faire");
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
let xml = fs.readFileSync(SITEMAP, "utf8");
let anyChange = false;

for (const p of paths) {
  const suffix = p === "index.html" ? "/" : "/" + p.replace(/^\//, "");
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `(<url>[\\s\\S]*?<loc>[^<]*${escaped}</loc>[\\s\\S]*?<lastmod>)[^<]*(</lastmod>)`,
    "g"
  );
  if (!xml.match(regex)) {
    console.log(`update-sitemap: ${suffix} non trouvé dans sitemap.xml`);
    continue;
  }
  const updated = xml.replace(regex, `$1${today}$2`);
  if (updated !== xml) {
    xml = updated;
    console.log(`update-sitemap: ${suffix} → lastmod ${today}`);
    anyChange = true;
  } else {
    console.log(`update-sitemap: ${suffix} déjà à jour (${today})`);
  }
}

if (anyChange) {
  fs.writeFileSync(SITEMAP, xml);
}
