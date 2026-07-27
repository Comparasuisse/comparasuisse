// Helper obligatoire pour tout script qui écrit dans index.html.
//
// Historique : le commit 7e84e1c a poussé un index.html avec une erreur de syntaxe
// JS globale (fragment orphelin dans channelsList Talk Talk + iWay), ce qui a
// totalement bloqué le site en prod (aucun onglet, aucune offre). La vérif
// syntaxique manquait dans le workflow — désormais, tout writeFileSync sur
// index.html DOIT être suivi d'un appel à ce helper.
//
// Usage :
//
//   import { withVerifiedIndexWrite } from "./lib/verify-index-syntax.mjs";
//   withVerifiedIndexWrite(() => {
//     const patched = ...; // logique de patch
//     fs.writeFileSync("index.html", patched);
//   });
//
// Ou pour un contrôle plus fin :
//
//   import { verifyIndexHtmlSyntax } from "./lib/verify-index-syntax.mjs";
//   fs.writeFileSync("index.html", patched);
//   verifyIndexHtmlSyntax({ backupPath: ".index.html.bak" }); // exit(1) si cassé
//
// En cas d'erreur, le fichier index.html est automatiquement restauré depuis le backup
// (s'il existe) et le script exit(1) — pas de commit possible sur un fichier cassé.

import fs from "node:fs";
import { execSync } from "node:child_process";

/**
 * Extrait le plus gros script inline d'index.html, le passe à `node --check`.
 * En cas d'erreur de syntaxe : restaure depuis backupPath si fourni, puis exit(1).
 *
 * @param {object} opts
 * @param {string} [opts.backupPath] — chemin d'une copie d'index.html à restaurer si le check échoue.
 * @param {string} [opts.htmlPath="index.html"] — path du fichier à vérifier.
 */
export function verifyIndexHtmlSyntax({ backupPath, htmlPath = "index.html" } = {}) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)];
  if (!scripts.length) {
    console.error(`❌ Aucun <script> inline trouvé dans ${htmlPath} — vérification impossible.`);
    process.exit(1);
  }
  const largest = scripts.map((m) => m[1]).reduce((a, b) => (a.length > b.length ? a : b));
  const tmpPath = ".verify-index-syntax-tmp.js";
  fs.writeFileSync(tmpPath, largest);
  try {
    execSync(`node --check "${tmpPath}"`, { stdio: "pipe" });
    fs.unlinkSync(tmpPath);
    console.log(`✅ Syntaxe JS d'${htmlPath} validée (${largest.length} chars).`);
    return true;
  } catch (e) {
    const stderr = e.stderr?.toString() || e.stdout?.toString() || String(e);
    try { fs.unlinkSync(tmpPath); } catch {}
    console.error(`\n❌ SYNTAXE JS INVALIDE dans ${htmlPath} :\n`);
    console.error(stderr.split("\n").slice(0, 8).join("\n"));
    if (backupPath && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, htmlPath);
      console.error(`\n↩️  Rollback effectué depuis ${backupPath}. Le fichier ${htmlPath} est restauré à sa version d'avant modification.`);
    } else {
      console.error(`\n⚠️  Aucun backup fourni — le fichier ${htmlPath} reste cassé sur disque. À réparer manuellement AVANT tout commit.`);
    }
    process.exit(1);
  }
}

/**
 * Wrapper haut-niveau : sauvegarde index.html, exécute writeFn (qui fait le
 * writeFileSync), puis vérifie la syntaxe. Rollback + exit(1) si cassé.
 *
 * @param {() => void} writeFn — fonction qui écrit dans index.html.
 * @param {string} [htmlPath="index.html"]
 */
export function withVerifiedIndexWrite(writeFn, htmlPath = "index.html") {
  const backupPath = `.${htmlPath.replace(/[\/\\]/g, "_")}.verify-bak`;
  fs.copyFileSync(htmlPath, backupPath);
  try {
    writeFn();
    verifyIndexHtmlSyntax({ backupPath, htmlPath });
  } finally {
    try { fs.unlinkSync(backupPath); } catch {}
  }
}
