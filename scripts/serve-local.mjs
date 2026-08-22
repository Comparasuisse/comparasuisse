// Serveur statique minimal, pour mesurer le site en local (lighthouse, etc.).
//
// Reproduit les deux comportements de Netlify qui comptent pour la mesure :
//   - un dossier de route sert son index.html (/tv/ → tv/index.html) ;
//   - tout chemin inconnu retombe sur index.html, comme la règle `/*` de
//     _redirects.
// Il ne compresse pas : les mesures locales servent à comparer un avant et un
// après sur la même machine, pas à imiter la production.
//
//   node scripts/serve-local.mjs [port]

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = parseInt(process.argv[2] || "8899", 10);
const RACINE = process.cwd();
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const serveur = http.createServer((req, res) => {
  const chemin = decodeURIComponent(req.url.split("?")[0]);
  let fichier = path.join(RACINE, chemin);
  if (fs.existsSync(fichier) && fs.statSync(fichier).isDirectory()) fichier = path.join(fichier, "index.html");
  if (!fs.existsSync(fichier) || fs.statSync(fichier).isDirectory()) fichier = path.join(RACINE, "index.html");
  // Garde-fou : ne jamais sortir de la racine servie.
  if (!path.resolve(fichier).startsWith(path.resolve(RACINE))) {
    res.writeHead(403).end("interdit");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(fichier)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(fichier).pipe(res);
});

serveur.listen(PORT, () => console.log(`site servi sur http://localhost:${PORT}`));
