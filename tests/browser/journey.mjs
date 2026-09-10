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

/**
 * Sessions par rôle. Se déconnecter et se reconnecter à chaque étape
 * déclencherait la limitation anti-force-brute — qui doit rester active.
 * Chaque rôle ouvre donc son propre contexte et se connecte une seule fois.
 */
const sessions = new Map();

async function sessionFor(email, password = 'touma-dev-1234') {
  if (sessions.has(email)) return sessions.get(email);
  const context = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  context.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console (${email}): ${m.text()}`);
  });
  context.on('pageerror', (e) => errors.push(`pageerror (${email}): ${e.message}`));
  await context.goto(`${BASE}/connexion`, { waitUntil: 'networkidle' });
  await context.fill('#l-email', email);
  await context.fill('#l-password', password);
  await context.click('#login-form button[type="submit"]');
  await context.waitForTimeout(1600);
  sessions.set(email, context);
  return context;
}

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
let rfqUrl = '';
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

await step('choix du mode de remise (point relais)', async () => {
  const modes = await page.locator('input[name="delivery"]').count();
  if (modes !== 2) throw new Error('les modes de remise ne sont pas proposés');
  await page.check('input[name="delivery"][value="PICKUP_POINT"]');
  await page.waitForTimeout(300);
  const hidden = await page.getAttribute('#pickup-choice', 'hidden');
  if (hidden !== null) throw new Error('le choix du point relais ne s’affiche pas');
  // On revient à la livraison à domicile pour la suite du parcours.
  await page.check('input[name="delivery"][value="HOME"]');
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
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(`${BASE}/vendeur`, { waitUntil: 'networkidle' });
  await seller.waitForSelector('.grid-stats');
  await seller.screenshot({ path: `${OUT}/10-vendeur.png` });
});

await step('vendeur : analyses (graphique)', async () => {
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(`${BASE}/vendeur/analyses`, { waitUntil: 'networkidle' });
  await seller.waitForSelector('svg.chart', { timeout: 15000 });
  await seller.screenshot({ path: `${OUT}/11-vendeur-analyses.png` });
});

await step('vendeur : formulaire produit', async () => {
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(`${BASE}/vendeur/produits/nouveau`, { waitUntil: 'networkidle' });
  await seller.waitForSelector('#product-form');
  await seller.fill('#p-title', `Produit navigateur ${Date.now()}`);
  await seller.click('#ai-description');
  await seller.waitForTimeout(1200);
  const description = await seller.inputValue('#p-description');
  if (!description) throw new Error('Touma AI n’a rien proposé');
});

await step('administration (barre latérale)', async () => {
  const admin = await sessionFor('admin@touma.dev');
  await admin.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await admin.waitForSelector('.admin-sidebar a[aria-current="page"]');
  await admin.screenshot({ path: `${OUT}/12-admin.png` });
  await admin.goto(`${BASE}/admin/verifications`, { waitUntil: 'networkidle' });
  await admin.waitForTimeout(900);
  await admin.screenshot({ path: `${OUT}/13-admin-verifications.png` });
});

await step('TOUMA Business : publier un appel d’offres', async () => {
  const pro = await sessionFor('acheteur@touma.dev');
  await pro.goto(`${BASE}/business/appels-offres/nouveau`, { waitUntil: 'networkidle' });
  await pro.waitForSelector('#rfq-form');
  await pro.fill('#q-title', `Recherche navigateur ${Date.now()}`);
  await pro.fill('#q-description', 'Test du parcours B2B.');
  await pro.selectOption('#q-country', 'TD');
  await pro.fill('.i-name', 'Cacao en fèves');
  await pro.fill('.i-qty', '500');
  await pro.fill('.i-unit', 'kg');
  await pro.click('#rfq-form button[type="submit"]');
  await pro.waitForURL(/\/touma\/business\/appels-offres\/[a-z0-9]+$/, { timeout: 20000 });
  await pro.waitForSelector('.spec-list', { timeout: 20000 });
  rfqUrl = pro.url();
  await pro.screenshot({ path: `${OUT}/14-rfq.png` });
});

await step('TOUMA Business : un fournisseur répond', async () => {
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(rfqUrl, { waitUntil: 'networkidle' });
  await seller.waitForSelector('#quote-form', { timeout: 20000 });
  await seller.fill('.ql-price', '2750');
  await seller.fill('#qf-shipping', '85000');
  await seller.fill('#qf-message', 'Échantillon offert.');
  await seller.click('#quote-form button[type="submit"]');
  await seller.waitForTimeout(2200);
  const body = await seller.textContent('#view');
  if (!body.includes('Mon offre')) throw new Error('l’offre n’apparaît pas au fournisseur');
  await seller.screenshot({ path: `${OUT}/15-offre.png` });
});

await step('TOUMA Business : négociation et acceptation', async () => {
  const pro = await sessionFor('acheteur@touma.dev');
  await pro.goto(rfqUrl, { waitUntil: 'networkidle' });
  await pro.waitForSelector('.negotiate-form', { timeout: 20000 });
  await pro.fill('.neg-body', 'Pouvez-vous faire un geste sur le transport ?');
  await pro.fill('.neg-total', '1400000');
  await pro.click('.negotiate-form button[type="submit"]');
  await pro.waitForTimeout(2200);

  await pro.waitForSelector('[data-accept-quote]', { timeout: 20000 });
  await pro.click('[data-accept-quote]');
  await pro.waitForSelector('[data-action="confirm"]', { timeout: 10000 });
  await pro.click('[data-action="confirm"]');
  // On attend la navigation elle-même : le récapitulatif de l'offre contient
  // déjà un total, un simple sélecteur matcherait trop tôt.
  await pro.waitForURL(/\/touma\/commandes\/groupe\//, { timeout: 25000 });
  await pro.waitForSelector('.summary-total', { timeout: 15000 });
  await pro.screenshot({ path: `${OUT}/16-commande-b2b.png` });
});

await step('messagerie acheteur ↔ vendeur', async () => {
  const pro = await sessionFor('acheteur@touma.dev');
  await pro.goto(`${BASE}/produits`, { waitUntil: 'networkidle' });
  await pro.waitForSelector('.product-card a');
  await pro.click('.product-card a');
  await pro.waitForSelector('[data-contact-store]');
  await pro.click('[data-contact-store]');
  await pro.waitForSelector('#message-form', { timeout: 20000 });
  await pro.fill('#m-body', 'Bonjour, quel est le délai pour 200 kg ?');
  await pro.click('#message-form button[type="submit"]');
  await pro.waitForTimeout(2000);
  const body = await pro.textContent('#view');
  if (!body.includes('200 kg')) throw new Error('le message n’apparaît pas dans le fil');
  await pro.screenshot({ path: `${OUT}/17-messagerie.png` });
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
