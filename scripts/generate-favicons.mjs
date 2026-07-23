// Génère favicon-512.png et favicon.ico à partir de favicon.svg
// via un rendu Chrome headless (playwright-core, déjà installé).
//
// Usage : node scripts/generate-favicons.mjs
// Idempotent : à re-lancer si favicon.svg change.

import { chromium } from "playwright-core";
import fs from "node:fs";

const CHROME_PATH =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const svgPath = "favicon.svg";
const svgContent = fs.readFileSync(svgPath, "utf8");
const svgDataUrl =
  "data:image/svg+xml;base64," + Buffer.from(svgContent).toString("base64");

// Rasterise le SVG à une taille donnée via un rendu Chrome.
async function rasterize(browser, size) {
  const ctx = await browser.newContext({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.setContent(
    `<!DOCTYPE html><html><head><style>
      html, body { margin: 0; padding: 0; width: 100vw; height: 100vh; background: transparent; }
      img { width: 100vw; height: 100vh; display: block; }
    </style></head><body><img src="${svgDataUrl}" width="${size}" height="${size}"></body></html>`
  );
  await page.waitForLoadState("networkidle");
  const buf = await page.screenshot({
    omitBackground: true,
    type: "png",
    clip: { x: 0, y: 0, width: size, height: size },
  });
  await ctx.close();
  return buf;
}

// Emballe un PNG dans un conteneur ICO monoicône (format PNG-in-ICO,
// supporté par Vista+, tous les navigateurs modernes, et Googlebot).
function pngToIco(pngBuffer, sizePx) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(1, 4); // count = 1

  const entry = Buffer.alloc(16);
  entry.writeUInt8(sizePx === 256 ? 0 : sizePx, 0); // width (0 = 256)
  entry.writeUInt8(sizePx === 256 ? 0 : sizePx, 1); // height
  entry.writeUInt8(0, 2); // colorCount
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bitCount
  entry.writeUInt32LE(pngBuffer.length, 8); // image data size
  entry.writeUInt32LE(22, 12); // offset (6 + 16)

  return Buffer.concat([header, entry, pngBuffer]);
}

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
});

const png512 = await rasterize(browser, 512);
fs.writeFileSync("favicon-512.png", png512);
console.log("favicon-512.png : " + png512.length + " octets");

const png32 = await rasterize(browser, 32);
const ico = pngToIco(png32, 32);
fs.writeFileSync("favicon.ico", ico);
console.log(
  "favicon.ico : " + ico.length + " octets (PNG 32×32 embarqué)"
);

await browser.close();
