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

/**
 * L'API limite le débit par adresse IP (300 requêtes/minute). Ce scénario en
 * émet davantage : un 429 n'est pas un défaut du produit mais la protection qui
 * fonctionne. On le repère, on laisse la fenêtre se refermer, et on continue.
 */
let rateLimited = false;

function watch(target, tag = '') {
  target.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('429')) return (rateLimited = true);
    errors.push(`console${tag}: ${m.text()}`);
  });
  target.on('pageerror', (e) => errors.push(`pageerror${tag}: ${e.message}`));
  target.on('response', (r) => {
    if (r.status() === 429) rateLimited = true;
  });
  return target;
}

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 900 } }));

/**
 * Sessions par rôle. Se déconnecter et se reconnecter à chaque étape
 * déclencherait la limitation anti-force-brute — qui doit rester active.
 * Chaque rôle ouvre donc son propre contexte et se connecte une seule fois.
 */
const sessions = new Map();

async function sessionFor(email, password = 'touma-dev-1234') {
  if (sessions.has(email)) return sessions.get(email);
  const context = watch(await browser.newPage({ viewport: { width: 1280, height: 900 } }), ` (${email})`);
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
    if (rateLimited) {
      // Fenêtre de la limitation de débit : une minute.
      rateLimited = false;
      await page.waitForTimeout(62_000);
    }
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.log(`✗ ${name} → ${e.message}`);
    errors.push(`${name}: ${e.message}`);
  }
};

const email = `nav-${Date.now()}@touma.test`;
let rfqUrl = '';
let orderId = '';
let returnId = '';
let ticketUrl = '';
let couponCode = '';
let documentUrl = '';
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
  // Cette commande sera suivie jusqu'au retour et au remboursement.
  orderId = page.url().split('/').pop();
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

await step('vendeur : expédier puis livrer la commande', async () => {
  if (!orderId) throw new Error('aucune commande issue du parcours acheteur');
  // La commande peut appartenir à l'une ou l'autre boutique du jeu de données.
  let seller = null;
  for (const email of ['vendeur.cm@touma.dev', 'vendeur.td@touma.dev']) {
    const candidate = await sessionFor(email);
    await candidate.goto(`${BASE}/vendeur/commandes/${orderId}`, { waitUntil: 'networkidle' });
    await candidate.waitForTimeout(900);
    if (await candidate.locator('[data-create-shipment], [data-update-shipment]').count()) {
      seller = candidate;
      break;
    }
  }
  if (!seller) throw new Error('aucun vendeur ne voit cette commande');

  if (await seller.locator('[data-create-shipment]').count()) {
    await seller.click('[data-create-shipment]');
    await seller.waitForSelector('[data-update-shipment]', { timeout: 20000 });
  }
  // Le suivi transporteur pilote le statut de la commande : SHIPPED puis DELIVERED.
  for (const status of ['SHIPPED', 'DELIVERED']) {
    await seller.selectOption('#ship-status', status);
    await seller.click('[data-update-shipment]');
    await seller.waitForTimeout(1800);
  }
  const body = await seller.textContent('#view');
  if (!body.includes('Livré')) throw new Error('la commande n’est pas passée à « livrée »');
});

await step('acheteur : demander un retour', async () => {
  await page.goto(`${BASE}/commandes/${orderId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('a[href^="/touma/retours/nouveau"]', { timeout: 15000 });
  await page.click('a[href^="/touma/retours/nouveau"]');
  await page.waitForSelector('#return-form', { timeout: 15000 });
  await page.selectOption('#rr-reason', 'DAMAGED');
  await page.check('.rr-pick');
  await page.fill('#rr-comment', 'Un sac est arrivé déchiré.');
  await page.click('#return-form button[type="submit"]');
  await page.waitForURL((u) => /\/touma\/retours\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith('/nouveau'), { timeout: 20000 });
  await page.waitForSelector('.timeline');
  returnId = page.url().split('/').pop();
  await page.screenshot({ path: `${OUT}/18-retour.png` });
});

await step('vendeur : accepter le retour et rembourser', async () => {
  if (!returnId) throw new Error('aucune demande de retour à traiter');
  let seller = null;
  for (const email of ['vendeur.cm@touma.dev', 'vendeur.td@touma.dev']) {
    const candidate = await sessionFor(email);
    await candidate.goto(`${BASE}/retours/${returnId}`, { waitUntil: 'networkidle' });
    await candidate.waitForTimeout(900);
    if (await candidate.locator('#return-approve-form').count()) {
      seller = candidate;
      break;
    }
  }
  if (!seller) throw new Error('le vendeur ne voit pas la demande de retour');

  await seller.click('#return-approve-form button[type="submit"]');
  await seller.waitForSelector('#return-refund-form', { timeout: 20000 });
  await seller.screenshot({ path: `${OUT}/19-retour-vendeur.png` });

  await seller.click('#return-refund-form button[type="submit"]');
  // Un remboursement est un mouvement d'argent : il passe par une confirmation.
  await seller.waitForSelector('.modal [data-action="confirm"]', { timeout: 10000 });
  await seller.click('.modal [data-action="confirm"]');
  await seller.waitForTimeout(2500);
  const body = await seller.textContent('#view');
  if (!body.includes('Remboursé')) throw new Error('le retour n’est pas passé à « remboursé »');
});

await step('assistance : ouvrir un ticket et recevoir une réponse', async () => {
  await page.goto(`${BASE}/aide/nouveau`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#ticket-form');
  await page.fill('#t-subject', 'Question sur les délais douaniers');
  await page.selectOption('#t-category', 'DELIVERY');
  await page.fill('#t-message', 'Combien de temps prend le passage de la frontière Tchad–Cameroun ?');
  await page.click('#ticket-form button[type="submit"]');
  // « /aide/nouveau » correspondrait au motif : on attend une vraie fiche ticket.
  await page.waitForURL((u) => /\/touma\/aide\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith('/nouveau'), { timeout: 20000 });
  ticketUrl = page.url();
  await page.screenshot({ path: `${OUT}/20-assistance.png` });

  const admin = await sessionFor('admin@touma.dev');
  await admin.goto(`${BASE}/admin/assistance`, { waitUntil: 'networkidle' });
  await admin.waitForSelector('a[href^="/touma/aide/"]', { timeout: 15000 });
  await admin.goto(ticketUrl, { waitUntil: 'networkidle' });
  await admin.waitForSelector('#ticket-reply-form', { timeout: 15000 });
  await admin.fill('#tr-body', 'Comptez 3 à 5 jours ouvrés au poste de Kousséri.');
  await admin.click('#ticket-reply-form button[type="submit"]');
  await admin.waitForTimeout(2000);

  await page.goto(ticketUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const body = await page.textContent('#view');
  if (!body.includes('Kousséri')) throw new Error('la réponse de l’assistance n’apparaît pas côté acheteur');
});

await step('vendeur : créer un code de réduction', async () => {
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(`${BASE}/vendeur/promotions`, { waitUntil: 'networkidle' });
  await seller.waitForSelector('details summary', { timeout: 15000 });
  // Le formulaire est replié dès qu'un code existe déjà : on le déplie.
  if (!(await seller.locator('#coupon-create-form').isVisible())) {
    await seller.click('details summary');
    await seller.waitForTimeout(400);
  }
  await seller.waitForSelector('#coupon-create-form', { timeout: 15000 });
  couponCode = `NAV${Date.now().toString().slice(-8)}`;
  await seller.fill('#co-code', couponCode);
  await seller.selectOption('#co-type', 'PERCENTAGE');
  await seller.fill('#co-value', '10');
  await seller.fill('#co-description', 'Test navigateur');
  await seller.click('#coupon-create-form button[type="submit"]');
  await seller.waitForTimeout(2200);
  const body = await seller.textContent('#view');
  if (!body.includes(couponCode)) throw new Error('le code créé n’apparaît pas dans la liste');
  await seller.screenshot({ path: `${OUT}/22-promotions.png` });
});

await step('acheteur : appliquer le code au paiement', async () => {
  if (!couponCode) throw new Error('aucun code à appliquer');
  await page.goto(`${BASE}/produits`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.product-card');
  await page.click('.product-card [data-add-to-cart]');
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-checkout-next="1"]');
  await page.click('[data-checkout-next="1"]');
  await page.waitForSelector('[data-checkout-next="2"]', { timeout: 25000 });
  await page.click('[data-checkout-next="2"]');
  await page.waitForSelector('#coupon-form', { timeout: 20000 });

  const before = await page.textContent('.buybox');
  await page.fill('#c-code', couponCode.toLowerCase()); // la saisie est insensible à la casse
  await page.click('#coupon-form button[type="submit"]');
  await page.waitForTimeout(2200);
  const after = await page.textContent('.buybox');
  if (after === before) throw new Error('le récapitulatif n’a pas pris la remise en compte');
  if (!after.includes(couponCode)) throw new Error('le code appliqué n’apparaît pas dans le récapitulatif');
  await page.screenshot({ path: `${OUT}/23-code-applique.png` });

  await page.click('[data-place-order]');
  await page.waitForSelector('.timeline, [href^="/touma/commandes/"]', { timeout: 30000 });
  const confirmation = await page.textContent('#view');
  if (!confirmation.includes('enregistrée')) throw new Error('commande non confirmée après remise');
});

await step('acheteur : la remise figure sur la commande', async () => {
  await page.goto(`${BASE}/commandes`, { waitUntil: 'networkidle' });
  await page.waitForSelector('a[href^="/touma/commandes/"]');
  await page.click('a[href^="/touma/commandes/"]');
  await page.waitForSelector('.summary', { timeout: 20000 });
  const body = await page.textContent('#view');
  if (!body.includes('Remise')) throw new Error('la remise n’apparaît pas sur la commande');
});

await step('acheteur : mes points de fidélité', async () => {
  await page.goto(`${BASE}/compte`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card', { timeout: 15000 });
  const body = await page.textContent('#view');
  if (!body.includes('Fidélité TOUMA')) throw new Error('le panneau de fidélité est absent');
  await page.screenshot({ path: `${OUT}/24-fidelite.png` });
});

await step('acheteur : facture et reçu de la commande', async () => {
  await page.goto(`${BASE}/commandes`, { waitUntil: 'networkidle' });
  await page.waitForSelector('a[href^="/touma/commandes/"]');
  await page.click('a[href^="/touma/commandes/"]');
  await page.waitForSelector('a[href^="/touma/documents/"]', { timeout: 20000 });
  const body = await page.textContent('#view');
  if (!body.includes('Facture')) throw new Error('la facture n’est pas rattachée à la commande');
  if (!body.includes('Reçu de paiement')) throw new Error('le reçu de paiement est absent');

  await page.click('a[href^="/touma/documents/"]');
  await page.waitForSelector('.document', { timeout: 20000 });
  const doc = await page.textContent('.document');
  // Le document porte ses deux parties et sa mention fiscale.
  if (!doc.includes('Émetteur') || !doc.includes('Destinataire')) throw new Error('les parties ne figurent pas sur le document');
  if (!doc.includes('TVA')) throw new Error('la mention fiscale est absente');
  documentUrl = page.url();
  await page.screenshot({ path: `${OUT}/25-facture.png` });
});

await step('document : rendu à l’impression', async () => {
  if (!documentUrl) throw new Error('aucun document à imprimer');
  // Le document est privé : on reste dans la session déjà connectée.
  await page.goto(documentUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('.document');
  // En impression, l'ossature du site disparaît : il ne reste que le document.
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(400);
  if (await page.locator('.header').isVisible()) throw new Error('l’en-tête du site survit à l’impression');
  if (!(await page.locator('.document').isVisible())) throw new Error('le document disparaît à l’impression');
  await page.screenshot({ path: `${OUT}/26-facture-impression.png` });
  await page.emulateMedia({ media: 'screen' });
});

await step('vendeur : ses documents émis', async () => {
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(`${BASE}/vendeur/documents`, { waitUntil: 'networkidle' });
  await seller.waitForSelector('.tabs', { timeout: 15000 });
  await seller.waitForSelector('tbody tr', { timeout: 15000 });
  // Le reçu est émis par TOUMA : il n'a rien à faire dans les documents du
  // vendeur. On regarde les lignes du tableau, pas les filtres de la page.
  const rows = await seller.locator('tbody tr').allTextContents();
  if (rows.some((r) => r.includes('Reçu de paiement'))) throw new Error('le vendeur voit un document qu’il n’émet pas');
  if (!rows.some((r) => r.includes('Facture'))) throw new Error('aucune facture émise par le vendeur');
  await seller.screenshot({ path: `${OUT}/27-documents-vendeur.png` });
});

await step('vitrine : réputation calculée de la boutique', async () => {
  const view = watch(await browser.newPage({ viewport: { width: 1280, height: 900 } }), ' (vitrine)');
  await view.goto(`${BASE}/boutiques`, { waitUntil: 'networkidle' });
  await view.waitForSelector('.card a[href^="/touma/boutiques/"]');
  await view.click('.card a[href^="/touma/boutiques/"]');
  await view.waitForSelector('.store-head', { timeout: 20000 });
  const body = await view.textContent('#view');
  if (!body.includes('Réputation')) throw new Error('le bloc de réputation est absent de la vitrine');
  // Publié ou non, la boutique doit dire où elle en est — jamais rester muette.
  if (!body.includes('/100') && !body.includes('assez de commandes')) {
    throw new Error('la réputation n’annonce ni score ni volume insuffisant');
  }
  await view.screenshot({ path: `${OUT}/28-reputation.png` });
  await view.close();
});

await step('vendeur : le détail de son score', async () => {
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(`${BASE}/vendeur`, { waitUntil: 'networkidle' });
  await seller.waitForSelector('.grid-stats', { timeout: 20000 });
  const body = await seller.textContent('#view');
  if (!body.includes('Réputation')) throw new Error('le panneau de réputation est absent du tableau de bord');
  await seller.screenshot({ path: `${OUT}/29-reputation-vendeur.png` });
});

await step('après-vente : pages privées sur mobile', async () => {
  if (!returnId || !ticketUrl) throw new Error('le parcours après-vente n’a pas abouti : rien à vérifier');
  // Ces pages exigent une session : on redimensionne le contexte déjà connecté.
  for (const [width, height] of [
    [360, 780],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    for (const path of ['/retours', `/retours/${returnId}`, '/aide', ticketUrl.replace(BASE, '')]) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) throw new Error(`débordement horizontal sur ${path} à ${width}px`);
    }
    await page.screenshot({ path: `${OUT}/21-apres-vente-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
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
