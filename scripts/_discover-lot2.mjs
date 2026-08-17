// Découverte du lot 2 : vérifie EN DIRECT quels slugs existent chez chaque
// fournisseur pour les six destinations asiatiques visées. Aucune supposition :
// une URL n'est retenue que si la page rend réellement des forfaits.
import { chromium } from "playwright-core";
import fs from "fs";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

// Candidats par destination. Plusieurs orthographes quand le doute est permis
// (Holafly est en français, Saily parfois en « dubai » plutôt qu'en UAE).
const CIBLES = {
  "Thaïlande":       { airalo:["thailand"], saily:["esim-thailand"], nomad:["thailand"], yesim:["country/thailand"], holafly:["esim-thailande","esim-thailand"] },
  "Japon":           { airalo:["japan"], saily:["esim-japan"], nomad:["japan"], yesim:["country/japan"], holafly:["esim-japon","esim-japan"] },
  "Indonésie":       { airalo:["indonesia"], saily:["esim-indonesia"], nomad:["indonesia"], yesim:["country/indonesia"], holafly:["esim-indonesie","esim-bali","esim-indonesia"] },
  "Vietnam":         { airalo:["vietnam"], saily:["esim-vietnam"], nomad:["vietnam"], yesim:["country/vietnam"], holafly:["esim-vietnam"] },
  "Singapour":       { airalo:["singapore"], saily:["esim-singapore"], nomad:["singapore"], yesim:["country/singapore"], holafly:["esim-singapour","esim-singapore"] },
  "Émirats arabes unis": { airalo:["united-arab-emirates"], saily:["esim-united-arab-emirates","esim-dubai"], nomad:["united-arab-emirates"], yesim:["country/united-arab-emirates"], holafly:["esim-dubai","esim-emiratos-arabes-unidos","esim-emirats-arabes-unis"] },
};

const URL_DE = {
  airalo:  (s) => `https://www.airalo.com/${s}-esim`,
  saily:   (s) => `https://saily.com/${s}/`,
  nomad:   (s) => `https://www.getnomad.app/en/${s}-eSIM`,
  yesim:   (s) => `https://yesim.app/${s}/`,
  holafly: (s) => `https://esim.holafly.com/fr/${s}/`,
};

const br = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await br.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  locale: "fr-CH", timezoneId: "Europe/Zurich", viewport: { width: 1400, height: 1400 },
  extraHTTPHeaders: { "accept-language": "fr-CH,fr;q=0.9,en;q=0.5" },
});
ctx.setDefaultNavigationTimeout(45000);

const resultat = {};

// ---- 1. Ubigi : vocabulaire réel de la grille ----
try {
  const pg = await ctx.newPage();
  await pg.goto("https://cellulardata.ubigi.com/data-plans-and-coverage/ubigi-esim-data-plans/?wmc-currency=USD", { waitUntil: "domcontentloaded" });
  await pg.waitForSelector(".plan.row", { timeout: 45000 });
  await pg.waitForTimeout(4000);
  const labels = await pg.evaluate(() => [...new Set([...document.querySelectorAll(".plan.row")].map(e => e.dataset.label))].filter(Boolean));
  resultat.__ubigiLabels = labels.sort();
  await pg.close().catch(() => {});
  console.log(`Ubigi : ${labels.length} libellés dans la grille`);
} catch (e) { resultat.__ubigiLabels = { erreur: String(e).slice(0, 90) }; }

// ---- 2. Les cinq fournisseurs à URL ----
for (const [dest, parFournisseur] of Object.entries(CIBLES)) {
  resultat[dest] = {};
  for (const [fournisseur, slugs] of Object.entries(parFournisseur)) {
    let retenu = null;
    for (const slug of slugs) {
      const url = URL_DE[fournisseur](slug);
      try {
        const pg = await ctx.newPage();
        const rep = await pg.goto(url, { waitUntil: "domcontentloaded" });
        await pg.waitForTimeout(3500);
        const info = await pg.evaluate(() => {
          const html = document.documentElement.outerHTML;
          const txt = (document.body.innerText || "");
          const prix = [...new Set((html.match(/\d{1,3}[.,]\d{2}/g) || []))].length;
          return {
            url: location.href,
            titre: document.title.slice(0, 70),
            len: txt.length,
            err404: /404|not found|introuvable|page non trouv/i.test(txt.slice(0, 900) + document.title),
            nbPrix: prix,
            aJours: /\d+\s*(days?|jours?)/i.test(txt),
          };
        });
        const statut = rep ? rep.status() : 0;
        await pg.close().catch(() => {});
        const ok = statut < 400 && !info.err404 && info.nbPrix >= 3 && info.aJours;
        console.log(`  ${ok ? "✅" : "❌"} ${fournisseur.padEnd(8)} ${dest.padEnd(22)} ${slug.padEnd(30)} http=${statut} prix=${info.nbPrix} jours=${info.aJours}`);
        if (ok) { retenu = { slug, url, http: statut, titre: info.titre, nbPrix: info.nbPrix }; break; }
      } catch (e) {
        console.log(`  ❌ ${fournisseur.padEnd(8)} ${dest.padEnd(22)} ${slug.padEnd(30)} ERREUR ${String(e).slice(0, 50)}`);
      }
    }
    resultat[dest][fournisseur] = retenu;
  }
}

await br.close().catch(() => {});
fs.writeFileSync("scripts/_lot2-slugs.json", JSON.stringify(resultat, null, 1));
console.log("\nÉcrit : scripts/_lot2-slugs.json");
