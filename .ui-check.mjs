import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3010/touma/';
const OUT = process.env.SCR;
const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const step = async (label, fn) => {
  try { await fn(); console.log(`✓ ${label}`); }
  catch (e) { console.log(`✗ ${label} → ${e.message}`); errors.push(`${label}: ${e.message}`); }
};

await step('accueil', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hero h1');
  await page.screenshot({ path: `${OUT}/01-accueil.png`, fullPage: false });
});

await step('catalogue', async () => {
  await page.click('a[href="#/produits"]');
  await page.waitForSelector('.grid.products .product-card');
  await page.waitForTimeout(400);
  const count = await page.locator('.grid.products .product-card').count();
  if (count < 3) throw new Error(`seulement ${count} produits affichés`);
  await page.screenshot({ path: `${OUT}/02-catalogue.png` });
});

await step('recherche', async () => {
  await page.fill('#search-input', 'cacao');
  await page.press('#search-input', 'Enter');
  await page.waitForTimeout(600);
  const count = await page.locator('.product-card').count();
  if (count < 1) throw new Error('aucun résultat pour « cacao »');
});

await step('fiche produit', async () => {
  await page.click('.product-card a');
  await page.waitForSelector('#add-to-cart');
  await page.screenshot({ path: `${OUT}/03-produit.png` });
});

await step('inscription acheteur', async () => {
  await page.goto(`${BASE}#/inscription`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#register-form');
  await page.fill('#r-name', 'Test Acheteur');
  await page.fill('#r-email', `ui-${Date.now()}@touma.test`);
  await page.fill('#r-password', 'motdepasse-ui-123');
  await page.click('#register-form button[type="submit"]');
  await page.waitForTimeout(1200);
  const nav = await page.textContent('#header-nav');
  if (!nav.includes('Mes commandes')) throw new Error('la session n’est pas active après inscription');
});

await step('ajout au panier', async () => {
  await page.goto(`${BASE}#/produits`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.product-card a');
  await page.click('.product-card a');
  await page.waitForSelector('#add-to-cart');
  await page.click('#add-to-cart');
  await page.waitForTimeout(900);
  await page.goto(`${BASE}#/panier`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.cart-line');
  await page.screenshot({ path: `${OUT}/04-panier.png` });
});

await step('checkout et commande', async () => {
  await page.goto(`${BASE}#/checkout`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#address-form');
  await page.fill('#a-name', 'Test Acheteur');
  await page.fill('#a-phone', '+235900001');
  await page.fill('#a-line1', 'Avenue centrale');
  await page.fill('#a-city', "N'Djamena");
  await page.click('#address-form button[type="submit"]');
  await page.waitForTimeout(1200);
  await page.waitForSelector('#place-order:not([disabled])');
  await page.screenshot({ path: `${OUT}/05-checkout.png` });
  await page.click('#place-order');
  await page.waitForSelector('#pay-order', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/06-commande.png` });
});

await step('paiement', async () => {
  await page.click('#pay-order');
  await page.waitForTimeout(2500);
  const body = await page.textContent('#view');
  if (!body.includes('PAID')) throw new Error('la commande n’est pas passée à PAID');
  await page.screenshot({ path: `${OUT}/07-payee.png` });
});

await step('espace vendeur (connexion vendeur de démonstration)', async () => {
  await page.goto(`${BASE}#/deconnexion`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.goto(`${BASE}#/connexion`, { waitUntil: 'networkidle' });
  await page.fill('#l-email', 'vendeur.cm@touma.dev');
  await page.fill('#l-password', 'touma-dev-1234');
  await page.click('#login-form button[type="submit"]');
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}#/vendeur`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.grid.stats');
  await page.screenshot({ path: `${OUT}/08-vendeur.png` });
});

await step('administration', async () => {
  await page.goto(`${BASE}#/deconnexion`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.goto(`${BASE}#/connexion`, { waitUntil: 'networkidle' });
  await page.fill('#l-email', 'admin@touma.dev');
  await page.fill('#l-password', 'touma-dev-1234');
  await page.click('#login-form button[type="submit"]');
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}#/admin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.grid.stats');
  await page.screenshot({ path: `${OUT}/09-admin.png`, fullPage: false });
  await page.goto(`${BASE}#/admin/verifications`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/10-verifications.png` });
});

await step('mobile (390px)', async () => {
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('.hero h1');
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('débordement horizontal en 390px');
  await mobile.screenshot({ path: `${OUT}/11-mobile.png`, fullPage: false });
  await mobile.close();
});

await browser.close();
console.log('\n--- erreurs console/page ---');
console.log(errors.length ? errors.join('\n') : 'aucune');
process.exit(errors.length ? 1 : 0);
