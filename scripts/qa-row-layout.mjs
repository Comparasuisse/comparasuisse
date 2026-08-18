// Contrôle de mise en page des lignes compactes, sur plusieurs largeurs.
//
// Né du défaut du 18.08.2026 : le champ libre `discount` de promoData était
// injecté dans la cellule row-data (116 px) ET dans la cellule prix (124 px,
// en white-space:nowrap). Avec 304 caractères sur l'entrée Coop Box Trophée,
// le texte traversait la carte et passait sous les boutons.
//
// Sensibilité vérifiée : sur le code d'avant correction, il remonte 80
// anomalies (les 8 entrées à `discount` × 10 largeurs) ; sur le code corrigé,
// zéro. Un détecteur qui ne sait pas voir le défaut qu'il surveille ne vaut
// rien, ce contrôle-là compte autant que le vert final.
//
//   node scripts/qa-row-layout.mjs                    (défaut : onglet Promotions)
//   URL=http://127.0.0.1:8897/tv/ node scripts/qa-row-layout.mjs
// Playwright plutôt que le navigateur piloté : lui seul redimensionne vraiment
// le viewport, donc déclenche les media queries (720 px et 400 px ici).
import { chromium } from "playwright-core";

const URL = process.env.URL || "http://127.0.0.1:8897/promotions/";
const LARGEURS = [1440, 1200, 1024, 900, 800, 721, 719, 600, 480, 390];

const br = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-CH" });
const pg = await ctx.newPage();
await pg.goto(URL, { waitUntil: "domcontentloaded" });
await pg.waitForSelector("[id$=-grid]:not(.hidden) .card", { timeout: 20000 });

const audit = () => {
  // Grille de l'onglet actif, quel qu'il soit : l'outil sert aussi bien sur
  // /tv/ ou /internet/ que sur /promotions/.
  const cartes = [...document.querySelectorAll("[id$=\"-grid\"]:not(.hidden) .card")];
  const pbs = [];
  for (const c of cartes) {
    const row = c.querySelector(".row");
    const nom = (c.querySelector(".row-name")?.textContent || "").replace(/▶/, "").trim().slice(0, 42);
    const data = row.querySelector(".row-data");
    const price = row.querySelector(".row-price");
    const cmp = row.querySelector(".row-cmp");
    const go = row.querySelector(".row-go");
    // Toutes les cartes ne portent pas de bouton Comparer (prépayés, SIM data).
    if (!row || !data || !price) continue;
    const rr = row.getBoundingClientRect();
    const rp = price.getBoundingClientRect();
    const rc = cmp ? cmp.getBoundingClientRect() : null;
    const rg = go ? go.getBoundingClientRect() : null;
    // Chevauchement : seulement pertinent si les éléments sont sur la même ligne
    // visuelle (en dessous de 720 px, .row-cmp passe sur sa propre ligne).
    const surLigne = (a, b) => Math.abs(a.top - b.top) < 5;
    const chevauchePrixCmp = !!rc && surLigne(rp, rc) && rp.right > rc.left + 1;
    const chevaucheCmpGo = !!rc && !!rg && surLigne(rc, rg) && rc.right > rg.left + 1;
    const debordeData = data.clientWidth > 0 && data.scrollWidth > data.clientWidth + 1;
    const debordePrix = price.clientWidth > 0 && price.scrollWidth > price.clientWidth + 1;
    const sortDeCarte = rp.right > rr.right + 1 || (!!rg && rg.right > rr.right + 1);
    if (chevauchePrixCmp || chevaucheCmpGo || debordeData || debordePrix || sortDeCarte)
      pbs.push({ nom, chevauchePrixCmp, chevaucheCmpGo, debordeData, debordePrix, sortDeCarte });
  }
  return { cartes: cartes.length, pbs };
};

let total = 0;
for (const w of LARGEURS) {
  await pg.setViewportSize({ width: w, height: 900 });
  await pg.waitForTimeout(350);
  const r = await pg.evaluate(audit);
  total += r.pbs.length;
  const etat = r.pbs.length ? `❌ ${r.pbs.length} problème(s)` : "✅ aucune anomalie";
  console.log(`  ${String(w).padStart(5)} px  ${String(r.cartes).padStart(3)} cartes  ${etat}`);
  for (const p of r.pbs.slice(0, 4)) {
    const quoi = Object.entries(p).filter(([k, v]) => v === true).map(([k]) => k).join(", ");
    console.log(`            ↳ ${p.nom} — ${quoi}`);
  }
}
await br.close().catch(() => {});
console.log(total === 0 ? "\n✅ Aucun débordement sur aucune largeur." : `\n❌ ${total} anomalie(s) au total.`);
process.exit(total === 0 ? 0 : 1);
