// Collecte des forfaits eSIM Holafly — chantier Voyage (cf. VOYAGE-ESIM.md).
//
// Holafly ne vend qu'un produit par destination — données illimitées — dont le
// prix dépend du nombre de jours. Il n'y a donc pas une grille de forfaits à
// lire mais un tarif par durée.
//
// ── Comment on lit le prix, et pourquoi pas autrement ────────────────────────
//
// Le sélecteur de durée a résisté à trois tentatives de pilotage (clic
// programmatique, sélection par plage, clic natif Playwright), toutes soldées
// par un déclencheur bloqué sur « 1 » et par huit durées au même prix. Le
// navigateur réel a fini par montrer pourquoi : le panneau derrière
// #calendarTrigger n'est pas une liste de durées mais un vrai calendrier de
// dates, où l'on pose une date d'arrivée puis une date de retour. Piloter ça
// au clic pour 61 durées × 6 destinations aurait été long et fragile.
//
// Il n'y en a pas besoin. Le site est un Astro, et Astro sérialise les props de
// ses îlots dans le DOM : <astro-island component-url=".../ProductPricing.js"
// props="…"> porte les 90 variantes du produit, de 1 à 90 jours, chacune avec
// son prix dans une vingtaine de devises — CHF compris. C'est la source dont
// le composant se sert lui-même pour afficher le total. On la lit directement,
// sans toucher au calendrier, et le résultat est vérifiable : la variante à
// 1 jour donne 3.50 CHF, exactement le « Total 3,50 Fr » affiché à l'écran.
//
// Le format de props d'Astro encode chaque valeur en [type, valeur] ; d'où le
// dépaquetage récursif ci-dessous.
//
// Choix assumé : on ne retient pas les 31 durées du périmètre mais les huit
// durées de référence (1, 3, 5, 7, 10, 15, 20, 30 jours). Enregistrer le jour
// 22 à côté du jour 23 remplirait le comparateur de quasi-doublons que
// personne ne compare. Que Holafly vende la journée à la carte reste une
// singularité : elle est signalée dans la description de l'offre, pas
// dupliquée en trente lignes.
//
// Contrôle de non-régression : si toutes les durées ressortent au même prix,
// la collecte est fausse. Le script refuse alors d'écrire son fichier.
//
//   node scripts/collect-holafly.mjs esim-europe esim-royaume-uni
//   COLLECT_OUT=data/voyage-holafly.json node scripts/collect-holafly.mjs esim-europe

import fs from "fs";
import { chromium } from "playwright-core";

const slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!slugs.length) {
  console.error("usage: node scripts/collect-holafly.mjs <slug> [slug…]  (ex. esim-europe)");
  process.exit(2);
}

const DUREES = [1, 3, 5, 7, 10, 15, 20, 30];
const DEVISE = process.env.HOLAFLY_CURRENCY || "CHF";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  locale: "fr-CH",
  timezoneId: "Europe/Zurich",
  viewport: { width: 1400, height: 1600 },
  extraHTTPHeaders: { "accept-language": "fr-CH,fr;q=0.9,en;q=0.5" },
});

const resultats = [];

for (const slug of slugs) {
  const url = `https://esim.holafly.com/fr/${slug}/`;
  const page = await ctx.newPage();
  const rec = { provider: "Holafly", slug, url, plans: [], meta: { devise: DEVISE } };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // « attached », pas « visible » : un <astro-island> est un conteneur
    // transparent de dimension nulle, que Playwright ne jugera jamais visible.
    await page.waitForSelector("astro-island", { state: "attached", timeout: 30000 });

    const brut = await page.evaluate(() => {
      // Astro encode chaque valeur en [type, valeur] ; on dépaquette récursivement.
      const de = (x) => (Array.isArray(x) && x.length === 2 && typeof x[0] === "number" ? x[1] : x);
      const deep = (x) => {
        x = de(x);
        if (Array.isArray(x)) return x.map(deep);
        if (x && typeof x === "object") {
          const o = {};
          for (const k in x) o[k] = deep(x[k]);
          return o;
        }
        return x;
      };
      const isls = [...document.querySelectorAll("astro-island")];
      const isl = isls.find((e) => /ProductPricing/.test(e.getAttribute("component-url") || ""));
      if (!isl) return { err: "îlot ProductPricing introuvable" };
      const p = deep(JSON.parse(isl.getAttribute("props")));
      // La couverture réelle vient de l'îlot CountriesModal, qui liste les pays
      // inclus en ISO-3. Ne pas la chercher dans le texte de la page : le « 200+
      // destinations » qu'on y lit est l'argumentaire de Holafly sur l'ensemble
      // de son catalogue, pas le périmètre du forfait affiché. Un produit
      // mono-pays a une liste vide — il ne couvre que lui-même.
      const cm = isls.find((e) => /CountriesModal/.test(e.getAttribute("component-url") || ""));
      let pays = [];
      if (cm) {
        const pc = deep(JSON.parse(cm.getAttribute("props")));
        pays = (pc.includedProductEntries || []).map((x) => x.isocode).filter(Boolean);
      }
      return {
        sku: p.sku,
        nom: p.name,
        illimite: p.isUnlimitedPlan === true,
        maxJours: p.maxCustomDays,
        pays,
        variantes: (p.variants || []).map((v) => ({ days: v.days, gigas: v.gigas, currencies: v.currencies })),
      };
    });
    if (brut.err) throw new Error(brut.err);

    rec.meta.sku = brut.sku;
    rec.meta.nom = brut.nom;
    rec.meta.illimite = brut.illimite;
    rec.meta.dureesDisponibles = brut.variantes.length;
    rec.meta.maxJours = brut.maxJours;

    // Le partage est proposé mais plafonné : « Partagez 1 Go de données par jour ».
    const txt = await page.evaluate(() => document.body.innerText || "");
    const partage = txt.match(/Partagez\s+(\d+)\s*Go\s+de données par jour/i);
    rec.meta.hotspotGoParJour = partage ? parseInt(partage[1], 10) : null;

    rec.meta.countries = brut.pays;
    rec.meta.couverture = brut.pays.length || 1;

    for (const j of DUREES) {
      const v = brut.variantes.find((x) => x.days === j);
      if (!v) continue;
      const prix = v.currencies ? v.currencies[DEVISE] : null;
      if (typeof prix !== "number") continue;
      rec.plans.push({
        days: j,
        dataGB: /unlimited/i.test(String(v.gigas)) ? "Infinity" : parseFloat(v.gigas),
        unlimited: /unlimited/i.test(String(v.gigas)),
        price: prix,
        currency: DEVISE,
        horsPerimetre: j > 31,
      });
    }
  } catch (e) {
    rec.err = e.message.slice(0, 140);
  }
  await page.close().catch(() => {});
  resultats.push(rec);

  console.log("──────────────────────────────────────────");
  console.log(
    `${slug}  —  ${rec.err ? "ERREUR " + rec.err : rec.plans.length + " forfait(s)"}  [${rec.meta.devise}]`
  );
  if (rec.meta.dureesDisponibles)
    console.log(`  durées vendues par Holafly : ${rec.meta.dureesDisponibles}  (on en retient ${DUREES.length})`);
  if (rec.meta.couverture) console.log(`  couverture annoncée : ${rec.meta.couverture} pays`);
  if (rec.meta.hotspotGoParJour) console.log(`  partage de connexion : ${rec.meta.hotspotGoParJour} Go/jour`);
  rec.plans.forEach((p) =>
    console.log(`  ${String(p.price).padStart(7)} ${p.currency}  ${String(p.days).padStart(3)} j  illimité`)
  );
}

// Contrôle de non-régression : c'est exactement le symptôme qu'ont produit les
// trois tentatives de pilotage du calendrier — toutes les durées au prix du
// « à partir de ». Une collecte qui le reproduit est fausse, on n'écrit rien.
const suspects = resultats.filter((r) => r.plans.length > 1 && new Set(r.plans.map((p) => p.price)).size === 1);
if (suspects.length) {
  console.error(
    `\n✗ ABANDON : prix identique sur toutes les durées pour ${suspects.map((r) => r.slug).join(", ")}. ` +
      `Le sélecteur de durée n'a pas été lu correctement — rien n'est écrit.`
  );
  await browser.close();
  process.exit(1);
}

if (process.env.COLLECT_OUT) {
  fs.writeFileSync(process.env.COLLECT_OUT, JSON.stringify(resultats, null, 1));
  console.log(`\nÉcrit : ${process.env.COLLECT_OUT}`);
}
await browser.close();
