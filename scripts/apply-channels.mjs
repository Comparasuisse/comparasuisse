// Applique les listes de chaînes extraites (data/channels.json) aux entrées
// tvData / promoData / comboData de index.html.
//
// Idempotent : si channelsList est déjà présent sur une entrée, il est remplacé.
// Réutilisable : à relancer après chaque `node scripts/fetch-channels.mjs`.
//
// Usage :  node scripts/apply-channels.mjs

import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const channels = JSON.parse(fs.readFileSync("data/channels.json", "utf8"));

// Table de correspondance : quelle liste on injecte pour quel `name:` d'entrée.
// La clé est une regex qui match le champ `name:"..."` unique dans l'entrée.
// La valeur est le champ channelsList à insérer (déjà JSON-serializé).
const MAPPING = [];

const push = (nameRegex, value) => MAPPING.push({ nameRegex, value });

// --- Wingo TV Max (tvData + promoData + comboData Wingo Internet + TV Max) ---
if (channels["wingo-tv-max"]?.flat) {
  const list = JSON.stringify(channels["wingo-tv-max"].flat);
  push(/name:"Wingo TV Max"/, list);
  push(/name:"Internet \+ TV Max"/, list); // combo
}

// --- Teleboy TV (tvData + promoData) ---
if (channels.teleboy?.flat) {
  const list = JSON.stringify(channels.teleboy.flat);
  push(/name:"Teleboy TV"/, list);
}

// --- Netplus TV App + Netplus TV Box (même catalogue) ---
if (channels["netplus-tv"]?.flat) {
  const list = JSON.stringify(channels["netplus-tv"].flat);
  push(/name:"Netplus TV App"/, list);
  push(/name:"Netplus TV Box"/, list);
}

// --- CANAL+ Sport / Ciné Séries / La Totale ---
if (channels.canalplus?.categorized) {
  const c = channels.canalplus.categorized;
  const sport = c["CANAL+ Sport (18 chaînes sport)"] || [];
  const cine = c["CANAL+ Ciné Séries (22 chaînes + Paramount+ / Apple TV+)"] || [];
  const streaming = c["Streaming inclus (Ciné Séries & La Totale)"] || [];
  push(/name:"CANAL\+ Sport"/, JSON.stringify({ "Chaînes sport (18)": sport }));
  push(/name:"CANAL\+ Ciné Séries"/, JSON.stringify({
    "Chaînes cinéma et séries (22)": cine,
    "Streaming inclus": streaming,
  }));
  push(/name:"CANAL\+ La Totale"/, JSON.stringify({
    "Sport (18)": sport,
    "Cinéma & Séries (22)": cine,
    "Streaming inclus": streaming,
  }));
}

let patched = html;
let hits = 0;
let misses = [];
for (const { nameRegex, value } of MAPPING) {
  // Retirer un channelsList existant sur la même entrée (pour l'idempotence).
  // Puis insérer/mettre à jour avant `, url:`.
  const entryRegex = new RegExp(
    "\\{[^{}]*?" + nameRegex.source + "[^{}]*?\\}",
    "g"
  );
  const matches = patched.match(entryRegex);
  if (!matches || matches.length === 0) {
    misses.push(nameRegex.source);
    continue;
  }
  for (const entry of matches) {
    let updated = entry.replace(/,\s*channelsList:\s*(\{[^}]*\}|\[[^\]]*\])/g, "");
    // Injecter avant `, url:` (systématiquement présent en dernier)
    updated = updated.replace(/(,\s*url:")/, ", channelsList: " + value + "$1");
    if (updated !== entry) {
      patched = patched.replace(entry, updated);
      hits++;
    }
  }
}

if (misses.length) {
  console.warn("⚠️ Aucun match pour :\n  " + misses.join("\n  "));
}
if (hits === 0) {
  console.error("❌ Aucune insertion. Rien écrit.");
  process.exit(1);
}

fs.writeFileSync("index.html", patched);
console.log(`✅ ${hits} entrées patchées avec channelsList dans index.html`);
