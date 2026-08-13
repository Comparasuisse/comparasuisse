// QA de fin d'AUDIT COMPLET — les contrôles interactifs que qa-quick ne fait pas.
//
// qa-quick couvre la syntaxe, la console, les compteurs d'onglets et les
// checkboxes. Restaient manuels, donc oubliables, les tests décrits au
// § « Protocole de fin d'audit » d'AUDIT-COMPLET.md : filtres, comparateur,
// accordéons de chaînes, défilement des comptes à rebours. Ce script les joue.
//
//   node scripts/qa-final.mjs

import { chromium } from "playwright-core";

const F = "file:///C:/Users/cicer/Documents/comparasuisse/index.html";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
const echecs = [];
const ok = (m) => console.log(`  ✅ ${m}`);
const ko = (m) => {
  console.log(`  ❌ ${m}`);
  echecs.push(m);
};

await page.goto(F, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// 1 — Chaque grille rend autant de cartes que son compteur d'onglet annonce
console.log("\n[1] Grilles et compteurs d'onglet");
const grilles = await page.evaluate(() =>
  [...document.querySelectorAll('[id$="-grid"]')].map((g) => {
    const cat = g.id.replace("-grid", "");
    const c = document.querySelector("#tab-total-" + cat);
    return { cat, cartes: g.children.length, compteur: c ? (c.textContent || "").trim() : null };
  })
);
for (const g of grilles) {
  const attendu = parseInt(String(g.compteur || "").replace(/\D/g, ""), 10);
  g.cartes > 0 && g.cartes === attendu
    ? ok(`${g.cat} : ${g.cartes} cartes = compteur ${g.compteur}`)
    : ko(`${g.cat} : ${g.cartes} cartes vs compteur ${g.compteur}`);
}

// 2 — Filtres de l'onglet mobile
console.log("\n[2] Filtres (onglet mobile)");
const nbMobile = () => page.evaluate(() => document.querySelector("#mobile-grid").children.length);
const setRange = (sel, v) =>
  page.$eval(
    sel,
    (el, val) => {
      el.value = val === "max" ? el.max : val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    v
  );
const setNet = (net, on) =>
  page.$eval(
    `#mobile-network input[data-net="${net}"]`,
    (el, val) => {
      el.checked = val;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    on
  );

const avant = await nbMobile();
await setRange("#mobile-price", 15);
await page.waitForTimeout(700);
const apres = await nbMobile();
apres < avant && apres > 0
  ? ok(`slider prix à 15 CHF : ${avant} → ${apres} offres`)
  : ko(`slider prix sans effet (${avant} → ${apres})`);

await setRange("#mobile-price", "max");
await page.waitForTimeout(700);
const reset = await nbMobile();
reset === avant ? ok(`reset slider : retour à ${reset}`) : ko(`reset slider : ${reset} au lieu de ${avant}`);

await setNet("salt", false);
await page.waitForTimeout(700);
const sansSalt = await nbMobile();
sansSalt < avant && sansSalt > 0
  ? ok(`réseau Salt décoché : ${avant} → ${sansSalt}`)
  : ko(`checkbox réseau sans effet (${avant} → ${sansSalt})`);
await setNet("salt", true);
await page.waitForTimeout(700);
(await nbMobile()) === avant ? ok(`recoché : retour à ${avant}`) : ko("recochage incomplet");

// 3 — Comptes à rebours : les secondes défilent réellement
console.log("\n[3] Comptes à rebours");
const lire = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".promo-banner .banner-time")].map((e) => e.textContent.trim())
  );
const t1 = await lire();
if (!t1.length) ko("aucun bandeau de compte à rebours rendu");
else {
  await page.waitForTimeout(3200);
  const t2 = await lire();
  t1.some((v, i) => v !== t2[i])
    ? ok(`${t1.length} bandeau(x), défilement confirmé (${t1[0]} → ${t2[0]})`)
    : ko(`${t1.length} bandeau(x) figés (${t1[0]})`);
}

// 4 — Accordéon « Voir les chaînes » et sa recherche
console.log("\n[4] Chaînes TV");
// L'onglet doit être actif : un champ dans un panneau masqué n'est pas
// « visible » pour Playwright, et fill() part en timeout.
await page.click('[data-tab="tv"]').catch(() => {});
await page.waitForTimeout(900);
const chan = await page.evaluate(() => {
  const d = [...document.querySelectorAll("#tv-grid details")].find((x) =>
    /voir les chaînes/i.test((x.querySelector("summary") || {}).textContent || "")
  );
  if (!d) return null;
  d.open = true;
  const liste = d.querySelector(".channels-list") || d;
  // Les chaînes sont des SPAN.chan. offsetParent vaut null ici (ancêtre
  // positionné), la visibilité se lit donc sur le display calculé.
  const visibles = [...liste.querySelectorAll(".chan")].filter(
    (e) => getComputedStyle(e).display !== "none"
  ).length;
  return { visibles };
});
if (!chan) ko("aucun accordéon « Voir les chaînes » trouvé");
else {
  chan.visibles > 50
    ? ok(`accordéon ouvert : ${chan.visibles} chaînes visibles`)
    : ko(`accordéon ouvert mais seulement ${chan.visibles} chaînes`);
  // Saisie via l'événement plutôt que fill() : le champ vit dans une carte de
  // grille que Playwright ne considère pas « visible », alors que le filtre
  // qu'on veut tester, lui, écoute bien oninput.
  //
  // Le terme cherché est tiré de la liste elle-même, au lieu d'un « BBC » écrit
  // en dur. Un terme absent du bouquet donne 0 résultat, et l'assertion
  // « après < avant » passe alors même si le filtre masquait tout par erreur —
  // un test qui ne peut pas échouer ne teste rien. Ici on exige 0 < après < avant.
  const terme = await page.evaluate(() => {
    const d = [...document.querySelectorAll("#tv-grid details")].find((x) => x.open);
    const liste = d.querySelector(".channels-list") || d;
    const noms = [...liste.querySelectorAll(".chan")]
      .map((e) => (e.textContent || "").trim())
      .filter((t) => t.length > 3);
    if (!noms.length) return null;
    // Un nom du milieu de liste, tronqué : assez précis pour filtrer, assez
    // court pour matcher au moins son propre porteur.
    return noms[Math.floor(noms.length / 2)].slice(0, 4);
  });
  const aChamp = await page.evaluate((t) => {
    const d = [...document.querySelectorAll("#tv-grid details")].find((x) => x.open);
    const c = d && d.querySelector(".chan-search");
    if (!c || !t) return false;
    c.value = t;
    c.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, terme);
  if (!aChamp) ko("pas de champ de recherche dans l'accordéon");
  else {
    await page.waitForTimeout(900);
    const apresRech = await page.evaluate(() => {
      const d = [...document.querySelectorAll("#tv-grid details")].find((x) => x.open);
      const liste = d.querySelector(".channels-list") || d;
      return [...liste.querySelectorAll(".chan")].filter(
        (e) => getComputedStyle(e).display !== "none"
      ).length;
    });
    apresRech > 0 && apresRech < chan.visibles
      ? ok(`recherche « ${terme} » : ${chan.visibles} → ${apresRech} chaînes visibles`)
      : ko(
          apresRech === 0
            ? `recherche « ${terme} » : 0 chaîne visible alors que le terme vient de la liste — le filtre masque tout`
            : `recherche « ${terme} » sans effet (${chan.visibles} → ${apresRech})`
        );
  }
}

// 5 — Comparateur : sélectionner 2 offres puis ouvrir le tableau
console.log("\n[5] Comparateur");
await page.click('[data-tab="mobile"]').catch(() => {});
await page.waitForTimeout(800);
const coches = await page.evaluate(() => {
  const b = [...document.querySelectorAll("#mobile-grid button")].filter((e) =>
    /\+\s*Comparer/i.test(e.textContent || "")
  );
  b.slice(0, 2).forEach((e) => e.click());
  return Math.min(b.length, 2);
});
coches === 2 ? ok("2 offres sélectionnées") : ko(`${coches} offre(s) sélectionnée(s) au lieu de 2`);
await page.waitForTimeout(600);
await page.click('[data-tab="compare"]').catch(() => {});
await page.waitForTimeout(1000);
const tableau = await page.evaluate(() => {
  const t = document.querySelector("#compare-grid table, #compare table, table");
  if (!t) return { lignes: 0, labels: [] };
  return {
    lignes: t.querySelectorAll("tr").length,
    labels: [...t.querySelectorAll("tr")].map((r) => (r.cells[0]?.textContent || "").trim()).slice(0, 12),
  };
});
tableau.lignes > 3
  ? ok(`tableau de comparaison : ${tableau.lignes} lignes (${tableau.labels.filter(Boolean).slice(0, 5).join(", ")}…)`)
  : ko(`tableau de comparaison : ${tableau.lignes} ligne(s)`);

await browser.close();
console.log(`\n${echecs.length ? `❌ QA final : ${echecs.length} échec(s)` : "✅ QA final : tout passe"}`);
process.exit(echecs.length ? 1 : 0);
