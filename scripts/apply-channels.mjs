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

// --- yallo TV standalone + combo Home Supermax + TV (même catalogue) ---
if (channels["yallo-tv"]?.flat) {
  const list = JSON.stringify(channels["yallo-tv"].flat);
  push(/name:"yallo TV"/, list);
  push(/name:"Home Supermax \+ TV"/, list); // combo yallo
}

// --- Zattoo Premium / Ultimate + combo Zattoo HOME ---
// Free/Premium/Ultimate sont incluses en cascade : Premium = Free ∪ 90+, Ultimate = Premium ∪ marginal
if (channels.zattoo?.categorized) {
  const zc = channels.zattoo.categorized;
  const free = zc[Object.keys(zc).find((k) => k.startsWith("Free"))] || [];
  const prem = zc[Object.keys(zc).find((k) => k.startsWith("Premium"))] || [];
  const ult = zc[Object.keys(zc).find((k) => k.startsWith("Ultimate"))] || [];
  push(/name:"Zattoo Premium"/, JSON.stringify({
    [`Chaînes Premium (${prem.length})`]: prem,
    [`Dont Free (${free.length}) — également accessible sans abo`]: free,
  }));
  push(/name:"Zattoo Ultimate"/, JSON.stringify({
    [`Chaînes Ultimate (${ult.length})`]: ult,
    [`Dont Free (${free.length}) — également accessible sans abo`]: free,
  }));
  push(/name:"Zattoo HOME \(Premium ou Ultimate\)"/, JSON.stringify({
    [`Chaînes Premium (${prem.length})`]: prem,
    [`Chaînes Ultimate ajoutées (${Math.max(0, ult.length - prem.length)}) — visible avec la variante ULTIMATE`]:
      ult.filter((c) => !prem.includes(c)),
  }));
}

// --- Swisscom blue TV S / M / L / XL Sport / XL Streaming + combo blue Internet + TV ---
// Catalogue commun aux packs, la différence se joue sur le nombre inclus par pack.
if (channels["swisscom-blue-tv"]?.flat) {
  const list = JSON.stringify(channels["swisscom-blue-tv"].flat);
  push(/name:"blue TV S"/, list);
  push(/name:"blue TV M"/, list);
  push(/name:"blue TV L"/, list);
  push(/name:"blue TV XL Sport"/, list);
  push(/name:"blue TV XL Streaming"/, list);
  push(/name:"blue Internet \+ TV"/, list);
}

// --- iWay TV Classic / Premium / Top (catalogue commun via API iWay) ---
if (channels["iway-tv"]?.flat) {
  const list = JSON.stringify(channels["iway-tv"].flat);
  push(/name:"iWay TV Classic"/, list);
  push(/name:"iWay TV Premium"/, list);
  push(/name:"iWay TV Top"/, list);
}

// --- Teleking KingTV Silber / Gold / Platin ---
if (channels.teleking?.categorized) {
  const tc = channels.teleking.categorized;
  const silber = tc[Object.keys(tc).find((k) => k.startsWith("Silber"))] || [];
  const gold = tc[Object.keys(tc).find((k) => k.startsWith("Gold"))] || [];
  const platin = tc[Object.keys(tc).find((k) => k.startsWith("Platin"))] || [];
  push(/name:"KingTV-Silber"/, JSON.stringify(silber));
  push(/name:"KingTV-Gold"/, JSON.stringify(gold));
  push(/name:"KingTV-Platin"/, JSON.stringify(platin));
}

// --- Init7 TV7 ---
if (channels["init7-tv7"]?.flat) {
  push(/name:"Init7 TV7"/, JSON.stringify(channels["init7-tv7"].flat));
}

// --- Talk Talk Surf 100 + TV ---
if (channels["talktalk-tv"]?.flat) {
  push(/name:"Surf 100 \+ TV"/, JSON.stringify(channels["talktalk-tv"].flat));
}

let patched = html;
let hits = 0;
let misses = [];
for (const { nameRegex, value } of MAPPING) {
  // Retirer un channelsList existant sur la même entrée (pour l'idempotence).
  // Puis insérer/mettre à jour avant `, url:`.
  // Regex tolérant les accolades imbriquées à 1 niveau (priceHistory:[{...}], channelsList:{...}).
  const entryRegex = new RegExp(
    "\\{(?:[^{}]|\\{[^{}]*\\})*?" + nameRegex.source + "(?:[^{}]|\\{[^{}]*\\})*?\\}",
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
