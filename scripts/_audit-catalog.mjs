// Audit quotidien automatisé (parcours COMPLET du catalogue).
//
// Étape « rapide » de l'architecture hybride décrite dans AUDIT-COMPLET.md :
//  1. Ce script parcourt toutes les offres avec une `url` connue.
//  2. Il compare le prix stocké au prix affiché sur la page (via Playwright).
//  3. Il flague explicitement chaque cas ambigu (mots-clés suspects, prix
//     inextractable, écart de prix).
//  4. Il écrit un rapport unique dans `scripts/daily-audit-log.md`
//     (rolling : les runs les plus récents en haut).
//  5. Il maintient un état `scripts/daily-audit-state.json` pour tracer la
//     date du dernier run et de la dernière passe complète manuelle validée
//     (permet de déclencher l'AUDIT COMPLET si > 2 jours sans passe).
//
// Ce script NE MODIFIE PAS index.html. Il n'auto-corrige rien. Toute décision
// (bump de prix, prolongation de promoData, retrait d'offre) reste manuelle,
// prise avec browser MCP + jugement, comme documenté dans AUDIT-COMPLET.md.
//
// Usage :
//   node scripts/_audit-catalog.mjs                  # run complet
//   node scripts/_audit-catalog.mjs --limit 20       # premiers 20 (debug rapide)
//   node scripts/_audit-catalog.mjs --category mobile  # subset
//   node scripts/_audit-catalog.mjs --mark-full-pass   # marque une passe manuelle validée (reset le compteur)
//   node scripts/_audit-catalog.mjs --dry-run          # inventaire sans Playwright
//
// Note : ce script REMPLACE l'ancien _audit-catalog.mjs qui dumpait juste le
// texte brut de landings hardcodées, vague par vague. L'ancien comportement
// n'est plus utilisé — le parcours par URL depuis index.html est plus fidèle
// à la réalité du catalogue.

import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { loadData, checkOffer, detectSuspiciousKeywords, promosExpirees, promosQuiExpirentBientot, endOfDayLocal } from "./lib/audit-lib.mjs";

const CHROME_PATH =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const LOG_PATH = "scripts/daily-audit-log.md";
const STATE_PATH = "scripts/daily-audit-state.json";
const LOCK_PATH = "scripts/daily-audit.lock";

// === Watchdog global processus ===
// Dernier rempart : quoi qu'il arrive dans Playwright/Chrome/réseau, le
// processus DOIT se terminer avant cette borne. Un run normal dure 5-10 min
// (~180 URLs × 1-2s hit-cache + ~50 URLs × 5-15s cold-load). 30 min = 3× le
// pire cas raisonnable. Cf. incident 07.08.2026 : yallo Home Max Fiber a
// bloqué le script 25h à cause d'une coupure réseau, sans que le
// Promise.race interne ne libère le processus (le hard timeout logiciel
// a bien fired mais le browser.close() final a hangé indéfiniment).
// Relevé à 180 min le 17.08.2026 : le périmètre est passé de 193 à 311 URLs
// uniques (ajout de travel/prepaid/dataOnly au scan).
//
// Historique du seuil, et pourquoi il redescend le 21.08.2026 :
//   30 min  → coupait des runs sains aux deux tiers. Comme les catégories sont
//             parcourues dans l'ordre de loadData(), c'est toujours la fin de
//             liste — travel/prepaid/dataOnly — qui sautait, et le rapport se
//             terminait normalement sans signaler l'amputation. Un watchdog qui
//             tronque un run sain rétablit l'angle mort qu'on venait de
//             corriger, en pire : silencieusement.
//   180 min → réaction à ce problème, mais surdimensionnée : un vrai blocage
//             pouvait tourner trois heures avant d'être coupé.
//   60 min  → valeur actuelle, choisie sur MESURE et non sur intuition.
//
// Ce que disent les mesures (catalogue de 1058 offres, 390 URLs uniques) :
//   17.08 : 23 min · 18.08 : 30 min · 19.08 : 57 min (avant l'allègement des
//   replis) · 21.08 : **33 min**, run complet chronométré après correction.
// Le budget est donc à peu près au double du temps réel : assez pour absorber
// un réseau lent ou une poignée de pages capricieuses, sans jamais laisser
// traîner un run mort.
//
// Deux choses rendent cette baisse sûre, qui n'existaient pas avant :
//   1. le budget se compte en temps ÉVEILLÉ (cf. superviseur plus bas). Les
//      minutes de veille moderne — nombreuses sur cette machine — ne le
//      consomment plus. C'est ce qui interdisait de baisser le plafond : il
//      mesurait du sommeil autant que du travail.
//   2. ce plafond n'est plus le mécanisme qui attrape les blocages. Le
//      watchdog de progression (MAX_STALL_MS) tue un run figé en 6 minutes,
//      là où le plafond, par nature, attendait la fin du budget.
const MAX_TOTAL_RUN_TIME_MS = 60 * 60 * 1000;
// Watchdog de PROGRESSION, ajouté le 19.08.2026. Le plafond ci-dessus borne la
// durée TOTALE ; il ne dit rien d'un run vivant mais figé. Le 19.08, un run est
// resté 39 minutes sur une seule offre : sous les 3 h, donc invisible pour le
// plafond, et hors du hardTimeout de checkOffer parce que le blocage se
// produisait dans ctx.newPage() — étape antérieure à l'armement du Promise.race
// (corrigé par ailleurs, borné à 15 s).
//
// Baisser le plafond global ne serait PAS la bonne réponse : à 30 comme à
// 60 min il tronquait des runs parfaitement sains, en coupant toujours les
// mêmes catégories de fin de liste (travel/prepaid/dataOnly). Le bon signal
// n'est pas « ce run est long » mais « ce run n'avance plus » : 6 minutes sans
// qu'une seule offre se termine, alors que la plus lente en prend 30 s, ne
// s'explique par aucun cas légitime.
const MAX_STALL_MS = 6 * 60 * 1000;
// Seuil de failures consécutives (TIMEOUT/ERREUR/PAGE_VIDE) après lequel
// on recycle le browser+context — évite qu'un contexte saturé/dégradé
// pollue les URLs suivantes.
const RECYCLE_BROWSER_AFTER_N_CONSECUTIVE_FAILURES = 3;

// Nombre de jours max entre 2 passes complètes AVANT que le trigger « manuel »
// soit forcé, même sans flag. Cf. AUDIT-COMPLET.md.
// Seuil à 1j + comparateur `>=` → trigger dès le lendemain d'une passe complète
// (audit exhaustif quotidien souhaité par le mainteneur).
const DAYS_BEFORE_FORCED_FULL_PASS = 1;
// Nombre maximum de runs (bloc `# Daily audit — YYYY-MM-DD`) conservés dans
// le fichier de log rolling. Les runs plus vieux sont supprimés au run suivant
// pour éviter que le fichier explose en taille en cas d'audits multi-quotidiens
// (déclenchés à la main pour debug par exemple).
const MAX_RUNS_KEPT_IN_LOG = 7;

// === Lock file ===
// Un run précédent qui traîne (hang Playwright, PC en veille pendant un run,
// etc.) ne doit pas se voir marcher dessus par un nouveau run. Cf. incident
// 03.08.2026 : plusieurs runs empilés sur le même daily-audit-log.md car les
// runs précédents hanguaient jusqu'à 82 min sans jamais terminer.
// Vrai tant que CE process est propriétaire du fichier de lock. Sans ce
// drapeau, releaseLock() s'exécutait au exit de n'importe quel process — y
// compris celui qui vient de REFUSER de démarrer parce que le lock était pris.
// Autrement dit : la deuxième instance supprimait le verrou de la première en
// partant, et la troisième pouvait alors démarrer en parallèle. Le mécanisme
// anti-empilement se désarmait tout seul à la première collision.
// Constaté le 21.08.2026 : un run manuel refusé (exit 75) a effacé le lock du
// run planifié en cours, qui a continué sans protection.
let lockOwned = false;

function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) {
    let staleLock = false;
    try {
      const raw = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
      // PID vivant ? Sous Windows, process.kill(pid, 0) renvoie true si le
      // process existe, throw sinon.
      try { process.kill(raw.pid, 0); }
      catch { staleLock = true; }
      // L'ÂGE ne suffit plus à déclarer un lock mort. La règle « plus de 90 min
      // = zombie » datait d'un catalogue de 300 offres ; un run complet en
      // demande aujourd'hui près d'une heure, et davantage si la machine passe
      // en veille au milieu. Un run sain se faisait donc doubler par le suivant,
      // ce qui empile deux Chrome et sature le contexte — précisément la panne
      // que le lock existe pour empêcher.
      // Un PID vivant fait désormais autorité : le run est protégé tant qu'il
      // respire. Ce n'est sûr que parce que le superviseur le tue lui-même s'il
      // se fige (exit 125) ou s'il dépasse son budget éveillé (exit 124) — donc
      // un PID vivant ne peut plus rester vivant indéfiniment.
      // L'âge ne sert plus que de garde-fou quand le PID est inexploitable.
      if (!staleLock && !raw.pid && raw.startedAt) {
        const ageMs = Date.now() - new Date(raw.startedAt).getTime();
        if (ageMs > 4 * 60 * 60 * 1000) staleLock = true;
      }
      if (!staleLock) {
        console.error(`⛔ Un run est déjà en cours (PID ${raw.pid} depuis ${raw.startedAt}). Exit.`);
        process.exit(75); // EX_TEMPFAIL — Task Scheduler retry-friendly
      }
      console.warn(`⚠ Lock obsolète détecté (PID ${raw.pid}), nettoyage.`);
    } catch {
      // Lock corrompu → on écrase.
    }
    try { fs.unlinkSync(LOCK_PATH); } catch {}
  }
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  lockOwned = true;
}
function releaseLock() {
  if (!lockOwned) return;
  // Double sécurité : on relit le contenu avant de supprimer. Si le fichier
  // porte un autre PID, c'est qu'un run plus récent l'a repris (par exemple
  // après que le nôtre a été jugé zombie) — le lui retirer ferait exactement
  // le dégât qu'on cherche à éviter.
  try {
    const raw = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
    if (raw.pid !== process.pid) return;
  } catch { /* lock absent ou illisible : la tentative de suppression ci-dessous est sans risque */ }
  try { fs.unlinkSync(LOCK_PATH); } catch {}
}
process.on("exit", releaseLock);
process.on("SIGINT", () => { releaseLock(); process.exit(130); });
process.on("SIGTERM", () => { releaseLock(); process.exit(143); });

// === Args ===
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const argVal = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

// === Mode --mark-full-pass : marque une passe manuelle complète et exit ===
// À invoquer par l'utilisateur après un AUDIT COMPLET manuel validé et pushé.
// Ex : `node scripts/_audit-catalog.mjs --mark-full-pass`
if (flag("mark-full-pass")) {
  const state = loadState();
  // Date LOCALE, pas UTC. toISOString() renvoyait la veille entre minuit et
  // 02:00 heure suisse (constaté le 10.08.2026 à 00:47 : UTC disait encore
  // 08-09), alors que le run du jour, lui, se date via todayLocalISO(). Les
  // deux valeurs divergeaient d'un jour dans le state, ce qui redéclenchait
  // le trigger « overdue » 24 h trop tôt.
  const today = todayLocalISO();
  state.lastFullPassDate = today;
  saveState(state);
  console.log(`✅ Passe complète manuelle enregistrée le ${today}.`);
  process.exit(0);
}

const LIMIT = parseInt(argVal("limit") || "0", 10);
const CATEGORY = argVal("category"); // mobile | internet | tv | combo | promo | prepaid | dataOnly | travel
const DRY = flag("dry-run");

// Acquiert le verrou avant tout autre traitement lourd. `--dry-run` peut
// passer sans lock (inventaire seul).
if (!DRY) acquireLock();

// === Superviseur du run : temps ÉVEILLÉ, pas temps écoulé ===
// Un seul battement de 30 s remplace les deux watchdogs à setTimeout. Motif,
// découvert le 21.08.2026 en cherchant pourquoi deux runs avaient « gelé » :
// **cette machine est en veille moderne (Modern Standby) une bonne partie du
// temps.** Journal système à l'appui — événements Kernel-Power 507 « le système
// quitte le mode de veille moderne » à 13:24, 14:19, 14:34, 14:54 et 16:37 le
// 19.08, puis plus rien jusqu'au 21.08 à 02:34. Les runs n'étaient pas bloqués :
// ils dormaient. Une offre a même été journalisée « TIMEOUT (6140146ms) », soit
// 102 minutes, alors que son hard timeout est de 20 s — le compteur mesurait du
// sommeil, pas du travail.
//
// Conséquence de méthode : un watchdog à setTimeout ne peut PAS faire la
// différence entre un run bloqué et un run endormi, puisque ses propres timers
// ne tournent pas non plus pendant la veille. Il ne se réveille qu'au retour de
// la machine, constate un temps énorme, et tue un run parfaitement sain. C'est
// exactement ce qui s'est produit : le plafond de 180 min a coupé au réveil.
//
// D'où ce superviseur. Il bat toutes les 30 s et regarde SON PROPRE retard :
//   - un battement à l'heure = le process est planifié normalement → ce temps
//     compte, et l'absence de progression pendant ce temps est suspecte ;
//   - un battement très en retard = personne ne nous a exécutés → la machine
//     dormait → ce temps ne compte pour rien et ne reproche rien au run.
// Les deux plafonds portent donc sur du temps éveillé, seule mesure qui parle
// du travail réellement effectué.
const TICK_MS = 30 * 1000;
let tempsEveilleMs = 0;
let sommeilCumuleMs = 0;
let ticksSansProgres = 0;
let progresDepuisTick = true;
let dernierTick = Date.now();

function touchProgress() {
  progresDepuisTick = true;
}

function tuer(code, message) {
  console.error(`\n${message}`);
  console.error(`   temps éveillé : ${Math.round(tempsEveilleMs / 60000)} min · veille cumulée : ${Math.round(sommeilCumuleMs / 60000)} min`);
  // Libère le lock explicitement : process.on('exit') ne s'exécute pas toujours.
  releaseLock();
  process.exit(code);
}

if (!DRY) {
  const superviseur = setInterval(() => {
    const maintenant = Date.now();
    const ecoule = maintenant - dernierTick;
    dernierTick = maintenant;

    // Battement en retard de plus du triple : le process n'a pas été planifié.
    // C'est de la veille (ou une suspension), pas du travail.
    if (ecoule > TICK_MS * 3) {
      sommeilCumuleMs += ecoule;
      ticksSansProgres = 0;
      progresDepuisTick = true;
      console.warn(`  ⏸ reprise après ${Math.round(ecoule / 60000)} min d'inactivité système (veille) — non décomptées du budget.`);
      return;
    }

    tempsEveilleMs += ecoule;
    ticksSansProgres = progresDepuisTick ? 0 : ticksSansProgres + 1;
    progresDepuisTick = false;

    if (ticksSansProgres * TICK_MS >= MAX_STALL_MS) {
      tuer(125, `⏰ WATCHDOG PROGRESSION : aucune offre terminée depuis ${MAX_STALL_MS / 60000} min de fonctionnement réel — run figé.`);
    }
    if (tempsEveilleMs >= MAX_TOTAL_RUN_TIME_MS) {
      tuer(124, `⏰⏰⏰ WATCHDOG : ${Math.round(MAX_TOTAL_RUN_TIME_MS / 60000)} min de temps éveillé dépassées, kill forcé.`);
    }
  }, TICK_MS);
  // .unref() : ne retient pas le process quand le run se termine normalement.
  superviseur.unref();
}

// === Chargement des offres ===
const data = loadData();
// Toutes les catégories renvoyées par loadData(), sans exception. La liste était
// figée sur mobile+internet+tv+combo+promo, ce qui laissait 404 offres — les 348
// eSIM Voyage, les 28 prépayées et les 28 SIM Data — hors du scan quotidien :
// 292 offres scannées sur 696, sans que ni le rapport ni le verdict « catalogue
// stable » ne le signalent. C'est très exactement l'angle mort décrit par la
// règle 8 (cas Salt Travel Max) : ce qui n'est jamais lu ne peut jamais être
// flagué. Dériver la liste des données plutôt que la coder en dur garantit
// qu'une future catégorie soit couverte le jour de sa création.
const ALL_CATS = Object.keys(data);
const CATS = CATEGORY ? [CATEGORY] : ALL_CATS;
const pool = [];
for (const cat of CATS) {
  if (!data[cat]) continue;
  for (const item of data[cat]) {
    if (!item.url) continue; // pas d'URL = pas auditable
    pool.push({ ...item, __cat: cat });
  }
}
// Dédup par (cat, url, name) — certaines offres ont la même URL (ex Wingo Migration warning
// partagée). On garde chaque entrée distincte (nom différent), mais on compte
// une seule requête HTTP par URL — les résultats sont ensuite ventilés.
const uniqueUrls = [...new Set(pool.map(o => o.url))];
console.log(`▶ Audit daily : ${pool.length} offres (${uniqueUrls.length} URLs uniques) sur ${CATS.join("+")}`);

// === Contrôle prioritaire : deadlines promo dépassées ===
// Il ne coûte RIEN — aucune page à charger, tout est dans nos données — et il
// répond à la question la plus urgente du matin : « affiche-t-on en ce moment
// un bandeau "probablement expirée" à un visiteur ? ». Placé avant Playwright,
// il s'exécute donc aussi en --dry-run, et il n'est jamais victime d'un
// plantage de navigateur à la 200e URL.
//
// Pourquoi c'est prioritaire : une deadline dépassée est le seul cas où notre
// page affiche d'elle-même un aveu d'incertitude au visiteur. Un prix faux est
// invisible ; un bandeau « probablement expirée » se voit, et se voit d'autant
// plus qu'il traîne. Le 19.08.2026, quinze promos le portaient, certaines
// depuis sept jours — et TOUTES étaient en réalité valables, simplement
// reconduites à une date que personne n'était allé relire.
const promosPerimees = promosExpirees(pool);
const promosBientot = promosQuiExpirentBientot(pool);
if (promosPerimees.length) {
  console.log(`\n⏱ ${promosPerimees.length} promo(s) avec deadline DÉPASSÉE — bandeau « probablement expirée » visible :`);
  for (const p of promosPerimees) {
    console.log(`   [${p.joursDepuis} j] ${p.operator ? p.operator + " — " : ""}${p.name} (fin ${p.to}) → ${p.url}`);
  }
} else {
  console.log("⏱ Aucune deadline promo dépassée.");
}
if (promosBientot.length) {
  console.log(`⏳ ${promosBientot.length} promo(s) expirent dans moins de 48 h.`);
}

if (DRY) {
  console.log("(dry-run — pas de Playwright, exit)");
  process.exit(0);
}

let subset = pool;
if (LIMIT > 0) subset = pool.slice(0, LIMIT);

// === Playwright ===
// Factorisé pour permettre le recyclage browser+context si trop de failures
// consécutives (contexte Chrome pollué par une SPA malformée ou par un pic
// de saturation mémoire).
async function launchBrowser() {
  const br = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const c = await br.newContext({
    userAgent: UA,
    locale: "fr-CH",
    timezoneId: "Europe/Zurich",
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "accept-language": "fr-CH,fr;q=0.9,en;q=0.5" },
  });
  return { br, c };
}

// Ferme le browser sans jamais hanguer : race entre browser.close() propre
// et un kill SIGKILL du process Chrome sous-jacent au bout de 8s.
// Le vrai risque scénario 07.08 : browser.close() attend qu'un socket TCP
// mort réponde, mais Chrome ne libère jamais la connection → hang infini.
async function hardCloseBrowser(br) {
  if (!br) return;
  const proc = br.process?.();
  try {
    await Promise.race([
      br.close().catch(() => {}),
      new Promise((resolve) => setTimeout(() => {
        console.warn("  ⚠ browser.close() > 8s, kill Chrome subprocess");
        try { proc?.kill("SIGKILL"); } catch {}
        resolve();
      }, 8000)),
    ]);
  } catch {}
  // Garde-fou paranoïaque : même si Promise.race retourne, vérifie que le
  // process est mort. Si non, kill.
  try { if (proc && !proc.killed) proc.kill("SIGKILL"); } catch {}
}

let { br: browser, c: ctx } = await launchBrowser();

// Cache par URL : si plusieurs offres pointent vers la même URL, on ne charge
// la page qu'une fois. Économie de temps significative sur les gros opérateurs.
const urlCache = new Map(); // url → { text, pricesOnPage, httpStatus, ... }

// Prix attendus par URL : permet à checkOffer de ne payer ses lectures de
// repli que lorsque la lecture normale n'a pas déjà tout trouvé.
const prixAttendusParUrl = new Map();
for (const item of pool) {
  if (typeof item.price !== "number" || item.price <= 0) continue;
  const liste = prixAttendusParUrl.get(item.url) || [];
  const val = item.price.toFixed(2);
  if (!liste.includes(val)) liste.push(val);
  prixAttendusParUrl.set(item.url, liste);
}

async function getUrlSnapshot(url) {
  if (urlCache.has(url)) return urlCache.get(url);
  // fabrique un "item stub" avec url + price=null pour forcer NON_VÉRIFIABLE
  // et récupérer text + pricesOnPage sans comparer.
  // collectFallbacks : la page n'est ouverte qu'une fois, alors on lui demande
  // aussi ses lectures de repli (HTML rendu, animations Lottie) tant qu'elle
  // est là. Sans ça, le scan quotidien reste aveugle à deux des mécanismes de
  // audit-lib.mjs, qui ne se déclenchent qu'après un échec de comparaison —
  // comparaison que ce chemin fait hors ligne, plus tard. Cf. commentaire dans
  // checkOffer.
  const snap = await checkOffer(ctx, { url, price: null }, {
    waitAfter: 1500,
    collectFallbacks: true,
    expectedPrices: prixAttendusParUrl.get(url) || [],
  });
  urlCache.set(url, snap);
  return snap;
}

const results = [];
let idx = 0;
let consecutiveFailures = 0;
const FAILURE_STATUSES = new Set(["TIMEOUT", "ERREUR", "PAGE_VIDE"]);
for (const item of subset) {
  idx++;
  const t0 = Date.now();
  process.stdout.write(`  [${idx}/${subset.length}] ${item.__cat}/${item.operator || ""}/${item.name} `);
  const snap = await getUrlSnapshot(item.url);
  // Track failure streak & recycle browser si contexte semble bloqué.
  // On ignore les URLs cache-hit (déjà comptées au premier passage) et
  // les whitelist NON_VÉRIFIABLE (pas d'appel Playwright).
  const isFailure = FAILURE_STATUSES.has(snap.status);
  if (isFailure) consecutiveFailures++;
  else if (snap.status !== "NON_VÉRIFIABLE" || snap.text) consecutiveFailures = 0;
  if (consecutiveFailures >= RECYCLE_BROWSER_AFTER_N_CONSECUTIVE_FAILURES) {
    console.log(`\n  ♻ ${consecutiveFailures} failures consécutives → recyclage browser`);
    await hardCloseBrowser(browser);
    urlCache.clear(); // invalidate le cache : le nouveau browser doit tout re-tester
    ({ br: browser, c: ctx } = await launchBrowser());
    consecutiveFailures = 0;
  }
  let verdict;
  if (snap.status === "URL_MORTE" || snap.status === "PAGE_VIDE" || snap.status === "ERREUR" || snap.status === "TIMEOUT") {
    verdict = { ...snap };
  } else if (snap.status === "NON_VÉRIFIABLE" && !snap.text) {
    // Court-circuit whitelist (isNonVerifiableUrl dans audit-lib.mjs) : URL
    // structurellement inextractable. Le stub-item ci-dessus RETOURNE
    // NON_VÉRIFIABLE parce que price=null, mais ce cas-là a text + pricesOnPage
    // (donc snap.text est présent). Le short-circuit whitelist retourne
    // NON_VÉRIFIABLE SANS text (Playwright pas exécuté). Discriminant = text.
    verdict = { status: "NON_VÉRIFIABLE", raison: snap.raison || "URL whitelistée" };
  } else {
    // Comparaison prix stocké vs pricesOnPage
    const expected = typeof item.price === "number" ? item.price.toFixed(2) : null;
    if (!expected || item.price === 0) {
      verdict = { status: "NON_VÉRIFIABLE", pricesOnPage: snap.pricesOnPage };
    } else if (snap.pricesOnPage?.includes(expected)) {
      verdict = { status: "OK", expected, pricesOnPage: snap.pricesOnPage.slice(0, 15) };
    } else if (snap.pricesHtml?.includes(expected)) {
      // Repli 1 : le montant est servi par la page mais pas restitué au texte.
      verdict = { status: "OK", expected, pricesOnPage: snap.pricesHtml.slice(0, 15), source: "html-rendu" };
    } else if (snap.pricesLottie?.includes(expected)) {
      // Repli 2 : le montant est dessiné en animation, et l'animation le nomme.
      verdict = { status: "OK", expected, pricesOnPage: snap.pricesLottie, source: "lottie" };
    } else if (Array.isArray(item.priceParts) && item.priceParts.length
      && item.priceParts.reduce((a, b) => a + Number(b), 0).toFixed(2) === expected
      && item.priceParts.every((p) => snap.pricesOnPage?.includes(Number(p).toFixed(2)))) {
      // Prix composé : le total n'est écrit nulle part, ses composants le sont.
      // Même contrôle que dans checkOffer — cf. le commentaire y figurant.
      verdict = { status: "OK", expected, pricesOnPage: item.priceParts.map((p) => Number(p).toFixed(2)), source: "somme-des-composants" };
    } else if (item.__cat === "travel") {
      // L'onglet Voyage ne se vérifie PAS avec cet instrument, et le dire est
      // plus honnête que de produire 280 ÉCART par jour dont aucun n'est vrai.
      // Deux raisons structurelles, cumulées : une même URL fournisseur porte
      // 7 à 9 forfaits (donc aucune attribution 1-vs-1 possible), et les pages
      // sont à onglets — Airalo n'affiche « Standard » ou « Unlimited » qu'un à
      // la fois. Un scan qui ne clique pas lit forcément un sous-ensemble.
      // L'instrument de référence, lui, existe et clique : les six
      // scripts/collect-<fournisseur>.mjs, dont la sortie alimente travelData
      // (cf. VOYAGE-ESIM.md § 8). Le 19.08.2026, ils ont été rejoués sur les
      // 757 forfaits : zéro différence, alors que le scan criait 280 écarts.
      // Ce que le scan garde donc à sa charge, c'est la FRAÎCHEUR de cette
      // collecte, pas le prix — cf. section « Voyage » du rapport.
      verdict = { status: "NON_COMPARABLE", expected, pricesOnPage: (snap.pricesOnPage || []).slice(0, 8), raison: "onglet Voyage : URL partagée par plusieurs forfaits et page à onglets — vérifié par scripts/collect-<fournisseur>.mjs, pas par ce scan" };
    } else if (!snap.pricesOnPage?.length && !snap.pricesHtml?.length && !snap.pricesLottie?.length) {
      // Aucun prix extractible sur la page. Ce n'est PAS un écart : un écart
      // suppose qu'on a lu un autre prix (c'est le contrat écrit dans
      // audit-lib.mjs — « prix stocké absent de la page MAIS d'autres prix
      // présents »). Ici on n'a rien lu du tout, donc le verdict honnête est
      // « prix inconnu ». Les classer ÉCART, c'était coder dans le script la
      // confusion que la règle 9 interdit explicitement, et noyer les vrais
      // écarts : au 17.08.2026, 282 des 348 offres Voyage sortaient en ÉCART
      // alors que les pages Yesim et Ubigi ne livrent simplement aucun prix.
      verdict = { status: "NON_VÉRIFIABLE", expected, raison: "aucun prix extractible sur la page — prix inconnu, pas prix faux", inconclusive: true };
    } else {
      const near = (snap.pricesOnPage || [])
        .map(p => ({ p, diff: Math.abs(parseFloat(p) - parseFloat(expected)) }))
        .filter(x => x.diff <= parseFloat(expected) * 0.15)
        .sort((a, b) => a.diff - b.diff)
        .slice(0, 3)
        .map(x => x.p);
      verdict = { status: "ÉCART", expected, pricesOnPage: (snap.pricesOnPage || []).slice(0, 15), near };
    }
  }
  const keywords = snap.text ? detectSuspiciousKeywords(snap.text) : [];
  verdict.keywords = keywords;
  const ms = Date.now() - t0;
  const icon = { OK: "✅", ÉCART: "⚠️", URL_MORTE: "❌", PAGE_VIDE: "📭", TIMEOUT: "⏱", ERREUR: "💥", NON_VÉRIFIABLE: "ℹ️", NON_COMPARABLE: "🧭", SKIP_NO_URL: "⏭" }[verdict.status] || "?";
  const kwFlag = keywords.length ? ` [kw:${keywords.length}]` : "";
  console.log(`${icon} ${verdict.status}${kwFlag} (${ms}ms)`);
  results.push({ item, verdict, ms });
  touchProgress();
}

await hardCloseBrowser(browser);

// === Agrégation par verdict ===
const counts = { OK: 0, ÉCART: 0, URL_MORTE: 0, PAGE_VIDE: 0, TIMEOUT: 0, ERREUR: 0, NON_VÉRIFIABLE: 0, NON_COMPARABLE: 0 };
for (const r of results) counts[r.verdict.status] = (counts[r.verdict.status] || 0) + 1;
const withKeywords = results.filter(r => r.verdict.keywords?.length > 0);
const flagged = results.filter(r =>
  // Le Voyage sort du signalement : son verdict dit déjà qu'il relève d'un
  // autre instrument, et le laisser rentrer par la porte des mots-clés
  // marketing (« illimité », « à vie »…) rétablirait exactement le bruit qu'on
  // vient d'enlever.
  r.verdict.status !== "NON_COMPARABLE" && (
  r.verdict.status === "ÉCART" ||
  r.verdict.status === "URL_MORTE" ||
  r.verdict.status === "PAGE_VIDE" ||
  r.verdict.status === "TIMEOUT" ||
  r.verdict.status === "ERREUR" ||
  (r.verdict.keywords?.length > 0))
);
// Règle 9 : « un statut non concluant n'est PAS une vérification ». Ces offres
// ont un prix stocké que le scan n'a pas réussi à lire — elles ne sont ni
// correctes ni fausses, elles sont NON COUVERTES, et le récap doit le dire.
// Sans cette liste, reclasser en NON_VÉRIFIABLE les aurait fait disparaître du
// rapport, ce qui aurait été pire que de les laisser en faux ÉCART : une offre
// invisible ne se fait jamais rattraper (c'est l'histoire de Salt Travel Max).
const inconclusive = results.filter(r => r.verdict.inconclusive);

// === Trigger logic ===
// Date locale (fuseau Europe/Zurich) — évite le drift UTC en fin de journée qui
// afficherait une date "-1" pendant les heures nocturnes CEST.
function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const state = loadState();
const today = todayLocalISO();
const daysSinceFullPass = state.lastFullPassDate
  ? Math.floor((new Date(today) - new Date(state.lastFullPassDate)) / 86400000)
  : null;
const overdue = daysSinceFullPass === null || daysSinceFullPass >= DAYS_BEFORE_FORCED_FULL_PASS;
// Les non concluants comptent dans le trigger : reclasser un faux ÉCART en
// « prix inconnu » ne doit pas rendre le catalogue « stable » par magie. Une
// offre illisible reste une offre à vérifier à la main.
// === Fraîcheur des collectes Voyage ===
// Le scan ne compare pas les prix Voyage (cf. verdict NON_COMPARABLE), donc
// il ne peut pas non plus les certifier. Ce qu'il PEUT surveiller, c'est
// l'âge de la collecte qui, elle, fait autorité. Sans ce garde-fou, sortir
// le Voyage du bruit reviendrait à le sortir de la surveillance.
const VOYAGE_COLLECTE_MAX_AGE_DAYS = 3;
const nonComparable = results.filter(r => r.verdict.status === "NON_COMPARABLE");
let voyageAgeJours = null;
try {
  const fichiers = fs.readdirSync("data").filter(n => /^voyage-.*.json$/.test(n));
  if (fichiers.length) {
    const plusVieux = Math.min(...fichiers.map(n => fs.statSync(path.join("data", n)).mtimeMs));
    voyageAgeJours = Math.floor((Date.now() - plusVieux) / 86400000);
  }
} catch {}
const voyagePerime = nonComparable.length > 0 && voyageAgeJours !== null && voyageAgeJours > VOYAGE_COLLECTE_MAX_AGE_DAYS;

const triggerManual = flagged.length > 0 || inconclusive.length > 0 || overdue || voyagePerime || promosPerimees.length > 0;

// === Rapport markdown ===
const lines = [];
lines.push(`# Daily audit — ${today}`);
lines.push("");
lines.push(`> **Lecture du rapport** : les verdicts sont produits par un scan _automatique_`);
lines.push(`> basé sur une extraction de prix par regex (voir \`scripts/lib/audit-lib.mjs\`).`);
lines.push(`> Ils indiquent des cas **à investiguer manuellement**, pas des vérités.`);
lines.push(`>`);
lines.push(`> - **OK** = le prix stocké apparaît dans le texte visible de la page — présomption`);
lines.push(`>   de validité, pas confirmation absolue (un prix identique par coïncidence sur`);
lines.push(`>   une autre offre au même prix passe aussi OK).`);
lines.push(`> - **ÉCART** = différence de prix détectée automatiquement — **à vérifier manuellement**`);
lines.push(`>   avant toute correction. Peut inclure des faux positifs : SPA qui n'a pas rendu`);
lines.push(`>   les cards, prix d'activation confondu avec prix mensuel, biffé/promo lu à`);
lines.push(`>   l'envers, prix caché derrière une action utilisateur, etc.`);
lines.push(`> - **URL_MORTE** = HTTP 4xx/5xx — attention aux 429 (rate-limit temporaire, URL`);
lines.push(`>   toujours valide) vs 404 (URL réellement à corriger dans \`index.html\`).`);
lines.push(`> - **PAGE_VIDE** = HTTP 200 mais < 100 caractères visibles — protection bot ou`);
lines.push(`>   JS bloqué. À vérifier via browser MCP interactif.`);
lines.push(`> - **TIMEOUT** = dépassement du hard timeout 20 s — la page ne répond pas`);
lines.push(`>   normalement. Cf. AUDIT-COMPLET.md § Garde-fous.`);
lines.push(`> - **NON_VÉRIFIABLE** = pas de \`price\` numérique dans notre data (\`null\`, \`0\`,`);
lines.push(`>   entrée « à partir de… »).`);
lines.push(``);
lines.push(`- **Total offres auditées** : ${results.length}${LIMIT ? ` (limité, catalogue total = ${pool.length})` : ""}`);
lines.push(`- **URLs uniques chargées** : ${urlCache.size}`);
const parRepli = results.filter(r => r.verdict.source);
const detailReplis = [...new Set(parRepli.map(r => r.verdict.source))]
  .map(src => `${src}=${parRepli.filter(r => r.verdict.source === src).length}`)
  .join(", ");
lines.push(`- **Verdicts** : ${Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(", ")}`);
if (parRepli.length) lines.push(`- **OK obtenus par repli** : ${parRepli.length} (${detailReplis}) — prix non restitué au texte de la page, lu autrement (cf. audit-lib.mjs)`);
lines.push(`- **Mots-clés suspects** : ${withKeywords.length} offre(s)`);
lines.push(`- **Dernière passe complète manuelle** : ${state.lastFullPassDate || "(jamais)"}${daysSinceFullPass !== null ? ` (il y a ${daysSinceFullPass} j)` : ""}`);
lines.push("");
lines.push(triggerManual
  ? `## 🚨 AUDIT COMPLET REQUIS`
  : `## ✅ Pas de trigger — automatique OK`);
lines.push("");
if (triggerManual) {
  const reasons = [];
  if (flagged.length > 0) reasons.push(`${flagged.length} offre(s) flaguée(s) (écart/illisible/mots-clés)`);
  if (inconclusive.length > 0) reasons.push(`${inconclusive.length} offre(s) non concluante(s) (prix illisible — règle 9)`);
  if (promosPerimees.length) reasons.push(`${promosPerimees.length} promo(s) affichent « probablement expirée » — à revérifier en priorité`);
  if (voyagePerime) reasons.push(`collectes Voyage vieilles de ${voyageAgeJours} j (seuil : ${VOYAGE_COLLECTE_MAX_AGE_DAYS} j) — relancer les collecteurs`);
  if (overdue) reasons.push(daysSinceFullPass === null
    ? `aucune passe complète manuelle enregistrée à ce jour`
    : `${daysSinceFullPass}j depuis dernière passe complète (seuil : ${DAYS_BEFORE_FORCED_FULL_PASS}j)`);
  lines.push(`**Raison** : ${reasons.join(" · ")}.`);
  lines.push("");
  lines.push(`**Action** : lancer un AUDIT COMPLET manuel (browser MCP + jugement) sur les cas ci-dessous.`);
  lines.push(`Une fois validé + pushé, exécuter :`);
  lines.push("```bash");
  lines.push("node scripts/_audit-catalog.mjs --mark-full-pass");
  lines.push("```");
  lines.push("pour remettre le compteur à zéro.");
  lines.push("");
}

// Section deadlines : en tête, parce que c'est le seul défaut que le visiteur
// voit de ses propres yeux sur le site.
if (promosPerimees.length) {
  lines.push(`### ⏱ DEADLINES PROMO DÉPASSÉES (${promosPerimees.length}) — À TRAITER EN PREMIER`);
  lines.push("");
  lines.push(`> Ces offres affichent **en ce moment** un bandeau « ⏱ Probablement expirée`);
  lines.push(`> le … — vérifie sur le site » sur comparasuisse.ch. Deux issues possibles,`);
  lines.push(`> et une seule se tranche en ouvrant la page de l'opérateur :`);
  lines.push(`>`);
  lines.push(`> - la promo est **terminée** → retirer \`promo\`, \`beforePrice\`,`);
  lines.push(`>   \`promoNote\` et la fenêtre \`from\`/\`to\`, et revenir au prix catalogue ;`);
  lines.push(`> - la promo est **reconduite** → mettre à jour \`to\` avec la nouvelle date.`);
  lines.push(`>`);
  lines.push(`> Aucune ne doit rester ici plus de 24 h : le bandeau dit au visiteur que`);
  lines.push(`> nous ne savons pas, et c'est le seul endroit du site qui l'avoue.`);
  lines.push("");
  for (const p of promosPerimees) {
    lines.push(`- **[${p.joursDepuis} j] ${p.operator ? p.operator + " — " : ""}${p.name}** — fin annoncée \`${p.to}\``);
    lines.push(`  - URL : ${p.url}`);
    if (typeof p.price === "number") lines.push(`  - Prix promo affiché chez nous : CHF ${p.price.toFixed(2)}`);
  }
  lines.push("");
}
if (promosBientot.length) {
  lines.push(`### ⏳ Fenêtres promo qui se ferment sous 48 h (${promosBientot.length})`);
  lines.push("");
  lines.push(`> Préavis, pas alerte : les revérifier maintenant évite le bandeau demain.`);
  lines.push("");
  for (const p of promosBientot) {
    lines.push(`- **${p.operator ? p.operator + " — " : ""}${p.name}** — fin \`${p.to}\` → ${p.url}`);
  }
  lines.push("");
}

// Section Voyage : ce que le scan ne peut pas juger, et qui le juge à sa place.
if (nonComparable.length) {
  lines.push(`### VOYAGE — non comparable par ce scan (${nonComparable.length})`);
  lines.push("");
  lines.push(`> Ces offres partagent leur URL avec 7 à 9 autres forfaits, sur des pages`);
  lines.push(`> à onglets qui n'en rendent qu'un à la fois. Un scan qui ne clique pas lit`);
  lines.push(`> forcément un sous-ensemble : ses écarts seraient faux à presque tous les`);
  lines.push(`> coups (280 le 19.08.2026, aucun réel). **Ce ne sont donc PAS des écarts,`);
  lines.push(`> et ce ne sont pas non plus des vérifications.**`);
  lines.push(`>`);
  lines.push(`> L'instrument qui fait autorité ici est le collecteur, qui clique les`);
  lines.push(`> onglets : \`scripts/collect-<fournisseur>.mjs\` → \`data/voyage-*.json\` →`);
  lines.push(`> \`build-travel-data.mjs --inject\` (cf. VOYAGE-ESIM.md § 8).`);
  lines.push("");
  lines.push(voyageAgeJours === null
    ? `- **Âge des collectes** : inconnu (aucun \`data/voyage-*.json\`)`
    : `- **Âge des collectes** : ${voyageAgeJours} j${voyagePerime ? ` ⚠️ au-delà du seuil de ${VOYAGE_COLLECTE_MAX_AGE_DAYS} j — relancer` : ` (frais)`}`);
  lines.push("");
}

// Section « non concluants » (règle 9) : prix stocké non lisible sur la page.
// Volontairement placée AVANT les écarts : ce sont les offres dont on ne sait
// rien, et ne rien savoir mérite plus d'attention qu'un écart déjà caractérisé.
if (inconclusive.length) {
  lines.push(`### NON CONCLUANTS — prix inconnu, offres NON COUVERTES (${inconclusive.length})`);
  lines.push("");
  lines.push(`> Règle 9 : ces offres ne sont ni confirmées ni infirmées. Le scan n'a extrait`);
  lines.push(`> aucun prix de leur page. Elles doivent être revérifiées à la main (browser MCP`);
  lines.push(`> ou \`audit-probe.mjs\`) ou listées comme non couvertes dans le récap final.`);
  lines.push(`> Ne jamais les compter comme vérifiées.`);
  lines.push("");
  const parCat = {};
  for (const { item } of inconclusive) (parCat[item.__cat] ||= []).push(item);
  for (const [cat, items] of Object.entries(parCat)) {
    lines.push(`- **${cat}** : ${items.length} offre(s) — ${[...new Set(items.map(i => i.url))].length} URL(s) distincte(s)`);
    for (const i of items.slice(0, 12)) lines.push(`  - ${i.operator ? i.operator + " — " : ""}${i.name} (${i.currency || "CHF"} ${i.price}) → ${i.url}`);
    if (items.length > 12) lines.push(`  - … et ${items.length - 12} autre(s) dans la même catégorie`);
  }
  lines.push("");
}

// Section par verdict problématique
const groupBy = (verdict) => results.filter(r => r.verdict.status === verdict);
for (const v of ["ÉCART", "URL_MORTE", "PAGE_VIDE", "TIMEOUT", "ERREUR"]) {
  const g = groupBy(v);
  if (!g.length) continue;
  lines.push(`### ${v} (${g.length})`);
  for (const { item, verdict } of g) {
    lines.push(`- **[${item.__cat}] ${item.operator ? item.operator + " — " : ""}${item.name}**`);
    lines.push(`  - URL : ${item.url}`);
    // La devise vient de l'offre : travelData facture en USD chez Ubigi et en
    // EUR chez Yesim. Écrire « CHF » en dur affichait « CHF 0.45 » pour un
    // prix qui est en réalité de 0.45 EUR — un rapport de vérification qui se
    // trompe lui-même d'unité.
    if (verdict.expected) lines.push(`  - Prix stocké : ${item.currency || "CHF"} ${verdict.expected}`);
    if (verdict.pricesOnPage?.length) lines.push(`  - Prix trouvés : ${verdict.pricesOnPage.join(", ")}`);
    if (verdict.near?.length) lines.push(`  - Prix proches (±15%) : ${verdict.near.join(", ")}`);
    if (verdict.httpStatus) lines.push(`  - HTTP : ${verdict.httpStatus}`);
    if (verdict.hardTimeoutMs) lines.push(`  - Hard timeout : ${verdict.hardTimeoutMs}ms`);
    if (verdict.error) lines.push(`  - Erreur : \`${verdict.error}\``);
    if (verdict.keywords?.length) lines.push(`  - Mots-clés : ${verdict.keywords.join(", ")}`);
  }
  lines.push("");
}

// Section mots-clés (offres OK mais avec keywords suspects — à re-lire même
// si le prix matche, pour détecter fake urgency ou promo cachée)
const kwOnly = withKeywords.filter(r => r.verdict.status === "OK");
if (kwOnly.length) {
  lines.push(`### Mots-clés suspects sur offres OK (${kwOnly.length})`);
  lines.push(`> Ces offres ont un prix qui matche mais un vocabulaire marketing agressif — à re-vérifier périodiquement pour attraper les fake urgency / promos re-lancées.`);
  lines.push("");
  for (const { item, verdict } of kwOnly) {
    lines.push(`- **[${item.__cat}] ${item.operator || ""} ${item.name}** — mots-clés : ${verdict.keywords.join(", ")}`);
    lines.push(`  - URL : ${item.url}`);
  }
  lines.push("");
}

lines.push("---");
lines.push("");

// === Sauvegarde : append en tête (rolling log, récent en haut) ===
// Idempotence : si un bloc du jour existe déjà, on le remplace au lieu de doubler.
// Limite : on ne conserve que les MAX_RUNS_KEPT_IN_LOG derniers blocs — évite
// que le fichier explose (chaque run pèse 30-50 KB, un empilement d'une semaine
// se lit encore d'un coup, au-delà on perd la vue d'ensemble).
fs.mkdirSync("scripts", { recursive: true });
let prev = "";
if (fs.existsSync(LOG_PATH)) prev = fs.readFileSync(LOG_PATH, "utf8");
prev = prev.replace(new RegExp(`# Daily audit — ${today}[\\s\\S]*?(?=# Daily audit — |$)`), "");
// Découpe le prev en blocs et garde les N-1 plus récents (le nouveau bloc
// qu'on ajoute en tête complètera à N).
const prevBlocks = prev.split(/(?=# Daily audit — )/).filter(b => b.trim().length);
const kept = prevBlocks.slice(0, Math.max(0, MAX_RUNS_KEPT_IN_LOG - 1));
fs.writeFileSync(LOG_PATH, lines.join("\n") + kept.join(""));

// === État persistant ===
state.lastRunDate = today;
state.runs = state.runs || [];
state.runs.unshift({
  date: today,
  total: results.length,
  urlsUnique: urlCache.size,
  counts,
  withKeywords: withKeywords.length,
  flagged: flagged.length,
  overdue,
  triggerManual,
});
state.runs = state.runs.slice(0, 30); // 30 derniers runs
saveState(state);

console.log("");
console.log(`   Durée : ${Math.round(tempsEveilleMs / 60000)} min de temps éveillé${sommeilCumuleMs > 0 ? ` (+ ${Math.round(sommeilCumuleMs / 60000)} min de veille système, hors budget)` : ""}`);
console.log(`✅ Rapport écrit dans ${LOG_PATH}`);
console.log(`   Résumé : ${Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(", ")}`);
console.log(`   Mots-clés suspects : ${withKeywords.length}`);
console.log(triggerManual
  ? `🚨 AUDIT COMPLET requis (${flagged.length} flags${overdue ? `, ${daysSinceFullPass === null ? "aucune passe complète enregistrée" : daysSinceFullPass + "j sans passe complète"}` : ""})`
  : `✅ Pas de trigger manuel — pipeline auto OK`);

// === Helpers state ===
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
  catch { return { runs: [] }; }
}
function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}
