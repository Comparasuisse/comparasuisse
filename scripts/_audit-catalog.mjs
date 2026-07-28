import { chromium } from 'playwright-core';
import fs from 'node:fs';

const OUT = './data/audit-catalog-';

const VAGUES = {
  v1: {
    wingo: [
      'https://www.wingo.ch/fr/mobile',
      'https://www.wingo.ch/fr/internet-offer',
      'https://www.wingo.ch/fr/internet/wingo-tv',
      'https://www.wingo.ch/fr/mobile/wingo-prepaid'
    ],
    lebara: [
      'https://www.lebara.ch/fr/mobile-products',
      'https://www.lebara.ch/fr/data',
      'https://www.lebara.ch/fr/prepaid'
    ],
    green: [
      'https://www.green.ch/fr/clients-prives/abonnement-internet',
      'https://www.green.ch/fr/clients-prives'
    ],
    yallo: [
      'https://www.yallo.ch/fr/mobile-products',
      'https://www.yallo.ch/fr/internet-products',
      'https://www.yallo.ch/fr/tv',
      'https://www.yallo.ch/fr/prepaid'
    ],
    netplus: [
      'https://www.netplus.ch/fr/',
      'https://www.netplus.ch/fr/offres-mobiles-irresistibles/',
      'https://www.netplus.ch/fr/television/',
      'https://www.netplus.ch/fr/offres-combinees/'
    ]
  },
  v2: {
    sunrise: [
      'https://www.sunrise.ch/fr/mobile',
      'https://www.sunrise.ch/fr/mobile/abonnements',
      'https://www.sunrise.ch/fr/internet',
      'https://www.sunrise.ch/fr/tv',
      'https://www.sunrise.ch/fr/mobile/young'
    ],
    swisscom: [
      'https://www.swisscom.ch/fr/clients-prives/abonnement-mobile.html',
      'https://www.swisscom.ch/fr/clients-prives/abonnement-internet.html',
      'https://www.swisscom.ch/fr/clients-prives/abonnement-tv.html',
      'https://www.swisscom.ch/fr/clients-prives/offres-combinees.html'
    ],
    salt: [
      'https://www.salt.ch/fr/mobile',
      'https://www.salt.ch/fr/mobile/plans',
      'https://www.salt.ch/fr/home',
      'https://www.salt.ch/fr/home/internet-fibre'
    ],
    coop_mobile: [
      'https://www.coopmobile.ch/fr/abonnement-mobile',
      'https://www.coopmobile.ch/fr/prepaid',
      'https://www.coopmobile.ch/fr/'
    ],
    migros_mobile: [
      'https://online-shop.mobile.migros.ch/fr/wireless',
      'https://www.mobile.migros.ch/fr/',
      'https://www.mobile.migros.ch/fr/abonnements'
    ]
  },
  v3: {
    sky: [
      'https://mobile.sky.ch/fr/',
      'https://fiber.sky.ch/fr/',
      'https://www.sky.ch/fr/'
    ],
    teleboy: [
      'https://www.teleboy.ch/fr/tv',
      'https://www.teleboy.ch/kombi-abo',
      'https://www.teleboy.ch/fr/internet'
    ],
    zattoo: [
      'https://zattoo.com/ch/fr',
      'https://zattoo.com/ch/fr/offers',
      'https://zattoo.com/ch/fr/offers/home'
    ],
    kingtv: [
      'https://www.teleking.ch/tv/',
      'https://www.teleking.ch/tv/angebote/'
    ],
    canalplus: [
      'https://subscribe.canalplus.com/ch',
      'https://subscribe.canalplus.com/ch/produits'
    ],
    init7: [
      'https://www.init7.net/fr/tv/tv7/',
      'https://www.init7.net/fr/internet/fiber7/',
      'https://www.init7.net/fr/'
    ]
  }
};

const key = process.argv[2] || 'v1';
const targets = VAGUES[key];
if (!targets) { console.log('Unknown vague:', key); process.exit(1); }

const b = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const ctx = await b.newContext({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120', locale:'fr-CH'});

for (const [op, urls] of Object.entries(targets)) {
  const results = {};
  console.log(`\n===== ${op.toUpperCase()} =====`);
  for (const u of urls) {
    const p = await ctx.newPage();
    try {
      const r = await p.goto(u, {waitUntil:'domcontentloaded', timeout:30000});
      await p.waitForTimeout(4000);
      const t = await p.evaluate(() => (document.body.innerText || '').replace(/\n{2,}/g,'\n'));
      results[u] = { status: r?.status(), text: t };
      const short = t.split('\n').filter(l => l.trim().length > 2).slice(0, 120).join('\n');
      console.log(`\n### ${u} (${r?.status()})\n${short}`);
    } catch (e) {
      results[u] = { error: e.message };
      console.log(`\n### ${u} ERR ${e.message}`);
    }
    await p.close();
  }
  fs.writeFileSync(OUT + op + '.json', JSON.stringify(results, null, 2));
}
await b.close();
console.log('\nDONE');
