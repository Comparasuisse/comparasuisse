// Sonde Playwright pour AUDIT COMPLET + AUDIT COUNTDOWN (cf. AUDIT-COMPLET.md).
//
// Complete _audit-catalog.mjs : là où le scan quotidien se contente de comparer
// un prix, cette sonde rend la page dans un vrai Chrome et remonte en plus les
// widgets de compte à rebours, les mentions « à vie », et les deadlines cachées
// dans les scripts inline — exactement ce que WebFetch rate (cas Mucho/GoMo).
//
// Usage : node scripts/audit-probe.mjs <urls.txt|url> [--full] [--grep=motif]
//   --full        joint le innerText complet dans le JSON de sortie
//   --grep=motif  extrait les lignes de la page matchant le motif
//   PROBE_OUT=x.json  écrit le résultat structuré dans x.json
// Sortie compacte JSON-lines : prix rendus, widgets countdown, deadlines inline.

import fs from "fs";
import { chromium } from "playwright-core";

const CHROME_PATH =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const args = process.argv.slice(2);
const full = args.includes("--full");
const grepArg = args.find((a) => a.startsWith("--grep="));
const grep = grepArg ? new RegExp(grepArg.slice(7), "i") : null;
const target = args.find((a) => !a.startsWith("--"));
let urls = [];
if (fs.existsSync(target)) {
  urls = fs
    .readFileSync(target, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
} else urls = [target];

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"],
});
const ctx = await browser.newContext({
  userAgent: UA,
  locale: "fr-CH",
  timezoneId: "Europe/Zurich",
  viewport: { width: 1400, height: 1000 },
  extraHTTPHeaders: { "accept-language": "fr-CH,fr;q=0.9,en;q=0.5" },
});

const results = [];
for (const url of urls) {
  const page = await ctx.newPage();
  const rec = { url, status: null, err: null };
  try {
    const resp = await Promise.race([
      page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }),
      new Promise((_, r) => setTimeout(() => r(new Error("goto-timeout")), 32000)),
    ]);
    rec.status = resp?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    // Neutraliser les modales cookie sans les accepter (règle privacy)
    await page
      .evaluate(() => {
        document
          .querySelectorAll(
            '[class*="cookie"],[class*="consent"],[id*="cookie"],[id*="onetrust"],[role="dialog"]'
          )
          .forEach((m) => (m.style.display = "none"));
        document.documentElement.style.overflow = "auto";
        document.body.style.overflow = "auto";
      })
      .catch(() => {});
    await page.waitForTimeout(2500);

    const data = await page.evaluate(() => {
      const text = document.body.innerText || "";
      // Prix CHF visibles
      const prices = [
        ...new Set(
          (text.match(/(?:CHF\s*)?\b\d{1,4}[.,]\d{2}\b(?:\s*(?:CHF|\.-))?/g) || [])
            .map((s) => s.replace(/[^\d.,]/g, "").replace(",", "."))
            .filter((s) => /^\d+\.\d{2}$/.test(s))
        ),
      ];
      // Widgets countdown
      const cdSel =
        '.timer-container,.countdown,[class*="countdown"],[class*="expirable"],lib-countdown,[class*="timer"],slt-announcement-bar,[class*="urgency"]';
      const widgets = [...document.querySelectorAll(cdSel)]
        .map((e) => ({
          tag: e.tagName.toLowerCase(),
          cls: (e.className || "").toString().slice(0, 60),
          txt: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160),
        }))
        .filter((w) => w.txt);
      // Textes d'urgence dans le corps
      const urgency = (
        text.match(
          /[^\n]{0,90}(il te reste|il vous reste|jours?\s*\d+\s*h|\d+\s*j\s*\d+\s*h|expire|jusqu'au|à saisir|dernière chance|last chance|se termine|verbleib|noch \d+)[^\n]{0,90}/gi
        ) || []
      )
        .map((s) => s.replace(/\s+/g, " ").trim())
        .slice(0, 12);
      // Mentions "à vie"/permanent
      const forever = (
        text.match(/[^\n]{0,90}(à vie|a vie|pour toujours|für immer|permanent|lebenslang)[^\n]{0,90}/gi) ||
        []
      )
        .map((s) => s.replace(/\s+/g, " ").trim())
        .slice(0, 10);
      // Deadlines dans les scripts inline
      const scripts = [...document.querySelectorAll("script")]
        .map((s) => s.textContent || "")
        .join("\n");
      const dates = [
        ...new Set(
          (scripts.match(/\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?/g) || []).filter(
            (d) => d >= "2026-08-01" && d <= "2027-12-31"
          )
        ),
      ].slice(0, 12);
      // data-attributs de deadline
      const dataDl = [...document.querySelectorAll("[data-end],[data-deadline],[data-expire],[data-until],[data-countdown]")]
        .map((e) => e.getAttribute("data-end") || e.getAttribute("data-deadline") || e.getAttribute("data-expire") || e.getAttribute("data-until") || e.getAttribute("data-countdown"))
        .filter(Boolean)
        .slice(0, 8);
      return { prices, widgets, urgency, forever, dates, dataDl, text };
    });

    rec.prices = data.prices;
    rec.widgets = data.widgets;
    rec.urgency = data.urgency;
    rec.forever = data.forever;
    rec.dates = data.dates;
    rec.dataDl = data.dataDl;
    rec.len = data.text.length;
    if (full) rec.text = data.text;
    if (grep) {
      rec.grep = (data.text.match(new RegExp(`[^\\n]{0,120}${grep.source}[^\\n]{0,120}`, "gi")) || [])
        .map((s) => s.replace(/\s+/g, " ").trim())
        .slice(0, 15);
    }
  } catch (e) {
    rec.err = e.message.slice(0, 120);
  }
  await page.close().catch(() => {});
  results.push(rec);

  // Sortie immédiate compacte
  console.log("──────────────────────────────────────────");
  console.log(`URL ${rec.url}`);
  if (rec.err) {
    console.log(`  ERREUR: ${rec.err}`);
  } else {
    console.log(`  HTTP ${rec.status} | ${rec.len} chars`);
    console.log(`  PRIX: ${(rec.prices || []).join(", ") || "(aucun)"}`);
    if (rec.widgets?.length) {
      // Dédupe : les countdowns imbriquent segment/number/label, on garde les
      // conteneurs les plus informatifs.
      const seen = new Set();
      rec.widgets
        .filter((w) => w.txt.length > 12)
        .filter((w) => (seen.has(w.txt) ? false : seen.add(w.txt)))
        .slice(0, 4)
        .forEach((w) => console.log(`  ⏰ WIDGET <${w.tag} class="${w.cls}"> : ${w.txt}`));
    }
    if (rec.urgency?.length) rec.urgency.forEach((u) => console.log(`  ⚠ URGENCE: ${u}`));
    if (rec.forever?.length) rec.forever.forEach((f) => console.log(`  ♾ AVIE: ${f}`));
    if (rec.dates?.length) console.log(`  📅 DATES-SCRIPT: ${rec.dates.join(", ")}`);
    if (rec.dataDl?.length) console.log(`  📅 DATA-ATTR: ${rec.dataDl.join(", ")}`);
    if (rec.grep?.length) rec.grep.forEach((g) => console.log(`  🔎 ${g}`));
  }
}

if (process.env.PROBE_OUT) fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify(results, null, 1));
await browser.close();
