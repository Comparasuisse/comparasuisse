// Construit le tableau travelData de l'onglet Voyage à partir des six
// collectes brutes de data/voyage-*.json (cf. VOYAGE-ESIM.md).
//
// Pourquoi un générateur plutôt qu'une saisie : 348 offres écrites à la main
// seraient 348 occasions de se tromper, et surtout impossibles à rafraîchir.
// Les collecteurs produisent la donnée, ce script la met en forme, index.html
// la consomme. Une revérification consiste à relancer les collecteurs puis ce
// script — pas à rouvrir 348 lignes.
//
// Trois décisions de modélisation méritent d'être dites :
//
// 1. **Le prix converti.** Ubigi facture en USD et Yesim en EUR. Trier en
//    mélangeant trois devises serait faux, et faux au détriment des moins
//    chers. Chaque offre porte donc son prix d'origine (`price` + `currency`,
//    ce que le visiteur paiera réellement) et un `priceCHF` qui ne sert qu'au
//    tri et à la comparaison. Le taux et sa date sont affichés dans l'onglet :
//    annoncer un montant en francs qui n'existe sur aucune page fournisseur
//    demande de dire d'où il sort.
//
// 2. **La couverture.** Ubigi et Holafly publient la liste des pays en ISO ;
//    les quatre autres n'annoncent qu'un nombre. On garde ce qu'on a, offre
//    par offre, sans jamais compléter par déduction : « Europe » ne couvre pas
//    le même périmètre chez Airalo (41 pays) et chez Yesim (33).
//
// 3. **Ce qui est exclu.** Les offres marquées horsPerimetre par les
//    collecteurs — formules à 12 mois, abonnements reconductibles, durées de
//    90 jours et plus — ne passent pas. Elles restent dans les fichiers de
//    collecte au cas où le périmètre changerait.
//
//   node scripts/build-travel-data.mjs            → aperçu, sans rien écrire
//   node scripts/build-travel-data.mjs --write    → écrit data/travel-data.js
//   node scripts/build-travel-data.mjs --inject   → remplace TRAVEL_FX et
//                                                   travelData dans index.html
//
// Seul le tableau est généré : le rendu, les filtres et la recherche de
// l'onglet vivent dans index.html et s'éditent normalement. --inject ne touche
// qu'au bloc délimité par « const TRAVEL_FX » et le « ]; » qui ferme
// travelData ; tout le reste du fichier est laissé intact.

import fs from "fs";

// Taux BCE relevés le 13.08.2026 via api.frankfurter.dev (1 CHF = 1.2306 USD,
// 1 CHF = 1.0669 EUR). À rafraîchir en même temps que les collectes.
const TAUX = { CHF: 1, USD: 0.8126, EUR: 0.9373 };
const TAUX_DATE = "2026-08-13";
const VERIFIED_AT = "2026-08-13";

// Chaque collecteur nomme ses destinations à sa façon. Table unique de
// correspondance vers les six libellés de l'onglet.
const DESTINATIONS = {
  europe: "Europe",
  "esim-europe": "Europe",
  "regions/europe": "Europe",
  "esim-royaume-uni": "Royaume-Uni",
  EUROPE: "Europe",
  "united-kingdom": "Royaume-Uni",
  "esim-united-kingdom": "Royaume-Uni",
  "country/united-kingdom": "Royaume-Uni",
  UK: "Royaume-Uni",
  "united-states": "États-Unis",
  "esim-united-states": "États-Unis",
  "country/united-states": "États-Unis",
  "esim-usa": "États-Unis",
  USA: "États-Unis",
  canada: "Canada",
  "esim-canada": "Canada",
  "country/canada": "Canada",
  CANADA: "Canada",
  turkey: "Turquie",
  "esim-turkey": "Turquie",
  "country/turkey": "Turquie",
  "esim-turquie": "Turquie",
  TURKEY: "Turquie",
  discover: "Monde",
  global: "Monde",
  "esim-global": "Monde",
  "esim-le-monde": "Monde",
  "global/global-plus-package-esim": "Monde",
  WORLD: "Monde",
};

// Faits établis fournisseur par fournisseur (cf. VOYAGE-ESIM.md § 3 et 3 bis).
// null n'est pas « non » : c'est « pas vérifié », et la carte le dira ainsi.
const FOURNISSEURS = {
  Airalo: { calls: "non", hotspot: null },
  Saily: {
    calls: "option", // numéro américain vendu séparément
    hotspot: null,
    noteIllimite: "3 Go/jour à pleine vitesse, puis 1 Mb/s",
  },
  Nomad: {
    calls: "non",
    hotspot: true,
    noteIllimite: "2 Go/jour en 4G/5G, puis 1 Mbit/s",
  },
  Holafly: {
    calls: "non",
    hotspot: true,
    hotspotNote: "partage plafonné à 1 Go/jour",
    noteIllimite: "Always On : 1 Go/mois de secours une fois l'illimité épuisé",
  },
  Ubigi: { calls: "non", hotspot: true, noteIllimite: "Fair Use Policy applicable" },
  Yesim: { calls: "non", hotspot: true },
};

const arrondi = (n) => Math.round(n * 100) / 100;

function volumeTexte(dataGB, unlimited) {
  if (unlimited) return "illimité";
  if (typeof dataGB !== "number" || !Number.isFinite(dataGB)) return "";
  return dataGB < 1 ? `${Math.round(dataGB * 1000)} Mo` : `${dataGB} Go`;
}

const offres = [];
const fichiers = ["airalo", "saily", "nomad", "holafly", "ubigi", "yesim"];

for (const nom of fichiers) {
  const chemin = `data/voyage-${nom}.json`;
  if (!fs.existsSync(chemin)) {
    console.error(`manquant : ${chemin}`);
    continue;
  }
  for (const rec of JSON.parse(fs.readFileSync(chemin, "utf8"))) {
    const destination = DESTINATIONS[rec.slug];
    if (!destination) {
      console.error(`destination inconnue : ${rec.provider} / ${rec.slug}`);
      continue;
    }
    const f = FOURNISSEURS[rec.provider] || {};
    for (const p of rec.plans || []) {
      if (p.horsPerimetre) continue;
      const currency = p.currency || "CHF";
      const taux = TAUX[currency];
      if (!taux) {
        console.error(`devise sans taux : ${currency} (${rec.provider})`);
        continue;
      }
      const unlimited = p.unlimited === true || p.dataGB === "Infinity";
      const dataGB = unlimited ? Infinity : typeof p.dataGB === "number" ? p.dataGB : null;
      const vol = volumeTexte(dataGB, unlimited);

      // La nuance sur l'illimité vient du fournisseur quand il la publie, du
      // plan quand le collecteur l'a relevée sur place.
      const dataNote = unlimited ? p.dataNote || f.noteIllimite || null : null;

      // Couverture : la liste ISO n'existe que chez Ubigi et Holafly. Ailleurs
      // on ne dispose que d'un nombre annoncé, et on ne le complète pas.
      const countries = Array.isArray(p.countries) && p.countries.length ? p.countries : rec.meta && Array.isArray(rec.meta.countries) && rec.meta.countries.length ? rec.meta.countries : null;
      const countryCount =
        typeof p.countryCount === "number" && p.countryCount
          ? p.countryCount
          : rec.meta && typeof rec.meta.couverture === "number"
            ? rec.meta.couverture
            : countries
              ? countries.length
              : null;

      offres.push({
        provider: rec.provider,
        name: `${rec.provider} ${destination} — ${p.days} j, ${vol}`,
        destination,
        days: p.days,
        dataGB,
        dataNote,
        price: arrondi(p.price),
        currency,
        priceCHF: arrondi(p.price * taux),
        beforePrice: typeof p.beforePrice === "number" ? arrondi(p.beforePrice) : null,
        countries,
        countryCount,
        callsIncluded: f.calls || null,
        hotspot: f.hotspot === undefined ? null : f.hotspot,
        hotspotNote: f.hotspotNote || null,
        url: p.url || rec.url,
        sourceType: "product-page",
        verifiedAt: VERIFIED_AT,
      });
    }
  }
}

// Tri : destination, puis prix CHF croissant — l'ordre dans lequel l'onglet les
// rendra par défaut.
const ordreDest = ["Europe", "Royaume-Uni", "États-Unis", "Canada", "Turquie", "Monde"];
offres.sort(
  (a, b) =>
    ordreDest.indexOf(a.destination) - ordreDest.indexOf(b.destination) ||
    a.priceCHF - b.priceCHF ||
    a.provider.localeCompare(b.provider)
);

// ── Contrôles avant écriture ────────────────────────────────────────────────
const erreurs = [];
const parDest = {};
const parProv = {};
for (const o of offres) {
  parDest[o.destination] = (parDest[o.destination] || 0) + 1;
  parProv[o.provider] = (parProv[o.provider] || 0) + 1;
  if (!(o.priceCHF > 0)) erreurs.push(`prix nul ou négatif : ${o.name}`);
  if (!(o.days >= 1 && o.days <= 31)) erreurs.push(`durée hors périmètre : ${o.name} (${o.days} j)`);
  if (!/^https?:\/\//.test(o.url || "")) erreurs.push(`URL absente : ${o.name}`);
  if (o.currency !== "CHF" && o.priceCHF === o.price) erreurs.push(`conversion non appliquée : ${o.name}`);
}
// Un fournisseur dont toutes les offres d'une destination sortent au même prix
// est le symptôme d'un sélecteur mal piloté (cf. le cas Holafly).
for (const prov of Object.keys(parProv)) {
  for (const dest of ordreDest) {
    const lot = offres.filter((o) => o.provider === prov && o.destination === dest);
    if (lot.length > 2 && new Set(lot.map((o) => o.price)).size === 1)
      erreurs.push(`prix identique sur ${lot.length} offres : ${prov} / ${dest}`);
  }
}

console.log(`${offres.length} offres retenues`);
console.log("par destination :", JSON.stringify(parDest));
console.log("par fournisseur :", JSON.stringify(parProv));
console.log(`devises : ${JSON.stringify(Object.fromEntries(["CHF", "USD", "EUR"].map((c) => [c, offres.filter((o) => o.currency === c).length])))}`);

if (erreurs.length) {
  console.error("\n✗ " + erreurs.length + " anomalie(s) :");
  erreurs.slice(0, 20).forEach((e) => console.error("  " + e));
  process.exit(1);
}

const ecrire = process.argv.includes("--write");
const injecter = process.argv.includes("--inject");

if (ecrire || injecter) {
  const ligne = (o) =>
    "  {" +
    [
      `provider:${JSON.stringify(o.provider)}`,
      `name:${JSON.stringify(o.name)}`,
      `destination:${JSON.stringify(o.destination)}`,
      `days:${o.days}`,
      `dataGB:${o.dataGB === Infinity ? "Infinity" : o.dataGB}`,
      o.dataNote ? `dataNote:${JSON.stringify(o.dataNote)}` : null,
      `price:${o.price.toFixed(2)}`,
      `currency:${JSON.stringify(o.currency)}`,
      `priceCHF:${o.priceCHF.toFixed(2)}`,
      o.beforePrice ? `beforePrice:${o.beforePrice.toFixed(2)}` : null,
      o.countries ? `countries:${JSON.stringify(o.countries)}` : null,
      o.countryCount ? `countryCount:${o.countryCount}` : null,
      `callsIncluded:${JSON.stringify(o.callsIncluded)}`,
      `hotspot:${o.hotspot === null ? "null" : o.hotspot}`,
      o.hotspotNote ? `hotspotNote:${JSON.stringify(o.hotspotNote)}` : null,
      `url:${JSON.stringify(o.url)}`,
      `sourceType:"product-page"`,
      `verifiedAt:${JSON.stringify(o.verifiedAt)}`,
    ]
      .filter(Boolean)
      .join(", ") +
    "}";

  const sortie =
    `// Généré par scripts/build-travel-data.mjs — ne pas éditer à la main.\n` +
    `// Source : data/voyage-*.json. Taux de change du ${TAUX_DATE}.\n` +
    `const TRAVEL_FX = ${JSON.stringify({ date: TAUX_DATE, ...TAUX })};\n` +
    `const travelData = [\n` +
    offres.map(ligne).join(",\n") +
    `\n];\n`;

  if (ecrire) {
    fs.writeFileSync("data/travel-data.js", sortie);
    console.log(`\nÉcrit : data/travel-data.js (${sortie.length} caractères)`);
  }

  if (injecter) {
    const F = "index.html";
    let h = fs.readFileSync(F, "utf8");
    // Le bloc va du commentaire d'en-tête au « ]; » qui ferme travelData. On
    // ancre sur les deux bornes plutôt que sur un compte de lignes : le reste
    // du fichier bouge, elles non.
    const re = /\/\/ Généré par scripts\/build-travel-data\.mjs[\s\S]*?\nconst travelData = \[[\s\S]*?\n\];\n/;
    if (!re.test(h)) {
      console.error("\n✗ bloc travelData introuvable dans index.html — injection annulée.");
      process.exit(1);
    }
    const avant = h.length;
    h = h.replace(re, sortie);
    fs.writeFileSync(F, h);
    console.log(`\nInjecté dans index.html : ${avant} → ${h.length} caractères`);
    console.log("Pensez à relancer  node scripts/qa-quick.mjs");
  }
}
