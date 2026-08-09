// Mini-QA à lancer APRÈS CHAQUE COMMIT touchant index.html.
// Trois contrôles, ~15 s. Sort en code 1 si l'un échoue.
//
//   node scripts/qa-quick.mjs
//
// 1. Syntaxe JS du plus gros bloc <script> inline
// 2. Chargement de index.html dans un vrai Chrome — zéro erreur console
// 3. Comptages d'onglets alignés sur les données + checkboxes operator complètes
//
// Pourquoi : un commit cassé découvert en fin de campagne coûte bien plus cher
// qu'un contrôle de 15 s. Cf. AUDIT-COMPLET.md § « Mini-QA après chaque commit ».

import fs from "fs";
import { pathToFileURL } from "url";
import { chromium } from "playwright-core";
import { loadData } from "./lib/audit-lib.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const INDEX = `${ROOT}/index.html`;
const fail = [];
const ok = (m) => console.log(`  ✅ ${m}`);
const ko = (m) => {
  console.log(`  ❌ ${m}`);
  fail.push(m);
};

// ── 1. Syntaxe
const html = fs.readFileSync(INDEX, "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const largest = scripts.reduce((a, b) => (b.length > a.length ? b : a), "");
const tmp = `${ROOT}/.qa-quick.tmp.mjs`;
fs.writeFileSync(tmp, largest);
try {
  const { execFileSync } = await import("child_process");
  execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  ok(`syntaxe JS valide (${scripts.length} blocs <script>, plus gros = ${largest.length} chars)`);
} catch (e) {
  ko(`SYNTAXE JS INVALIDE : ${String(e.stderr || e).slice(0, 300)}`);
} finally {
  fs.rmSync(tmp, { force: true });
}
if (fail.length) {
  console.log("\nMini-QA ÉCHOUÉ — corrige avant de continuer.");
  process.exit(1);
}

// ── 2 & 3. Navigateur
const data = await loadData();
const expected = {
  mobile: data.mobile.length,
  prepaid: data.prepaid.length,
  internet: data.internet.length,
  dataonly: data.dataOnly.length,
  tv: data.tv.length,
  combo: data.combo.length,
  promo: data.promo.length,
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await (await browser.newContext({ locale: "fr-CH", viewport: { width: 1400, height: 1200 } })).newPage();

// Les chemins absolus (/favicon.svg) et les pixels de tracking ne résolvent pas
// sous file:// — ce sont des artefacts du protocole, pas des régressions.
const IGNORE = /favicon|og-image|apple-touch-icon|googletagmanager|google\.com\/(ccm|rmkt)|doubleclick|ERR_FILE_NOT_FOUND/i;
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!IGNORE.test(t)) errors.push(`console: ${t.slice(0, 160)}`);
});

await page.goto(pathToFileURL(INDEX).href, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

if (errors.length) errors.forEach((e) => ko(e));
else ok("aucune erreur console (artefacts file:// et pixels de tracking exclus)");

// Comptages par onglet
for (const [tab, n] of Object.entries(expected)) {
  await page.evaluate((id) => document.querySelector(`[data-tab="${id}"]`)?.click(), tab);
  await page.waitForTimeout(320);
  const txt = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".count")].find((e) => e.offsetParent !== null);
    return el ? el.innerText.replace(/\s+/g, " ") : "";
  });
  const m = txt.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) ko(`onglet ${tab} : compteur introuvable`);
  else if (+m[2] !== n) ko(`onglet ${tab} : le compteur annonce ${m[2]}, les données en contiennent ${n}`);
  else ok(`onglet ${tab} : ${m[1]}/${m[2]} — aligné sur les données`);
}

// Checkboxes operator (bug historique récurrent)
const declared = await page.evaluate(() => {
  const out = {};
  document.querySelectorAll("input[data-op]").forEach((c) => {
    const sec = c.closest("[id]")?.id || "?";
    (out[sec] = out[sec] || []).push(c.dataset.op);
  });
  return out;
});
for (const [arr, sec] of [["tv", "tv-operator"], ["combo", "combo-operator"], ["dataOnly", "dataonly-operator"]]) {
  const ops = [...new Set(data[arr].map((x) => x.operator).filter(Boolean))];
  const have = declared[sec] || [];
  const missing = ops.filter((o) => !have.includes(o));
  if (missing.length) ko(`checkbox operator manquante dans #${sec} : ${missing.join(", ")}`);
  else ok(`checkboxes #${sec} : ${ops.length} operators tous déclarés`);
}

await browser.close();

console.log(
  fail.length
    ? `\nMini-QA ÉCHOUÉ (${fail.length}) — corrige immédiatement, avant la tâche suivante.`
    : "\nMini-QA OK."
);
process.exit(fail.length ? 1 : 0);
