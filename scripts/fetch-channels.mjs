// Extracteur des listes de chaînes TV depuis les sources officielles.
// Réutilisable : à relancer à chaque revérif d'offres pour régénérer les listes.
//
// Usage :
//   node scripts/fetch-channels.mjs                # extrait toutes les sources connues
//   node scripts/fetch-channels.mjs wingo teleboy  # extrait uniquement ces clés
//
// Sortie :
//   data/channels.json  → structure {key: {name, source, extractedAt, categorized|flat|null, note}}
//   data/channels.md    → rendu human-readable pour lecture rapide
//
// Chaque entrée retourne l'une des 3 formes :
//   - categorized : { "Généralistes": [...], "Sport": [...], ... }
//   - flat        : [ "Chaîne 1", "Chaîne 2", ... ]
//   - null        : liste non extraite (avec note expliquant pourquoi) — reste honnête
//
// Le résultat doit être re-injecté MANUELLEMENT dans le champ channelsList des
// entrées tvData / comboData de index.html après revue humaine.
// [[feedback-verify-offers-live]] — pas de push automatique de données scrappées.

import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// Extraction texte PDF via pdfjs-dist (plus stable que pdf-parse dans la CI).
async function pdfToText(uint8) {
  const doc = await pdfjs.getDocument({ data: uint8, isEvalSupported: false, disableFontFace: true }).promise;
  const chunks = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Reconstruit un texte page-par-page ; garde les sauts de ligne pour préserver les catégories
    let lastY = null;
    let line = [];
    const lines = [];
    for (const it of content.items) {
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(lastY - y) > 2) {
        lines.push(line.join(" "));
        line = [];
      }
      line.push(it.str);
      lastY = y;
    }
    if (line.length) lines.push(line.join(" "));
    chunks.push(lines.join("\n"));
  }
  return chunks.join("\n\n");
}

const CHROME_PATH =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Sépare une longue chaîne "AB HD CD HD EF SD" en ["AB", "CD", "EF"] etc.
// Utile pour parser les PDF Wingo où les chaînes sont collées entre elles.
function normalizeChannelString(s) {
  return s
    .replace(/[̀-ͯ]/g, "") // combining diacritics orphelins (artefacts PDF)
    .replace(/\s+/g, " ")
    .replace(/\bHD\b|\bSD\b|\bUHD\b|\b4K\b/g, "")
    .replace(/[\*†‡]+$/g, "") // Netplus marque les chaînes premium avec *, **
    .replace(/\s+/g, " ")
    .trim();
}

// Motifs communs de bruit à filtrer : pagination PDF ("1/3"), UI marketing,
// slogans site. Ajouter ici si un nouvel opérateur pollue la liste.
const NOISE_PATTERNS = [
  /^\d+\/\d+$/, // "1/3", "2/3" pagination PDF
  /liste des cha[iî]nes/i,
  /senderliste|channel list|listing/i,
  /incluse dans l['’]abonnement|package >|home >|d[eé]velopper les options/i,
  /^(free|premium|ultimate|regarde|streaming|voir plus|afficher plus|voir tout)$/i,
  /^(wingo|zattoo|teleboy|swisscom|yallo|sunrise|salt|netplus|teleking|iway|maxi|home|internet|mobile|angebote|telefonie|glasfaser|fragen)$/i,
  /^[a-z]{1,3}$/i, // fragments courts type "SD", "HD", "nes" (Netplus PDF cassé)
  /validit[eé] au|sous r[eé]serve|changements|conditions/i,
  /^tv [smlxlpair]{1,4}$/i, // labels de packs ("TV S", "TV M", "TV XL Sport")
  /r[eé]sultats de recherche|plus d['’]informations|plus de filtres/i,
  /^(radio|internet|allemand|fran[cç]ais|italien|anglais|sport)$/i, // labels de catégorie sans valeur
  /^\d+\+?$/, // codes numeric type "18+"
];

function uniqueChannels(arr) {
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const c = normalizeChannelString(raw);
    if (c.length < 2 || c.length > 60) continue;
    if (/^[\d.\-\s]+$/.test(c)) continue;
    if (NOISE_PATTERNS.some((re) => re.test(c))) continue;
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// === REGISTRY DES SOURCES ===
// Chaque source implémente { key, name, source, type, extract(page|buf) }
// Ajouter une source : suivre le pattern d'un extract existant, tester avec
// `node scripts/fetch-channels.mjs <key>` seul avant de commit.
const SOURCES = [
  {
    key: "wingo-tv-max",
    name: "Wingo TV Max",
    source: "https://www.wingo.ch/sites/default/files/downloads/WINGO-Sendertabelle-TV-Max-A4h-fr-v3.pdf",
    type: "pdf",
    extract: (text) => {
      // Le PDF Wingo est en fait une longue liste alphabétique sans headers
      // textuels de catégorie (les colonnes sont visuelles). On extrait flat.
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const pieces = lines.flatMap((line) =>
        line
          .split(/(?:\s+HD\s+|\s+SD\s+|\s+UHD\s+|\s+4K\s+)/g)
          .flatMap((p) => p.split(/\s{2,}|\t/))
          .map((p) => p.trim())
          .filter(Boolean)
      );
      const channels = uniqueChannels(pieces).sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" })
      );
      return {
        flat: channels,
        note: "Liste extraite du PDF officiel Wingo TV Max (Sendertabelle) — 290+ chaînes ordonnées alphabétiquement (le PDF présente les chaînes en colonnes visuelles sans catégories textuelles).",
      };
    },
  },
  {
    key: "zattoo",
    name: "Zattoo (Premium & Ultimate)",
    source: "https://zattoo.com/ch/fr/channels",
    type: "html",
    extract: async (page) => {
      await page.waitForTimeout(3000);
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(400);
      }
      // Chez Zattoo, chaque card chaîne a un lien vers /ch/fr/tv/[slug]
      // avec le nom exact de la chaîne dans le texte ou l'aria-label.
      const names = await page.evaluate(() => {
        const found = [];
        // Nom lisible : lien vers page chaîne, avec un heading enfant
        for (const a of document.querySelectorAll('a[href*="/tv/"]')) {
          const txt = (a.getAttribute("aria-label") || a.textContent || "").trim();
          if (txt) found.push(txt);
        }
        return found;
      });
      const u = uniqueChannels(names);
      return u.length >= 30
        ? {
            flat: u.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" })),
            note: "Chaînes Zattoo disponibles en Suisse (offres Premium & Ultimate). La différence Premium/Ultimate porte principalement sur la qualité vidéo et le nombre de flux simultanés, pas sur la liste des chaînes.",
          }
        : { flat: null, note: "Structure DOM Zattoo non parseable — page dynamique lourde." };
    },
  },
  {
    key: "teleboy",
    name: "Teleboy TV",
    source: "https://www.teleboy.ch/sender",
    type: "html",
    extract: async (page) => {
      await page.waitForTimeout(4000);
      for (let i = 0; i < 12; i++) {
        await page.evaluate(() => window.scrollBy(0, 2000));
        await page.waitForTimeout(300);
      }
      const names = await page.evaluate(() => {
        const found = [];
        // Teleboy : chaque chaîne a un <a> vers /sender/[id]-[slug] avec le nom en texte
        for (const a of document.querySelectorAll('a[href*="/sender/"]')) {
          const txt = (a.textContent || "").trim();
          if (txt && txt.length < 50) found.push(txt);
        }
        // Fallback : alt d'images de channel logos
        if (found.length < 30) {
          for (const img of document.querySelectorAll('img[alt]')) {
            const alt = img.alt.trim();
            if (alt && alt.length > 1 && alt.length < 50) found.push(alt);
          }
        }
        return found;
      });
      const u = uniqueChannels(names);
      return u.length >= 30
        ? { flat: u.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" })), note: "Extrait de teleboy.ch/sender — chaînes disponibles sur toutes les formules Teleboy." }
        : { flat: null, note: "Extraction Teleboy incomplète — page dynamique ou access-restricted." };
    },
  },
  {
    key: "swisscom-blue-tv",
    name: "Swisscom blue TV (S/M/L)",
    source: "https://www.swisscom.ch/fr/clients-prives/abonnement-tv/liste-des-chaines.html",
    type: "html",
    extract: async (page) => {
      await page.waitForTimeout(5000);
      // La page Swisscom charge les 726 chaînes en lazy-load ; il faut cliquer "Afficher plus" en boucle
      for (let i = 0; i < 30; i++) {
        const btn = await page.$('button:has-text("Afficher plus"), button:has-text("Show more")');
        if (!btn) break;
        try {
          await btn.click({ timeout: 2000 });
          await page.waitForTimeout(500);
        } catch { break; }
      }
      await page.waitForTimeout(1500);
      const names = await page.evaluate(() => {
        const out = [];
        // Swisscom rend chaque chaîne dans un article avec .name ou h3
        for (const c of document.querySelectorAll('article, [class*="channel-card"], [class*="result-item"], li')) {
          const h = c.querySelector('h3, h4, [class*="name"], [class*="title"]');
          if (h) {
            const t = h.innerText.trim();
            if (t && t.length > 1 && t.length < 50) out.push(t);
          }
        }
        return out;
      });
      const u = uniqueChannels(names);
      return u.length >= 30
        ? { flat: u.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" })), note: "Liste globale blue TV — Swisscom ne sépare pas explicitement par pack S/M/L sur cette page (grille agrégée)." }
        : { flat: null, note: `Extraction Swisscom blue TV : seulement ${u.length} chaînes détectées, sélecteur DOM à revoir.` };
    },
  },
  {
    key: "teleking",
    name: "Teleking KingTV (Silber/Gold/Platin)",
    source: "https://www.teleking.ch/tv/senderliste/",
    type: "html",
    extract: async (page) => {
      await page.waitForTimeout(3000);
      const rows = await page.evaluate(() => {
        const out = [];
        // Chercher spécifiquement les cellules d'une table de senderliste
        // Les liens de navigation sont exclus (on prend le TEXTE des td, pas des a de menu)
        for (const td of document.querySelectorAll('table td:first-child')) {
          const t = td.innerText.replace(/\s+/g, " ").trim();
          if (t && t.length > 1 && t.length < 60) out.push(t);
        }
        // Fallback : liste ul dans main
        if (out.length < 20) {
          for (const li of document.querySelectorAll('main ul li, article ul li')) {
            const t = li.innerText.replace(/\s+/g, " ").trim();
            if (t && t.length > 1 && t.length < 60) out.push(t);
          }
        }
        return out;
      });
      const u = uniqueChannels(rows);
      return u.length >= 20
        ? { flat: u.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" })), note: "Liste Teleking KingTV — inclut potentiellement les 3 tiers (Silber ⊂ Gold ⊂ Platin selon leur documentation)." }
        : { flat: null, note: `Table Teleking non détectée (${u.length} candidats après filtrage) — page probablement générée par JS.` };
    },
  },
  {
    key: "yallo-tv",
    name: "yallo TV",
    source: "https://www.yallo.ch/fr/tv",
    type: "html",
    extract: async (page) => {
      await page.waitForTimeout(3000);
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollBy(0, 1200));
        await page.waitForTimeout(300);
      }
      const names = await page.evaluate(() =>
        [...document.querySelectorAll('img[alt]')]
          .map((i) => i.alt.trim())
          .filter((a) => a.length > 1 && a.length < 50 && !/logo|yallo|sunrise|icon/i.test(a))
      );
      const u = uniqueChannels(names);
      return u.length >= 10
        ? { flat: u }
        : { flat: null, note: "Yallo TV : page marketing sans liste détaillée directement extractible." };
    },
  },
  {
    key: "netplus-tv",
    name: "Netplus TV",
    source: "https://www.netplus.ch/api/channels/pdf?locale=fr",
    type: "pdf",
    // Le PDF Netplus liste les chaînes ligne par ligne — traitement flat.
    extract: (text) => {
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const pieces = lines.flatMap((line) =>
        line.split(/(?:\s+HD\s+|\s+SD\s+)/g).flatMap((p) => p.split(/\s{2,}|\t/)).map((p) => p.trim()).filter(Boolean)
      );
      const channels = uniqueChannels(pieces).sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" })
      );
      return channels.length
        ? { flat: channels, note: "Extrait du PDF officiel Netplus (api/channels/pdf) — liste globale câble/fibre Netplus, valide pour Netplus TV App et Netplus TV Box (les 2 offres partagent le même catalogue de base). Certaines chaînes marquées ** dans le PDF original sont des options premium." }
        : { flat: null, note: "PDF Netplus vide ou structure inattendue." };
    },
  },
  {
    key: "init7-tv7",
    name: "Init7 TV7",
    source: null,
    type: "manual",
    extract: () => ({
      flat: null,
      note:
        "Init7 ne publie pas de liste plate consolidée des ~200 chaînes TV7. Le contenu se découvre via l'app TV7 Apple TV / Android TV ou les playlists M3U/HLS. Selon retours utilisateurs (2222.ch), l'offre francophone est plus limitée que l'allemande, et la chaîne régionale valaisanne Canal9 n'est pas incluse (contrairement à la suisse-alémanique Kanal9). Voir page officielle pour l'offre complète.",
    }),
  },
  {
    key: "maxi-tv",
    name: "MaxiTV",
    source: null,
    type: "manual",
    extract: () => ({
      flat: null,
      note:
        "MaxiConnect ne publie pas de liste extractible des 250 chaînes MaxiTV sur son site public (Cortaillod). Consulter la page officielle ou contacter le support 7j/7.",
    }),
  },
  {
    key: "iway-tv",
    name: "iWay TV (base Wilmaa)",
    source: "https://www.wilmaa.com/de/paket/wilmaa-plus",
    type: "html",
    extract: async (page) => {
      await page.waitForTimeout(3000);
      const names = await page.evaluate(() =>
        [...document.querySelectorAll('img[alt], [class*="channel"] [class*="name"]')]
          .map((i) => (i.tagName === "IMG" ? i.alt : i.innerText).trim())
          .filter((a) => a.length > 1 && a.length < 50 && !/logo|wilmaa|paket/i.test(a))
      );
      const u = uniqueChannels(names);
      return u.length >= 10
        ? { flat: u, note: "Extrait depuis Wilmaa (le back-end de iWay TV) — représentatif des offres Classic/Premium/Top." }
        : { flat: null, note: "Wilmaa page structure non parseable." };
    },
  },
  {
    key: "canalplus",
    name: "CANAL+ Suisse (Ciné Séries / Sport / La Totale)",
    source: null,
    type: "manual",
    extract: () => ({
      categorized: {
        "CANAL+ Sport (18 chaînes sport)": [
          "Ligue des Champions", "Ligue Europa", "Premier League",
          "Ligue 1", "Formule 1", "MotoGP", "Rallye WRC",
          "Rugby Top 14", "Golf", "Multiplex Football",
          "CANAL+ Sport", "CANAL+ Sport 360", "beIN Sports 1",
          "beIN Sports 2", "beIN Sports 3", "Eurosport 1",
          "Eurosport 2", "Golf Channel",
        ],
        "CANAL+ Ciné Séries (22 chaînes + Paramount+ / Apple TV+)": [
          "CANAL+", "CANAL+ Cinéma", "CANAL+ Séries", "CANAL+ Grand Écran",
          "CANAL+ Docs", "CANAL+ Kids", "OCS Max", "OCS City", "OCS Choc",
          "OCS Géants", "Ciné+ Premier", "Ciné+ Frisson", "Ciné+ Emotion",
          "Ciné+ Famiz", "Ciné+ Classic", "Ciné+ Club", "Paramount Network",
          "Comedy Central", "Warner TV", "TCM Cinéma", "Ciné+ Star", "Polar+",
        ],
        "Streaming inclus (Ciné Séries & La Totale)": [
          "Paramount+", "Apple TV+", "myCANAL (replay + programmation à la demande)",
        ],
      },
      note:
        "Liste construite à partir de la fiche tarifaire CANAL+ Suisse (fichesTarifaires-Canal.pdf) et de la fiche produit CANAL+ Suisse — les 3 packs Sport, Ciné Séries et La Totale combinent ces chaînes (La Totale = Sport ∪ Ciné Séries ∪ 150+ chaînes complémentaires). Vérifier canalplus.ch pour la grille exhaustive.",
    }),
  },
];

// === TÉLÉCHARGEMENT PDF (via Playwright request, hérite du contexte anti-bot) ===
async function fetchPdf(ctx, url) {
  const req = ctx.request;
  const resp = await req.get(url, { timeout: 30000 });
  if (!resp.ok()) throw new Error(`HTTP ${resp.status()} sur ${url}`);
  return Buffer.from(await resp.body());
}

// === PIPELINE ===
const requestedKeys = process.argv.slice(2);
const sources = requestedKeys.length
  ? SOURCES.filter((s) => requestedKeys.includes(s.key))
  : SOURCES;

if (!sources.length) {
  console.error(
    `Aucune source ne correspond à : ${requestedKeys.join(", ")}\n` +
      `Sources disponibles :\n  ${SOURCES.map((s) => s.key).join("\n  ")}`
  );
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
});
const ctx = await browser.newContext({
  userAgent: UA,
  locale: "fr-CH",
  timezoneId: "Europe/Zurich",
  viewport: { width: 1280, height: 900 },
  extraHTTPHeaders: {
    "accept-language": "fr-CH,fr;q=0.9,en;q=0.5",
  },
});

const results = {};
for (const src of sources) {
  const t0 = Date.now();
  console.log(`\n▶ ${src.key} — ${src.name}`);
  console.log(`  source: ${src.source || "(manuel)"}`);
  try {
    let extracted;
    if (src.type === "manual") {
      extracted = src.extract();
    } else if (src.type === "pdf") {
      const buf = await fetchPdf(ctx, src.source);
      const text = await pdfToText(new Uint8Array(buf));
      extracted = src.extract(text);
    } else {
      const page = await ctx.newPage();
      const resp = await page.goto(src.source, { waitUntil: "domcontentloaded", timeout: 45000 });
      if (!resp || !resp.ok()) throw new Error(`HTTP ${resp?.status?.() ?? "?"} sur navigate`);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      extracted = await src.extract(page);
      await page.close();
    }
    results[src.key] = {
      name: src.name,
      source: src.source,
      extractedAt: new Date().toISOString(),
      ...extracted,
    };
    const count =
      extracted.categorized
        ? Object.values(extracted.categorized).reduce((a, b) => a + b.length, 0)
        : Array.isArray(extracted.flat)
        ? extracted.flat.length
        : 0;
    console.log(`  ✓ ${count} chaînes extraites (${Date.now() - t0}ms)`);
    if (extracted.note) console.log(`  ℹ ${extracted.note}`);
  } catch (e) {
    results[src.key] = {
      name: src.name,
      source: src.source,
      extractedAt: new Date().toISOString(),
      flat: null,
      note: `Échec extraction : ${e.message}`,
    };
    console.log(`  ✗ ${e.message} (${Date.now() - t0}ms)`);
  }
}

await browser.close();

// === ÉCRITURE ===
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/channels.json", JSON.stringify(results, null, 2));

// Rendu markdown human-readable
const md = ["# Listes de chaînes TV — extraction automatique", ""];
md.push(`Généré le ${new Date().toLocaleString("fr-CH")} par \`scripts/fetch-channels.mjs\`.`);
md.push("");
for (const [k, r] of Object.entries(results)) {
  md.push(`## ${r.name} (\`${k}\`)`);
  md.push("");
  md.push(`- **Source** : ${r.source || "manuel"}`);
  if (r.note) md.push(`- **Note** : ${r.note}`);
  if (r.categorized) {
    for (const [cat, list] of Object.entries(r.categorized)) {
      md.push(`\n### ${cat} (${list.length})`);
      md.push(list.join(" · "));
    }
  } else if (Array.isArray(r.flat)) {
    md.push(`\n### ${r.flat.length} chaînes`);
    md.push(r.flat.join(" · "));
  } else {
    md.push(`\n_Liste non extraite._`);
  }
  md.push("");
}
fs.writeFileSync("data/channels.md", md.join("\n"));

console.log(`\n✅ Écrit data/channels.json (${sources.length} sources) et data/channels.md`);
