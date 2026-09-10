/**
 * Test de bout en bout dans un vrai navigateur (Chromium via Playwright).
 *
 * Vérifie le parcours complet de l'interface — accueil, catalogue, recherche,
 * fiche produit, inscription, panier, tunnel de commande en 4 étapes, paiement,
 * suivi, espace vendeur et administration — ainsi que l'absence d'erreur
 * console et de débordement horizontal aux largeurs cibles.
 *
 * Playwright n'est PAS une dépendance du projet (l'API et ses tests n'en ont
 * pas besoin). Pour lancer ce test :
 *
 *   npm i -D playwright && npx playwright install chromium
 *   npm run seed
 *   npm run dev                       # dans un autre terminal
 *   TOUMA_URL=http://127.0.0.1:3000/touma/ npm run test:browser
 *
 * Les captures sont écrites dans SCR (défaut : ./.captures).
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = (process.env.TOUMA_URL ?? 'http://127.0.0.1:3000/touma/').replace(/\/$/, '');
const OUT = process.env.SCR ?? '.captures';
const errors = [];

const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
await mkdir(OUT, { recursive: true });

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.log(`✗ ${name} → ${e.message}`);
    errors.push(`${name}: ${e.message}`);
  }
};

const email = `nav-${Date.now()}@touma.test`;
const PASSWORD = 'motdepasse-nav-123';

await step('accueil', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hero h1');
  const sections = await page.locator('.section, .cta-band').count();
  if (sections < 5) throw new Error(`page d'accueil incomplète (${sections} sections)`);
  await page.screenshot({ path: `${OUT}/01-accueil.png` });
});

await step('catalogue et filtres', async () => {
  await page.click('.header-nav a[href="/touma/produits"]');
  await page.waitForSelector('.product-card');
  await page.waitForTimeout(300);
  if ((await page.locator('.product-card').count()) < 3) throw new Error('catalogue vide');
  await page.selectOption('#f-country', 'CM');
  await page.click('#filters button[type="submit"]');
  await page.waitForTimeout(700);
  if (!page.url().includes('country=CM')) throw new Error("le filtre n'est pas dans l'URL");
  await page.screenshot({ path: `${OUT}/02-catalogue.png` });
});

await step('recherche', async () => {
  await page.fill('#search-input', 'cacao');
  await page.press('#search-input', 'Enter');
  await page.waitForTimeout(700);
  if ((await page.locator('.product-card').count()) < 1) throw new Error('aucun résultat pour « cacao »');
});

await step('fiche produit (URL réelle + visuel)', async () => {
  await page.click('.product-card a');
  await page.waitForSelector('[data-add-to-cart]');
  if (!/\/touma\/produits\/[a-z0-9-]+$/.test(page.url())) throw new Error(`URL produit inattendue : ${page.url()}`);
  const imgs = await page.locator('.gallery-main img').count();
  if (imgs !== 1) throw new Error('visuel produit absent');
  await page.screenshot({ path: `${OUT}/03-produit.png` });
});

await step('estimation de livraison (sans compte)', async () => {
  await page.selectOption('#ship-country', 'TD');
  await page.click('[data-estimate]');
  await page.waitForTimeout(1200);
  const text = await page.textContent('#ship-estimate');
  if (!text || !text.includes('XAF')) throw new Error('aucune estimation renvoyée');
});

await step('inscription', async () => {
  await page.goto(`${BASE}/inscription`, { waitUntil: 'networkidle' });
  await page.fill('#r-name', 'Acheteuse Navigateur');
  await page.fill('#r-email', email);
  await page.fill('#r-password', PASSWORD);
  await page.click('#register-form button[type="submit"]');
  await page.waitForTimeout(1500);
  const nav = await page.textContent('#header-nav');
  if (!nav.includes('Mes commandes')) throw new Error('session inactive après inscription');
});

await step('ajout au panier', async () => {
  await page.goto(`${BASE}/produits`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.product-card [data-add-to-cart]');
  await page.click('.product-card [data-add-to-cart]');
  await page.waitForTimeout(1200);
  const badge = await page.locator('#cart-badge, #cart-badge-mobile').first();
  if ((await badge.textContent()) === '0') throw new Error('le compteur du panier ne bouge pas');
  await page.goto(`${BASE}/panier`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.cart-line');
  await page.screenshot({ path: `${OUT}/04-panier.png` });
});

await step('tunnel de commande : adresse', async () => {
  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#address-form');
  await page.fill('#a-name', 'Acheteuse Navigateur');
  await page.fill('#a-phone', '+235900012');
  await page.fill('#a-line1', 'Avenue Charles de Gaulle');
  await page.fill('#a-city', "N'Djamena");
  await page.click('#address-form button[type="submit"]');
  await page.waitForTimeout(1500);
  await page.waitForSelector('[data-checkout-next="1"]:not([disabled])');
  await page.screenshot({ path: `${OUT}/05-checkout-adresse.png` });
});

await step('tunnel de commande : livraison', async () => {
  await page.click('[data-checkout-next="1"]');
  await page.waitForSelector('input[name^="quote-"]', { timeout: 20000 });
  const options = await page.locator('input[name^="quote-"]').count();
  if (options < 2) throw new Error('aucun choix de transporteur');
  await page.screenshot({ path: `${OUT}/06-checkout-livraison.png` });
});

await step('tunnel de commande : paiement et confirmation', async () => {
  await page.click('[data-checkout-next="2"]');
  await page.waitForSelector('[data-place-order]');
  await page.screenshot({ path: `${OUT}/07-checkout-paiement.png` });
  await page.click('[data-place-order]');
  await page.waitForSelector('.timeline, [href^="/touma/commandes/"]', { timeout: 25000 });
  const body = await page.textContent('#view');
  if (!body.includes('enregistrée')) throw new Error('page de confirmation absente');
  await page.screenshot({ path: `${OUT}/08-confirmation.png` });
});

await step('suivi de commande (chronologie)', async () => {
  await page.goto(`${BASE}/commandes`, { waitUntil: 'networkidle' });
  await page.waitForSelector('a[href^="/touma/commandes/"]');
  await page.click('a[href^="/touma/commandes/"]');
  await page.waitForSelector('.timeline');
  const done = await page.locator('.timeline li[data-done="true"]').count();
  if (done < 1) throw new Error('la chronologie ne reflète pas le paiement');
  await page.screenshot({ path: `${OUT}/09-commande.png` });
});

await step('espace vendeur', async () => {
  await page.goto(`${BASE}/deconnexion`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/connexion`, { waitUntil: 'networkidle' });
  await page.fill('#l-email', 'vendeur.cm@touma.dev');
  await page.fill('#l-password', 'touma-dev-1234');
  await page.click('#login-form button[type="submit"]');
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/vendeur`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.grid-stats');
  await page.screenshot({ path: `${OUT}/10-vendeur.png` });
});

await step('vendeur : analyses (graphique)', async () => {
  await page.goto(`${BASE}/vendeur/analyses`, { waitUntil: 'networkidle' });
  await page.waitForSelector('svg.chart', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/11-vendeur-analyses.png` });
});

await step('vendeur : formulaire produit', async () => {
  await page.goto(`${BASE}/vendeur/produits/nouveau`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#product-form');
  await page.fill('#p-title', `Produit navigateur ${Date.now()}`);
  await page.click('#ai-description');
  await page.waitForTimeout(1200);
  const description = await page.inputValue('#p-description');
  if (!description) throw new Error('Touma AI n’a rien proposé');
});

await step('administration (barre latérale)', async () => {
  await page.goto(`${BASE}/deconnexion`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/connexion`, { waitUntil: 'networkidle' });
  await page.fill('#l-email', 'admin@touma.dev');
  await page.fill('#l-password', 'touma-dev-1234');
  await page.click('#login-form button[type="submit"]');
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.admin-sidebar a[aria-current="page"]');
  await page.screenshot({ path: `${OUT}/12-admin.png` });
  await page.goto(`${BASE}/admin/verifications`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/13-admin-verifications.png` });
});

// ── Largeurs cibles : aucun débordement horizontal, menu mobile fonctionnel ──
for (const [width, height] of [
  [360, 780],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1024, 768],
  [1280, 900],
  [1440, 900],
]) {
  await step(`largeur ${width}px`, async () => {
    const view = await browser.newPage({ viewport: { width, height } });
    for (const path of ['/', '/produits', '/panier']) {
      await view.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      await view.waitForTimeout(500);
      const overflow = await view.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) throw new Error(`débordement horizontal sur ${path}`);
    }
    if (width < 900) {
      await view.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      const bottomNav = await view.locator('.bottom-nav a').count();
      if (bottomNav !== 5) throw new Error('navigation basse absente');
      await view.click('#menu-btn');
      await view.waitForTimeout(400);
      if ((await view.getAttribute('#drawer', 'data-open')) !== 'true') throw new Error('le menu ne s’ouvre pas');
      await view.screenshot({ path: `${OUT}/mobile-${width}.png` });
    }
    await view.close();
  });
}

await browser.close();
console.log('\n--- erreurs console/page ---');
console.log(errors.length ? errors.join('\n') : 'aucune');
process.exit(errors.length ? 1 : 0);
