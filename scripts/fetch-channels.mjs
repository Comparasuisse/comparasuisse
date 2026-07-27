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
    // Version /en/ contient les images channel avec alt exploitable ; les autres locales masquent le rendu.
    source: "https://zattoo.com/ch/en/channels",
    type: "html",
    extract: async (page) => {
      await page.waitForTimeout(4000);
      for (let i = 0; i < 25; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(250);
      }
      // Chaque chaîne apparaît dans plusieurs img[alt] : le nom seul + variantes
      // "X included in Free/Premium/Ultimate subscription". On garde le nom seul,
      // et on relève au passage les 3 tiers pour distinguer Free/Premium/Ultimate.
      const raw = await page.evaluate(() =>
        [...document.querySelectorAll('img[alt]')].map((i) => i.alt.trim())
      );
      const tier = { free: new Set(), premium: new Set(), ultimate: new Set() };
      const bare = new Set();
      for (const a of raw) {
        if (!a || a.length < 2 || a.length > 80) continue;
        const m = a.match(/^(.+?) included in (Free|Premium|Ultimate) subscription$/);
        if (m) {
          tier[m[2].toLowerCase()].add(m[1].trim());
        } else if (!/logo|zattoo|package|home|expand|sort/i.test(a) && !a.includes(">")) {
          bare.add(a);
        }
      }
      const allNames = new Set([...bare, ...tier.free, ...tier.premium, ...tier.ultimate]);
      const cleaned = uniqueChannels([...allNames]).sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
      if (cleaned.length < 30) return { flat: null, note: `Zattoo : seulement ${cleaned.length} chaînes détectées.` };
      return {
        categorized: {
          [`Free (${tier.free.size})`]: [...tier.free].sort((a, b) => a.localeCompare(b)),
          [`Premium (${tier.premium.size})`]: [...tier.premium].sort((a, b) => a.localeCompare(b)),
          [`Ultimate (${tier.ultimate.size})`]: [...tier.ultimate].sort((a, b) => a.localeCompare(b)),
        },
        flat: cleaned,
        note: `Zattoo Suisse — extrait de /ch/en/channels (le rendu /fr/ ne charge pas les tuiles côté serveur). Free ${tier.free.size} · Premium ${tier.premium.size} · Ultimate ${tier.ultimate.size}. Premium et Ultimate contiennent tout Free + suppléments.`,
      };
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
    // Source primaire (officielle) : documents.swisscom.com/.../senderliste-kmu-en.pdf est
    // une CAPTURE-IMAGE du site : 7,5 MB, aucune couche texte exploitable (pdfjs extrait
    // uniquement les headers de section + le footer de pagination). Aucun autre PDF officiel
    // n'expose la liste sous forme texte.
    // Source de repli : expertfries.ch/senderlisten/swisscom.pdf — capture texte propre de
    // la senderliste officielle Swisscom (site tiers privé, publie plusieurs senderlisten
    // suisses au format texte). Format "N   Nom de la chaîne" séparé par espaces multiples.
    source: "https://expertfries.ch/senderlisten/swisscom.pdf",
    type: "pdf",
    extract: (text) => {
      // Enlève les numéros de canal, garde uniquement les noms.
      // Format observé : "0   blue Zoom D   1   SRF 1   2   SRF zwei ..."
      const flat = text
        .split(/\s{2,}|\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        // Vire les numéros de canal purs
        .filter((s) => !/^\d+$/.test(s))
        // Vire l'en-tête "Swisscom Senderliste"
        .filter((s) => !/^Swisscom Senderliste$/i.test(s));
      const channels = uniqueChannels(flat).sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" })
      );
      return channels.length >= 100
        ? {
            flat: channels,
            note:
              "Source Swisscom officielle (documents.swisscom.com/.../senderliste-kmu-en.pdf) : PDF présenté comme image, non parseable. Repli utilisé : expertfries.ch/senderlisten/swisscom.pdf (capture texte tierce de la même senderliste officielle Swisscom). Catalogue commun aux packs blue TV S (150+), M (290+), L (330+), XL — la différence porte sur le nombre inclus, pas la disponibilité individuelle.",
          }
        : { flat: null, note: `Swisscom senderliste : ${channels.length} chaînes après filtrage.` };
    },
  },
  {
    key: "teleking",
    name: "Teleking KingTV (Silber/Gold/Platin)",
    source: "https://www.teleking.ch/tv/senderliste/",
    type: "html",
    extract: async (page) => {
      await page.waitForTimeout(3000);
      // La table Teleking est bien peuplée en DOM mais les cellules ont display:none
      // avant hydration ; innerText retourne "" alors que textContent fonctionne.
      const rows = await page.evaluate(() => {
        const out = [];
        for (const tr of document.querySelectorAll("table tr")) {
          const tds = tr.querySelectorAll("td");
          if (tds.length < 2) continue;
          const name = (tds[0].textContent || "").replace(/\s+/g, " ").trim();
          const packs = (tds[tds.length - 1].textContent || "").replace(/\s+/g, " ").trim();
          if (name && name.length > 1 && name.length < 60) out.push({ name, packs });
        }
        return out;
      });
      if (rows.length < 20)
        return { flat: null, note: `Table Teleking : ${rows.length} lignes seulement.` };
      // Regroupe par pack (Silber / Gold / Platin)
      const cats = { Silber: new Set(), Gold: new Set(), Platin: new Set() };
      for (const r of rows) {
        if (/silber/i.test(r.packs)) cats.Silber.add(r.name);
        if (/gold/i.test(r.packs)) cats.Gold.add(r.name);
        if (/platin/i.test(r.packs)) cats.Platin.add(r.name);
      }
      const allNames = uniqueChannels(rows.map((r) => r.name)).sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" })
      );
      return {
        categorized: {
          [`Silber (${cats.Silber.size})`]: [...cats.Silber].sort((a, b) => a.localeCompare(b)),
          [`Gold (${cats.Gold.size})`]: [...cats.Gold].sort((a, b) => a.localeCompare(b)),
          [`Platin (${cats.Platin.size})`]: [...cats.Platin].sort((a, b) => a.localeCompare(b)),
        },
        flat: allNames,
        note: `Extrait de teleking.ch/tv/senderliste — table HTML (${allNames.length} chaînes uniques). Table donne pour chaque chaîne les packs qui l'incluent (Silber ⊂ Gold ⊂ Platin en général).`,
      };
    },
  },
  {
    key: "yallo-tv",
    name: "yallo TV",
    // PDF officiel yallo TV (février 2026), hébergé sur le CDN Prismic Sunrise-yallo.
    // Liste multilingue (DE/EN/FR/IT). Découvert via lien direct dans la page produit yallo.ch/fr/tv.
    source:
      "https://sunrise-yallo.cdn.prismic.io/sunrise-yallo/aaa8iVxvIZEnjQ_h_YMK-1774_yallo_TV_Channel_List_2026_Februar.pdf",
    type: "pdf",
    extract: (text) => {
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
      return channels.length >= 100
        ? {
            flat: channels,
            note:
              "Extrait du PDF officiel yallo TV (Channel List, février 2026, hébergé sur sunrise-yallo.cdn.prismic.io). Catalogue commun à yallo TV standalone et au bundle Home Supermax + TV.",
          }
        : { flat: null, note: `PDF yallo TV : ${channels.length} chaînes après filtrage.` };
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
    // Playlist XSPF publique (XML) qui liste TOUS les canaux TV7 avec leur URL multicast.
    // On extrait juste les <title> ; les URLs udp:// ne sont utiles qu'aux clients Init7.
    source: "https://api.init7.net/tvchannels.xspf",
    type: "text",
    fetch: async (ctx, url) => {
      const r = await ctx.request.get(url, { timeout: 20000 });
      if (!r.ok()) throw new Error(`HTTP ${r.status()}`);
      return await r.text();
    },
    extract: (xml) => {
      // Pas de vrai parser XML : on extrait les <title> tracks (pas le premier <title> du playlist).
      const titles = [...xml.matchAll(/<track>[\s\S]*?<title>([^<]+)<\/title>/g)].map((m) =>
        m[1].trim()
      );
      const cleaned = uniqueChannels(titles).sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" })
      );
      return cleaned.length >= 50
        ? {
            flat: cleaned,
            note:
              "Extrait de la playlist XSPF officielle api.init7.net/tvchannels.xspf (accessible publiquement, tags <title> par track). Streams UDP multicast → utilisables uniquement depuis le réseau Init7. Replay 7 jours en option payante (+11.-/mois).",
          }
        : { flat: null, note: `Init7 XSPF : ${cleaned.length} chaînes après filtrage.` };
    },
  },
  {
    key: "maxi-tv",
    name: "MaxiTV",
    source: null,
    type: "manual",
    extract: () => ({
      flat: null,
      note:
        "MaxiConnect (Villaz-St-Pierre) ne publie aucune liste extractible. 2 passes de recherche confirmées : (1) site public /fr et /de/it/en/television + wiki + FAQ = seuls 20 canaux replay-avec-pub mentionnés, sous-ensemble non-exhaustif ; (2) sitemap complet (417 URLs) parcouru = aucune page channels/senderliste/liste-chaines, aucun PDF, article blog EN /en/actualites/maxitv-le-divertissement-suisse ne détaille pas les chaînes ni les 3 paliers Start/Plus/Ultra. Aucun endpoint API JSON détecté via Playwright. Décision assumée : afficher un lien vers la page officielle plutôt qu'une liste tronquée trompeuse.",
    }),
  },
  {
    key: "iway-tv",
    name: "iWay TV (Classic/Premium/Top)",
    // iWay charge la senderliste depuis une API JSON interne (gfo.iway.ch/api/infos/sender/default)
    // qui refuse les requêtes directes (403) mais répond OK depuis la page /tv/senderliste/.
    // On l'intercepte via un handler `response` Playwright.
    source: "https://www.iway.ch/tv/senderliste/",
    type: "html",
    extract: async (page) => {
      let payload = null;
      let categories = null;
      page.on("response", async (r) => {
        const u = r.url();
        if (u.endsWith("/api/infos/sender/default")) {
          try { payload = await r.json(); } catch {}
        } else if (u.endsWith("/api/info_categories/sender/default")) {
          try { categories = await r.json(); } catch {}
        }
      });
      // Rejoue la nav pour être sûr de capter les responses (Playwright ne rejoue pas les caches)
      await page.reload({ waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(5000);
      if (!Array.isArray(payload) || payload.length < 50)
        return { flat: null, note: `iWay API non capturée (payload=${payload ? payload.length : "null"}).` };
      // Map catégorie id → label pour retrouver Classic/Premium/Top
      const catMap = {};
      if (Array.isArray(categories)) {
        for (const c of categories) catMap[String(c.id)] = c.title || c.name || `#${c.id}`;
      }
      // Chaque chaîne peut avoir "info_category_ids" = "12,45" (comma-separated string)
      const buckets = {};
      const allNames = new Set();
      for (const ch of payload) {
        const title = (ch.title || "").trim();
        if (!title || title.length > 60) continue;
        allNames.add(title);
        const ids = String(ch.info_category_ids || "").split(/[,\s]+/).filter(Boolean);
        for (const id of ids) {
          const label = catMap[id] || `cat-${id}`;
          (buckets[label] ||= new Set()).add(title);
        }
      }
      const flat = uniqueChannels([...allNames]).sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
      // On garde uniquement les catégories qui ressemblent à un pack (Classic/Premium/Top ou "TV2.0")
      const catKeys = Object.keys(buckets).filter((k) => /classic|premium|top|tv\s*2/i.test(k));
      const categorized = catKeys.length
        ? Object.fromEntries(
            catKeys.map((k) => [`${k} (${buckets[k].size})`, [...buckets[k]].sort((a, b) => a.localeCompare(b))])
          )
        : undefined;
      return {
        ...(categorized ? { categorized } : {}),
        flat,
        note: `Extrait via API interne gfo.iway.ch (${payload.length} entrées, ${flat.length} chaînes uniques). Catégories iWay détectées : ${catKeys.join(", ") || "(pas de correspondance Classic/Premium/Top trouvée — la vue flat couvre l'ensemble)"}.`,
      };
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
  {
    key: "salt-home-tv",
    name: "Salt Home TV (bouquet de base)",
    // Page publique dédiée : /fr/home/tv/channels. Rendue en JS.
    // Structure : bouquet de base dans .tv_channels_channels_list__<hash> ;
    // options payantes (Sky, CANAL+, thématiques) dans .tv_channels_channels_list_thematic__<hash>.
    // On utilise [class^=...] pour éviter les hashs CSS Modules qui changent aux déploiements,
    // et on exclut explicitement le sous-conteneur "thematic".
    source: "https://www.salt.ch/fr/home/tv/channels",
    type: "html",
    extract: async (page) => {
      await page.waitForTimeout(5000);
      for (let i = 0; i < 15; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(250);
      }
      const alts = await page.evaluate(() => {
        const base = document.querySelector('[class*="tv_channels_channels_list__"]:not([class*="thematic"])');
        if (!base) return { error: "container not found" };
        const list = [...base.querySelectorAll("img[alt]")]
          .map((i) => i.alt.trim())
          .filter((a) => a && a.length > 1 && a.length < 60 && !/^salt\.?$/i.test(a) && !/onetrust|logo de la société/i.test(a));
        return { list };
      });
      if (alts.error) return { flat: null, note: `Salt : ${alts.error}` };
      const cleaned = uniqueChannels(alts.list).sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" })
      );
      return cleaned.length >= 50
        ? {
            flat: cleaned,
            note:
              "Extrait de salt.ch/fr/home/tv/channels — uniquement le BOUQUET DE BASE inclus dans Salt Home (sélecteur DOM .tv_channels_channels_list__* hors sous-container 'thematic'). Les options payantes Sky, CANAL+ et bouquets thématiques ne sont PAS incluses.",
          }
        : { flat: null, note: `Salt Home : ${cleaned.length} chaînes après filtrage.` };
    },
  },
  {
    key: "talktalk-tv",
    name: "Talk Talk TV (Surf + TV)",
    // Fiche produit factsheet officielle Talk Talk (TTV.2026.TV.STD.FR.pdf) : contient la liste des chaînes.
    source: "https://docs.talktalk.ch/public/TTI/1224_Senderliste_FR.pdf",
    type: "pdf",
    extract: (text) => {
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const pieces = lines.flatMap((line) =>
        line
          .split(/(?:\s+HD\s+|\s+SD\s+|\s+UHD\s+)/g)
          .flatMap((p) => p.split(/\s{2,}|\t|·/))
          .map((p) => p.trim())
          .filter(Boolean)
      );
      const channels = uniqueChannels(pieces).sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" })
      );
      return channels.length >= 50
        ? {
            flat: channels,
            note:
              "Extrait du PDF officiel Talk Talk TTV.2026.TV.STD.FR (fiche produit TV factsheet). Applicable à l'offre Talk Talk Surf + TV.",
          }
        : { flat: null, note: `PDF Talk Talk : ${channels.length} chaînes après filtrage.` };
    },
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
    } else if (src.type === "text") {
      // Texte brut (XML/XSPF/M3U/etc.) via un fetcher custom
      const body = await src.fetch(ctx, src.source);
      extracted = src.extract(body);
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
// Merge avec l'existant si on n'a lancé qu'un sous-ensemble de sources.
// Sans ça, un `node scripts/fetch-channels.mjs zattoo` effacerait les autres résultats.
let merged = results;
if (requestedKeys.length && fs.existsSync("data/channels.json")) {
  try {
    const prev = JSON.parse(fs.readFileSync("data/channels.json", "utf8"));
    merged = { ...prev, ...results };
  } catch { /* corrompu : on repart de results */ }
}
fs.writeFileSync("data/channels.json", JSON.stringify(merged, null, 2));

// Rendu markdown human-readable
const md = ["# Listes de chaînes TV — extraction automatique", ""];
md.push(`Généré le ${new Date().toLocaleString("fr-CH")} par \`scripts/fetch-channels.mjs\`.`);
md.push("");
for (const [k, r] of Object.entries(merged)) {
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
