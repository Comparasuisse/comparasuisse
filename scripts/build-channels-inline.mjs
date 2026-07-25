// Génère data/channels-inline.js — snippets JS prêts à copier dans index.html
// pour populer channelsList sur les offres où on a extrait une vraie liste.
// Reste de la pipeline : cf. scripts/fetch-channels.mjs.

import fs from "node:fs";

const d = JSON.parse(fs.readFileSync("data/channels.json", "utf8"));

// JSON.stringify garantit un échappement JS correct (guillemets, unicode).
const arr = (a) => JSON.stringify(a);
const obj = (o) => JSON.stringify(o);

const out = [];
out.push("// Snippets channelsList à copier dans index.html.");
out.push("// Régénérer avec :  node scripts/build-channels-inline.mjs");
out.push("// Source : data/channels.json (généré par scripts/fetch-channels.mjs)");
out.push("");

const write = (label, expr) => {
  out.push("// === " + label + " ===");
  out.push(expr);
  out.push("");
};

if (d["wingo-tv-max"]?.flat) {
  write("Wingo TV Max — tvData / promoData / comboData Wingo Internet+TV",
    "channelsList: " + arr(d["wingo-tv-max"].flat));
}
if (d.teleboy?.flat) {
  write("Teleboy TV — tvData + promoData",
    "channelsList: " + arr(d.teleboy.flat));
}
if (d["netplus-tv"]?.flat) {
  write("Netplus TV App / Netplus TV Box (même catalogue)",
    "channelsList: " + arr(d["netplus-tv"].flat));
}
if (d.canalplus?.categorized) {
  const c = d.canalplus.categorized;
  const sport = c["CANAL+ Sport (18 chaînes sport)"] || [];
  const cine = c["CANAL+ Ciné Séries (22 chaînes + Paramount+ / Apple TV+)"] || [];
  const streaming = c["Streaming inclus (Ciné Séries & La Totale)"] || [];
  write("CANAL+ Sport", "channelsList: " + obj({ "Chaînes sport (18)": sport }));
  write("CANAL+ Ciné Séries",
    "channelsList: " + obj({ "Chaînes cinéma et séries (22)": cine, "Streaming inclus": streaming }));
  write("CANAL+ La Totale (Sport ∪ Ciné Séries)",
    "channelsList: " + obj({ "Sport (18)": sport, "Cinéma & Séries (22)": cine, "Streaming inclus": streaming }));
}

fs.writeFileSync("data/channels-inline.js", out.join("\n"));
console.log("✅ Écrit data/channels-inline.js (" + out.length + " lignes)");
