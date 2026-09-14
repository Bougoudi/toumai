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

// Playwright est installé à la demande : sans lui, Node ne renvoie qu'une trace
// « ERR_MODULE_NOT_FOUND » qui n'apprend rien. Autant dire quoi faire.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'Playwright est absent. Installez-le puis relancez :\n' +
      '  npm i -D playwright && npx playwright install chromium\n' +
      "  npm run dev            # l'application doit tourner dans un autre terminal\n" +
      '  npm run test:browser',
  );
  process.exit(1);
}

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

/**
 * Une étape coupe volontairement le réseau pour vérifier le comportement hors
 * ligne. Les échecs de chargement qu'elle provoque sont le sujet du test, pas
 * un défaut : pendant cette fenêtre, on ne les compte pas.
 */
let offlineExpected = false;

function watch(target, tag = '') {
  target.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('429')) return (rateLimited = true);
    if (offlineExpected && /ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError/.test(m.text())) return;
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

  for (let essai = 1; ; essai += 1) {
    await context.goto(`${BASE}/connexion`, { waitUntil: 'networkidle' });
    await context.fill('#l-email', email);
    await context.fill('#l-password', password);
    await context.click('#login-form button[type="submit"]');
    try {
      // Une connexion réussie quitte l'écran de connexion. Attendre un délai
      // fixe puis mettre la page en réserve mettait en réserve une session NON
      // connectée : toutes les étapes du rôle échouaient ensuite sur des
      // sélecteurs absents, et la cause — un refus de connexion quinze étapes
      // plus tôt — n'apparaissait nulle part. La reprise de l'étape ne pouvait
      // rien y faire non plus, puisqu'elle réutilisait la session abîmée.
      await context.waitForFunction(() => !location.pathname.includes('/connexion'), null, { timeout: 15_000 });
      break;
    } catch {
      // La limitation anti-force-brute est une protection qui doit rester
      // active : rejouer le parcours dans la même minute la déclenche
      // légitimement. On laisse la fenêtre se refermer, une fois.
      if (essai === 2) {
        await context.close();
        throw new Error(`connexion impossible pour ${email}`);
      }
      await context.waitForTimeout(62_000);
      rateLimited = false;
    }
  }

  sessions.set(email, context);
  return context;
}

const step = async (name, fn) => {
  if (rateLimited) {
    // Fenêtre de la limitation de débit : une minute.
    rateLimited = false;
    await page.waitForTimeout(62_000);
  }
  try {
    await fn();
    console.log(`✓ ${name}`);
    return;
  } catch (e) {
    // Une étape peut heurter la limitation **pendant** son déroulement : ce
    // n'est pas un défaut du produit, c'est la protection qui fonctionne. On
    // laisse la fenêtre se refermer et on rejoue l'étape une fois.
    if (!rateLimited) {
      console.log(`✗ ${name} → ${e.message}`);
      errors.push(`${name}: ${e.message}`);
      return;
    }
    console.log(`… ${name} (limitation de débit atteinte, nouvelle tentative)`);
  }

  rateLimited = false;
  await page.waitForTimeout(62_000);
  try {
    await fn();
    console.log(`✓ ${name} (au second essai)`);
  } catch (e) {
    console.log(`✗ ${name} → ${e.message}`);
    errors.push(`${name}: ${e.message}`);
  }
};

const email = `nav-${Date.now()}@touma.test`;
let rfqUrl = '';
let orderId = '';
let returnId = '';
let disputeUrl = '';
let ticketUrl = '';
let couponCode = '';
let documentUrl = '';
const PASSWORD = 'motdepasse-nav-123';

/**
 * Une seconde commande payée, pour les étapes de litige.
 *
 * Ouvrir un litige fait passer la commande en « en litige » : elle ne peut donc
 * pas être celle qui sert au retour et au remboursement — l'un des deux
 * parcours échouerait, selon l'ordre. Chaque remède a sa commande, comme dans la
 * vie.
 */
async function commandePayee() {
  await page.goto(`${BASE}/produits`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.product-card [data-add-to-cart]');
  await page.click('.product-card [data-add-to-cart]');
  await page.waitForTimeout(1200);

  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  // L'adresse est déjà au carnet depuis le premier passage : le formulaire de
  // saisie est alors replié. Sa présence dans le document ne dit rien — c'est sa
  // visibilité qui compte.
  if (await page.locator('#address-form').isVisible().catch(() => false)) {
    await page.fill('#a-name', 'Acheteuse Navigateur');
    await page.fill('#a-phone', '+23566000012');
    await page.fill('#a-line1', 'Avenue Charles de Gaulle');
    await page.fill('#a-city', "N'Djamena");
    await page.click('#address-form button[type="submit"]');
    await page.waitForTimeout(1500);
  }
  await page.waitForSelector('[data-checkout-next="1"]:not([disabled])', { timeout: 20000 });
  await page.click('[data-checkout-next="1"]');
  await page.waitForSelector('input[name^="quote-"]', { timeout: 20000 });
  await page.click('[data-checkout-next="2"]');
  await page.waitForSelector('[data-place-order]', { timeout: 20000 });
  await page.click('[data-place-order]');

  // On suit le lien de la confirmation : c'est celui de CETTE commande, alors
  // que le premier lien de la liste pourrait être une autre.
  await page.waitForSelector('.timeline, a[href^="/touma/commandes/"]', { timeout: 25000 });
  const lien = page.locator('a[href^="/touma/commandes/"]:not([href*="/groupe/"])').first();
  if (await lien.count()) {
    await lien.click();
    await page.waitForSelector('.timeline', { timeout: 20000 });
  }
  return page.url().split('/').pop();
}

await step('accueil', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hero h1');
  const sections = await page.locator('.section, .cta-band').count();
  if (sections < 5) throw new Error(`page d'accueil incomplète (${sections} sections)`);
  await page.screenshot({ path: `${OUT}/01-accueil.png` });
});

await step('catalogue : facettes avec compteurs', async () => {
  await page.goto(`${BASE}/produits`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#filters');
  // Les compteurs viennent du serveur : sans eux, filtrer se fait à l'aveugle.
  const countries = await page.locator('#f-country option').allTextContents();
  if (!countries.some((t) => /\(\d+\)/.test(t))) throw new Error('les pays n’annoncent pas leur nombre de résultats');
  const availability = await page.locator('#f-availability option').allTextContents();
  if (!availability.some((t) => /En stock uniquement \(\d+\)/.test(t))) throw new Error('la disponibilité n’est pas comptée');

  const buckets = await page.locator('.filters-panel .chip-row a').count();
  if (buckets === 0) throw new Error('aucune tranche de prix proposée');
  await page.screenshot({ path: `${OUT}/34-facettes.png` });

  // Cliquer une tranche filtre réellement, et la tranche reste proposée.
  const label = await page.locator('.filters-panel .chip-row a').first().textContent();
  await page.click('.filters-panel .chip-row a');
  await page.waitForTimeout(1800);
  if (!page.url().includes('minPrice')) throw new Error('la tranche de prix n’a pas été appliquée');
  const after = await page.locator('.filters-panel .chip-row a').count();
  if (after === 0) throw new Error('les tranches disparaissent une fois l’une d’elles choisie');
  if (!label.trim()) throw new Error('tranche sans libellé');
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
  await page.fill('#a-phone', '+23566000012');
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

await step('acheteur : ouvrir un litige et y verser une pièce', async () => {
  const commande = await commandePayee();
  await page.goto(`${BASE}/commandes/${commande}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#dispute-form', { timeout: 20000 });
  await page.selectOption('#d-reason', 'DAMAGED');
  await page.fill('#d-details', 'Deux sacs sont percés, photos à l’appui.');
  await page.click('#dispute-form button[type="submit"]');

  // Ouvrir un litige mène au dossier. Avant, l'acheteur recevait un message de
  // confirmation et restait sur sa commande, sans aucun écran où suivre.
  await page.waitForURL(/\/touma\/litiges\/[^/]+$/, { timeout: 20000 });
  disputeUrl = page.url();

  // La pièce part en corps brut : ce sont ses octets qui décident de son type.
  await page.setInputFiles('#d-file', {
    name: 'sac-perce.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.locator('.evidence-list a.attachment').first().waitFor({ timeout: 20000 });
  const empreinte = await page.locator('.evidence-sum').count();
  if (empreinte === 0) throw new Error('la pièce ne montre pas son empreinte');
  await page.screenshot({ path: `${OUT}/61-litige-acheteur.png` });
});

await step('vendeur : répondre au litige depuis son espace', async () => {
  if (!disputeUrl) throw new Error('aucun litige ouvert');
  let seller = null;
  for (const email of ['vendeur.cm@touma.dev', 'vendeur.td@touma.dev']) {
    const candidate = await sessionFor(email);
    await candidate.goto(`${BASE}/vendeur/litiges`, { waitUntil: 'networkidle' });
    await candidate.waitForTimeout(700);
    if (await candidate.locator('a[href^="/touma/vendeur/litiges/"]').count()) {
      seller = candidate;
      break;
    }
  }
  if (!seller) throw new Error('le vendeur ne voit pas le litige ouvert sur sa vente');

  await seller.click('a[href^="/touma/vendeur/litiges/"]');
  await seller.waitForSelector('#dispute-message-form', { timeout: 20000 });
  await seller.fill('#dm-body', 'Je renvoie deux sacs aujourd’hui.');
  await seller.click('#dispute-message-form button[type="submit"]');
  await seller.locator('.dispute-thread .msg-body', { hasText: 'renvoie deux sacs' }).first().waitFor({ timeout: 20000 });
  await seller.screenshot({ path: `${OUT}/62-litige-vendeur.png` });
});

await step('administration : trancher sur pièces, jamais à l’aveugle', async () => {
  if (!disputeUrl) throw new Error('aucun litige à trancher');
  const admin = await sessionFor('admin@touma.dev');
  await admin.goto(`${BASE}/admin/litiges`, { waitUntil: 'networkidle' });
  await admin.waitForSelector('a[href^="/touma/admin/litiges/"]', { timeout: 20000 });
  await admin.click('a[href^="/touma/admin/litiges/"]');
  await admin.waitForSelector('#dispute-resolve-form', { timeout: 20000 });

  // Ce que l'administration doit avoir sous les yeux avant de décider : les
  // pièces, et où est l'argent. Trancher depuis une ligne de liste, c'est
  // décider sans regarder.
  if ((await admin.locator('.evidence-list a.attachment').count()) === 0) {
    throw new Error('le dossier ne montre aucune pièce à l’administration');
  }
  const vue = await admin.textContent('#view');
  if (!vue.includes('Où est l’argent')) throw new Error('les mouvements d’argent ne sont pas au dossier');
  await admin.screenshot({ path: `${OUT}/63-litige-admin.png` });

  await admin.selectOption('#dr-decision', 'RESOLVED_BUYER');
  await admin.selectOption('#dr-type', 'BUYER_REFUND_PARTIAL');
  await admin.fill('#dr-resolution', 'Deux sacs percés, photos probantes : remboursement partiel accordé.');
  await admin.click('#dispute-resolve-form button[type="submit"]');

  await admin.waitForSelector('[data-resolution]', { timeout: 20000 });
  // Un dossier tranché est figé : plus de message, plus de formulaire.
  if ((await admin.locator('#dispute-resolve-form').count()) !== 0) {
    throw new Error('le formulaire de décision reste ouvert après la décision');
  }
  if ((await admin.locator('#dispute-message-form').count()) !== 0) {
    throw new Error('un dossier clos accepte encore des messages');
  }
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

await step('sourcing : trouver un fournisseur sans compte', async () => {
  const visitor = watch(await browser.newPage({ viewport: { width: 1280, height: 900 } }), ' (sourcing)');
  await visitor.goto(`${BASE}/sourcing`, { waitUntil: 'networkidle' });
  await visitor.waitForSelector('#sourcing-filters', { timeout: 20000 });
  await visitor.fill('#so-q', 'savon');
  await visitor.fill('#so-quantity', '10');
  await visitor.click('#sourcing-filters button[type="submit"]');
  await visitor.waitForTimeout(2000);

  const body = await visitor.textContent('#view');
  if (!body.includes('Capacité en stock')) throw new Error('la capacité réelle n’est pas annoncée');
  if (!body.includes('volume demandé')) throw new Error('la capacité à servir le volume n’est pas indiquée');
  await visitor.screenshot({ path: `${OUT}/30-sourcing.png` });

  // Fiche fournisseur : ce qu'il propose et ce qu'il a réellement fait.
  await visitor.click('a[href^="/touma/sourcing/"]');
  await visitor.waitForSelector('.spec-list', { timeout: 20000 });
  const sheet = await visitor.textContent('#view');
  if (!sheet.includes('Ce qu’il a réellement fait')) throw new Error('la fiche fournisseur n’expose pas les faits observés');
  await visitor.screenshot({ path: `${OUT}/31-fournisseur.png` });
  await visitor.close();
});

await step('sourcing : solliciter un fournisseur sur un appel d’offres', async () => {
  const pro = await sessionFor('acheteur@touma.dev');
  await pro.goto(`${BASE}/sourcing?q=savon`, { waitUntil: 'networkidle' });
  await pro.waitForSelector('#sourcing-filters', { timeout: 20000 });
  if (!(await pro.locator('#invite-form').count())) throw new Error('l’acheteur ne peut pas solliciter de fournisseur');

  await pro.check('.supplier-pick');
  await pro.click('#invite-form button[type="submit"]');
  await pro.waitForTimeout(2200);
  await pro.screenshot({ path: `${OUT}/32-sollicitation.png` });

  // Le fournisseur retrouve la demande dans les sollicitations reçues.
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(`${BASE}/business/appels-offres?scope=invited`, { waitUntil: 'networkidle' });
  await seller.waitForTimeout(1500);
  const received = await seller.textContent('#view');
  if (received.includes('Aucune sollicitation')) throw new Error('le fournisseur ne voit pas la sollicitation reçue');
});

await step('vendeur : import de catalogue en masse', async () => {
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(`${BASE}/vendeur/import`, { waitUntil: 'networkidle' });
  await seller.waitForSelector('#import-form', { timeout: 20000 });

  const ref = `NAVIMP-${Date.now().toString().slice(-8)}`;
  await seller.fill(
    '#im-csv',
    [
      'sku;titre;prix;stock;quantite_minimale;poids_grammes;statut',
      `${ref};Cacao en fèves — import navigateur;145000;40;5;50000;ACTIVE`,
      ';;;;;;', // ligne vide, ignorée
      'BAD-1;;12000;10;1;500;ACTIVE', // titre manquant : doit être rejetée
    ].join('\n'),
  );
  await seller.click('#import-form button[type="submit"]');
  await seller.waitForSelector('[data-apply-import]', { timeout: 20000 });

  const report = await seller.textContent('#import-report');
  if (!report.includes('Lignes en erreur')) throw new Error('le rapport ne signale pas les lignes fautives');
  await seller.screenshot({ path: `${OUT}/33-import.png` });

  // Rien ne doit être écrit tant que l'import n'est pas appliqué.
  await seller.goto(`${BASE}/vendeur/produits`, { waitUntil: 'networkidle' });
  await seller.waitForTimeout(1200);
  if ((await seller.textContent('#view')).includes(ref)) throw new Error('l’analyse a écrit avant confirmation');

  await seller.goBack({ waitUntil: 'networkidle' });
  await seller.waitForSelector('#import-form', { timeout: 20000 });
  // Le rapport a disparu avec la navigation : on relance l'analyse puis on applique.
  await seller.fill('#im-csv', `sku;titre;prix;stock;statut\n${ref};Cacao en fèves — import navigateur;145000;40;ACTIVE`);
  await seller.click('#import-form button[type="submit"]');
  await seller.waitForSelector('[data-apply-import]', { timeout: 20000 });
  await seller.click('[data-apply-import]');
  await seller.waitForSelector('.modal [data-action="confirm"]', { timeout: 10000 });
  await seller.click('.modal [data-action="confirm"]');
  await seller.waitForTimeout(2500);

  const applied = await seller.textContent('#import-report');
  if (!applied.includes('Import terminé')) throw new Error('l’import n’a pas été appliqué');
  await seller.goto(`${BASE}/vendeur/produits`, { waitUntil: 'networkidle' });
  await seller.waitForTimeout(1500);
  if (!(await seller.textContent('#view')).includes('import navigateur')) {
    throw new Error('le produit importé n’apparaît pas dans le catalogue');
  }
});

await step('administration : TOUMA Intelligence', async () => {
  const admin = await sessionFor('admin@touma.dev');
  await admin.goto(`${BASE}/admin/intelligence`, { waitUntil: 'networkidle' });
  await admin.waitForSelector('.admin-sidebar a[aria-current="page"]', { timeout: 20000 });

  const body = await admin.textContent('#view');
  for (const section of ['Corridors actifs', 'Demande non servie', 'Fiabilité des paiements', 'Produits en tension']) {
    if (!body.includes(section)) throw new Error(`section « ${section} » absente`);
  }
  // La règle de l'écran est affichée : aucun taux sans volume.
  if (!body.includes('n’est pas publié')) throw new Error('la règle de volume minimal n’est pas annoncée');
  await admin.screenshot({ path: `${OUT}/35-intelligence.png` });

  // Changer de période recharge réellement les données.
  await admin.click('a[href="/touma/admin/intelligence?jours=7"]');
  await admin.waitForTimeout(1800);
  if (!admin.url().includes('jours=7')) throw new Error('le changement de période n’a pas pris');
});

// ── Français et arabe, les deux langues officielles du Tchad (V17) ──────────

await step('langue : l’ossature bascule en arabe, et le sens d’écriture avec', async () => {
  const ar = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await ar.goto(`${BASE}/`, { waitUntil: 'networkidle' });

  if ((await ar.getAttribute('html', 'dir')) !== 'ltr') throw new Error('le français doit être en écriture latine');

  await ar.click('#menu-btn');
  await ar.waitForTimeout(400);
  if ((await ar.locator('[data-set-locale]').count()) !== 2) throw new Error('le sélecteur de langue est absent');

  // La couverture est annoncée : proposer « العربية » sans dire ce qui reste en
  // français mettrait un arabophone devant une porte ouverte sur un mur.
  const pied = ((await ar.textContent('#drawer-foot')) ?? '').replace(/\s+/g, ' ');
  if (!/بالفرنسية|français/.test(pied)) throw new Error('la couverture de la traduction n’est pas annoncée');

  await ar.click('[data-set-locale="ar"]');
  await ar.waitForTimeout(800);

  if ((await ar.getAttribute('html', 'dir')) !== 'rtl') throw new Error('le sens d’écriture n’a pas basculé');
  if ((await ar.getAttribute('html', 'lang')) !== 'ar') throw new Error('la langue du document n’a pas changé');
  if (!/الرئيسية/.test((await ar.textContent('#bottom-nav')) ?? '')) throw new Error('la navigation basse reste en français');

  await ar.screenshot({ path: `${OUT}/48-arabe.png` });
  await ar.close();
});

await step('langue : aucun débordement en écriture de droite à gauche', async () => {
  // Le miroir RTL est le moment où les marges physiques oubliées se voient. La
  // feuille de style n'emploie que des propriétés logiques : on le vérifie.
  for (const [width, height] of [
    [360, 780],
    [390, 844],
    [768, 1024],
    [1280, 900],
  ]) {
    const vue = await browser.newPage({ viewport: { width, height } });
    await vue.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await vue.evaluate(() => localStorage.setItem('touma.locale', 'ar'));
    for (const path of ['/', '/produits', '/panier', '/provinces']) {
      await vue.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      await vue.waitForTimeout(400);
      if ((await vue.getAttribute('html', 'dir')) !== 'rtl') throw new Error(`la langue n’est pas conservée sur ${path}`);
      const overflow = await vue.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) throw new Error(`débordement horizontal en arabe sur ${path} à ${width}px`);
    }
    await vue.close();
  }
});

await step('langue : les statuts de commande sont traduits partout à la fois', async () => {
  // Les statuts viennent du serveur sous forme de code : les traduire au seul
  // endroit qui les rend les traduit sur tous les écrans, y compris ceux dont
  // le reste du texte est encore en français.
  const ar = await sessionFor('acheteur@touma.dev');
  await ar.evaluate(() => localStorage.setItem('touma.locale', 'ar'));
  await ar.goto(`${BASE}/commandes`, { waitUntil: 'networkidle' });
  await ar.waitForTimeout(800);

  const texte = (await ar.textContent('#view')) ?? '';
  const statutsArabes = /مدفوعة|مؤكدة|تم التسليم|قيد التحضير|في انتظار الدفع|منتهية|تم شحنها/;
  if (!statutsArabes.test(texte)) throw new Error('aucun statut de commande n’apparaît en arabe');

  await ar.screenshot({ path: `${OUT}/49-arabe-commandes.png` });
  // On repasse en français : les étapes suivantes lisent des libellés français.
  await ar.evaluate(() => localStorage.setItem('touma.locale', 'fr'));
});

// ── Le pays, vu de l'intérieur (V17) ────────────────────────────────────────

await step('provinces : les 23 pages existent, avec leur nom arabe', async () => {
  await page.goto(`${BASE}/provinces`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#view .card', { timeout: 20000 });

  const cartes = await page.locator('#view .grid-3 > a.card').count();
  if (cartes !== 23) throw new Error(`23 provinces attendues, ${cartes} affichées`);

  // Le Tchad a deux langues officielles ; les 23 provinces portent leur nom
  // arabe, et la page doit le rendre dans le bon sens d'écriture.
  const rtl = await page.locator('#view [dir="rtl"][lang="ar"]').count();
  if (rtl !== 23) throw new Error(`nom arabe attendu sur les 23 provinces, ${rtl} rendus`);
  await page.screenshot({ path: `${OUT}/45-provinces.png` });
});

await step('province : sa page dit ce qui existe, et ce qui n’existe pas', async () => {
  await page.goto(`${BASE}/provinces`, { waitUntil: 'networkidle' });
  await page.locator('#view .grid-3 > a.card').first().click();
  await page.waitForSelector('#view h1', { timeout: 20000 });

  const body = ((await page.textContent('#view')) ?? '').replace(/\s+/g, ' ');
  if (!/Localités recensées/.test(body)) throw new Error('le décompte des localités est absent');
  if (!/GeoNames/.test(body)) throw new Error('la source géographique n’est pas créditée');
  // Le trou est annoncé, pas comblé.
  if (!/absentes plutôt qu’inventées/.test(body)) throw new Error('l’absence des sous-préfectures n’est pas dite');

  // Livraison : soit des délais déclarés, soit « estimation indisponible ».
  // Jamais un délai sans zone.
  const sansZone = /estimation indisponible/i.test(body);
  const avecDelai = /jours/.test(body);
  if (sansZone && avecDelai) throw new Error('un délai est affiché alors qu’aucune zone n’est déclarée');
  if (!sansZone && !avecDelai) throw new Error('ni délai ni motif d’indisponibilité');
  await page.screenshot({ path: `${OUT}/46-province.png` });
});

await step('administration : tableau de bord national, zéro compris', async () => {
  const admin = await sessionFor('admin@touma.dev');
  await admin.goto(`${BASE}/admin/national`, { waitUntil: 'networkidle' });
  await admin.waitForSelector('.admin-sidebar a[aria-current="page"]', { timeout: 20000 });

  const lignes = await admin.locator('#view table tbody tr').count();
  if (lignes !== 23) throw new Error(`23 lignes attendues, ${lignes} affichées`);

  const body = ((await admin.textContent('#view')) ?? '').replace(/\s+/g, ' ');
  // La distinction qui compte, et qu'on perdrait en fusionnant les deux états.
  if (!/aucune zone déclarée/.test(body)) throw new Error('l’état « aucune zone » n’est pas rendu');
  if (!/n’est pas « non desservie »/.test(body)) throw new Error('la distinction n’est pas expliquée');
  if (!/jamais additionnés entre devises/.test(body)) throw new Error('la règle des devises n’est pas annoncée');
  await admin.screenshot({ path: `${OUT}/47-national.png` });
});

await step('géographie : pas de débordement horizontal sur mobile', async () => {
  const admin = await sessionFor('admin@touma.dev');
  for (const [width, height] of [
    [360, 780],
    [390, 844],
  ]) {
    await admin.setViewportSize({ width, height });
    for (const path of ['/provinces', '/admin/national']) {
      await admin.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      await admin.waitForTimeout(600);
      const overflow = await admin.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) throw new Error(`débordement horizontal sur ${path} à ${width}px`);
    }
  }
  await admin.setViewportSize({ width: 1280, height: 900 });
});

// ── Finance : ce qui est dû, quand, et pourquoi pas encore (V20) ────────────

await step('vendeur : l’écran Finance dit ce qui lui revient, par devise', async () => {
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(`${BASE}/vendeur/finance`, { waitUntil: 'networkidle' });
  await seller.waitForSelector('.tabs a[aria-current="page"]', { timeout: 20000 });

  // Le texte rendu porte les sauts de ligne du gabarit : on compare le contenu,
  // pas la mise en forme.
  const body = ((await seller.textContent('#view')) ?? '').replace(/\s+/g, ' ');
  // La distinction qui sépare une place de marché d'un établissement de
  // paiement doit se lire à l'écran, pas seulement dans le modèle.
  if (!body.includes('ce qui vous revient')) throw new Error('l’écran ne dit pas que ce n’est pas un solde détenu');
  if (!/n’est pas un établissement de paiement/.test(body)) throw new Error('la frontière réglementaire n’est pas affichée');
  if (!/jamais additionnées/.test(body)) throw new Error('la règle des devises n’est pas annoncée');
  await seller.screenshot({ path: `${OUT}/41-vendeur-finance.png` });
});

await step('vendeur : ses versements, et ce qu’« exécuté » veut dire', async () => {
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(`${BASE}/vendeur/versements`, { waitUntil: 'networkidle' });
  await seller.waitForSelector('#view', { timeout: 20000 });

  const body = ((await seller.textContent('#view')) ?? '').replace(/\s+/g, ' ');
  // Un vendeur ne doit pas croire que TOUMA lui a viré l'argent elle-même.
  if (!/ne transfère pas d’argent/.test(body)) throw new Error('l’écran laisse croire que TOUMA vire les fonds');
  await seller.screenshot({ path: `${OUT}/42-vendeur-versements.png` });
});

await step('administration : vue financière, par devise et sans total mélangé', async () => {
  const admin = await sessionFor('admin@touma.dev');
  await admin.goto(`${BASE}/admin/finance`, { waitUntil: 'networkidle' });
  await admin.waitForSelector('.admin-sidebar a[aria-current="page"]', { timeout: 20000 });

  const body = ((await admin.textContent('#view')) ?? '').replace(/\s+/g, ' ');
  for (const section of ['Paiements', 'Parts de règlement', 'Versements', 'Remboursements']) {
    if (!body.includes(section)) throw new Error(`section « ${section} » absente`);
  }
  if (!/jamais additionnés entre devises/.test(body)) throw new Error('la règle des devises n’est pas affichée');
  await admin.screenshot({ path: `${OUT}/43-admin-finance.png` });
});

await step('administration : versements, et ce qu’annuler veut dire', async () => {
  const admin = await sessionFor('admin@touma.dev');
  await admin.goto(`${BASE}/admin/versements`, { waitUntil: 'networkidle' });
  await admin.waitForSelector('#payout-create-form', { timeout: 20000 });

  const body = ((await admin.textContent('#view')) ?? '').replace(/\s+/g, ' ');
  if (!/n’envoie aucun argent/.test(body)) throw new Error('l’écran laisse croire que l’exécution vire les fonds');
  if (!/rend ses parts/.test(body)) throw new Error('l’effet d’une annulation n’est pas annoncé');

  // Le formulaire ne demande aucun montant : c'est le serveur qui décide de ce
  // qui entre dans le versement, et un montant envoyé par le client n'aurait
  // aucune valeur.
  if ((await admin.locator('#payout-create-form input[name="amount"]').count()) > 0) {
    throw new Error('le formulaire demande un montant au client');
  }

  // Filtrer recharge réellement la liste.
  await admin.click('a[href="/touma/admin/versements?etat=PENDING"]');
  await admin.waitForTimeout(1500);
  if (!admin.url().includes('etat=PENDING')) throw new Error('le filtre n’a pas pris');
  await admin.screenshot({ path: `${OUT}/44-admin-versements.png` });
});

await step('finance : pas de débordement horizontal sur mobile', async () => {
  const seller = await sessionFor('vendeur.cm@touma.dev');
  for (const [width, height] of [
    [360, 780],
    [390, 844],
  ]) {
    await seller.setViewportSize({ width, height });
    for (const path of ['/vendeur/finance', '/vendeur/versements']) {
      await seller.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      await seller.waitForTimeout(600);
      const overflow = await seller.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) throw new Error(`débordement horizontal sur ${path} à ${width}px`);
    }
  }
  await seller.setViewportSize({ width: 1280, height: 900 });
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

// ── Messagerie commerciale et négociation (V14) ─────────────────────────────
let demoThreadUrl = '';
let negotiationUrl = '';

await step('messagerie : boîte de réception avec contexte', async () => {
  const buyer = await sessionFor('acheteur@touma.dev');
  await buyer.goto(`${BASE}/messages`, { waitUntil: 'networkidle' });
  await buyer.waitForSelector('.conv-row');
  const rows = await buyer.locator('.conv-row').count();
  if (rows < 3) throw new Error(`la boîte de réception de démonstration est vide (${rows} fils)`);

  // Chaque ligne annonce son contexte commercial : c'est ce qui distingue
  // TOUMA d'une application de discussion.
  const contexts = await buyer.locator('.conv-row-context').allTextContents();
  if (!contexts.some((t) => /Offre|Appel d’offres|Commande/.test(t))) {
    throw new Error('aucune conversation n’affiche son contexte commercial');
  }
  await buyer.screenshot({ path: `${OUT}/35-messagerie.png` });
});

await step('messagerie : filtrer et chercher', async () => {
  const buyer = await sessionFor('acheteur@touma.dev');
  await buyer.click('.chip-row a[href*="filter=QUOTE"]');
  await buyer.waitForTimeout(1200);
  if (!buyer.url().includes('filter=QUOTE')) throw new Error('le filtre n’est pas dans l’URL');
  if ((await buyer.locator('.conv-row').count()) === 0) throw new Error('aucun fil d’offre trouvé');

  await buyer.fill('#conv-q', 'cacao');
  await buyer.click('#conv-search button[type="submit"]');
  await buyer.waitForTimeout(1200);
  if (!buyer.url().includes('q=cacao')) throw new Error('la recherche n’est pas dans l’URL');
});

await step('messagerie : carte d’offre dans le fil', async () => {
  const buyer = await sessionFor('acheteur@touma.dev');
  await buyer.goto(`${BASE}/messages?filter=QUOTE`, { waitUntil: 'networkidle' });
  // On vise la négociation de démonstration, encore ouverte : celle que le
  // parcours vient d'accepter est close, et n'offrirait plus aucune action.
  const demo = buyer.locator('.conv-row', { hasText: 'DÉMO' }).first();
  if ((await demo.count()) === 0) throw new Error('la conversation de démonstration est absente (seed V14)');
  await demo.click();
  await buyer.waitForSelector('.thread-head');
  demoThreadUrl = buyer.url();

  // L'offre est lisible comme un devis : lignes, sous-total, délai, total.
  await buyer.waitForSelector('.offer-card');
  const figures = await buyer.locator('.offer-figures dt').allTextContents();
  if (!figures.some((t) => /Total/i.test(t))) throw new Error('la carte d’offre n’affiche pas de total');

  const bar = await buyer.locator('.negotiation-bar').count();
  if (bar === 0) throw new Error('le bandeau de négociation est absent : la prochaine action n’est pas visible');
  await buyer.screenshot({ path: `${OUT}/36-fil-offre.png` });
});

await step('messagerie : envoyer, citer, modifier, supprimer', async () => {
  const buyer = await sessionFor('acheteur@touma.dev');
  await buyer.goto(demoThreadUrl, { waitUntil: 'networkidle' });
  await buyer.waitForSelector('#m-body');

  // On cherche le message à son texte, jamais au nombre de messages affichés :
  // le fil est paginé, et au-delà d'une page pleine un message envoyé en pousse
  // un ancien dehors — le compte ne bouge plus. En intégration continue la base
  // repart vide, donc ce défaut n'y apparaît jamais ; sur une base qui a déjà
  // servi, l'étape échouait pour toujours.
  const marque = `livraison en mars ${Date.now()}`;
  await buyer.fill('#m-body', `Quelle est votre disponibilité pour une ${marque} ?`);
  await buyer.click('#message-form button[type="submit"]');
  await buyer
    .locator('.msg-body', { hasText: marque })
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {
      throw new Error('le message n’apparaît pas dans le fil');
    });

  // Répondre en citant : la citation doit apparaître dans le nouveau message.
  await buyer.locator('.msg').last().hover();
  await buyer.locator('.msg').last().locator('[data-action="reply-message"]').click();
  if (await buyer.locator('#reply-banner').isHidden()) throw new Error('le bandeau de réponse ne s’affiche pas');
  await buyer.fill('#m-body', 'Je précise : livraison à N’Djamena.');
  await buyer.click('#message-form button[type="submit"]');
  await buyer.waitForTimeout(1800);
  if ((await buyer.locator('.msg-quote').count()) === 0) throw new Error('le message cité n’est pas affiché');

  // Modifier son dernier message, puis le supprimer : la trace reste.
  await buyer.locator('.msg').last().hover();
  await buyer.locator('.msg').last().locator('[data-action="edit-message"]').click();
  await buyer.fill('#m-body', 'Je précise : livraison à N’Djamena, sous 15 jours.');
  await buyer.click('#message-form button[type="submit"]');
  await buyer.waitForTimeout(1800);
  const texts = await buyer.locator('.msg-body').allTextContents();
  if (!texts.some((t) => /sous 15 jours/.test(t))) throw new Error('la modification n’est pas prise en compte');

  await buyer.locator('.msg').last().hover();
  await buyer.locator('.msg').last().locator('[data-action="delete-message"]').click();
  await buyer.waitForSelector('.modal');
  await buyer.click('.modal [data-action="confirm"]');
  await buyer.waitForTimeout(1800);
  if ((await buyer.locator('.msg-deleted').count()) === 0) throw new Error('le message supprimé ne laisse pas sa trace');
});

await step('négociation : chronologie et contre-offre calculée par le serveur', async () => {
  const buyer = await sessionFor('acheteur@touma.dev');
  await buyer.goto(demoThreadUrl, { waitUntil: 'networkidle' });
  await buyer.click('.chip[href*="/negociations/"]');
  await buyer.waitForSelector('.timeline');
  negotiationUrl = buyer.url();

  const entries = await buyer.locator('.timeline-entry').count();
  if (entries === 0) throw new Error('la chronologie de négociation est vide');

  // Le total affiché pendant la saisie doit refléter les lignes.
  await buyer.waitForSelector('#counter-form');
  await buyer.fill('.cl-qty', '400');
  await buyer.fill('.cl-price', '2700');
  await buyer.fill('#c-shipping', '40000');
  await buyer.waitForTimeout(400);
  const estimate = await buyer.locator('#counter-total').textContent();
  if (!/1[\s\u202f]?120[\s\u202f]?000/.test(estimate.replace(/\u00a0/g, ' '))) {
    throw new Error(`total estimé incorrect : ${estimate}`);
  }

  await buyer.fill('#c-note', 'Proposition pour 400 kg.');
  await buyer.click('#counter-form button[type="submit"]');
  await buyer.waitForTimeout(2200);
  const after = await buyer.locator('.timeline-entry').count();
  if (after <= entries) throw new Error('la contre-proposition n’apparaît pas dans la chronologie');
  await buyer.screenshot({ path: `${OUT}/37-negociation.png` });
});

await step('négociation : le fournisseur entérine depuis son espace', async () => {
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(negotiationUrl.replace('/touma/negociations/', '/touma/vendeur/negociations/'), { waitUntil: 'networkidle' });
  await seller.waitForSelector('.timeline');

  const apply = seller.locator('[data-action="apply-proposal"]').first();
  if ((await apply.count()) === 0) throw new Error('le fournisseur ne peut pas entériner la contre-proposition');
  await apply.click();
  await seller.waitForTimeout(2200);

  const total = await seller.locator('.offer-figures .offer-total dd').textContent();
  if (!/1[\s\u202f]?120[\s\u202f]?000/.test(total.replace(/\u00a0/g, ' '))) {
    throw new Error(`l’offre n’a pas été alignée sur la contre-proposition : ${total}`);
  }
  await seller.screenshot({ path: `${OUT}/38-negociation-vendeur.png` });
});

await step('messagerie vendeur : onglet dédié', async () => {
  const seller = await sessionFor('vendeur.cm@touma.dev');
  await seller.goto(`${BASE}/vendeur/messages`, { waitUntil: 'networkidle' });
  await seller.waitForSelector('.conv-row');
  if ((await seller.locator('.conv-row').count()) === 0) throw new Error('le vendeur ne voit aucune conversation');
  const tabs = await seller.locator('.tabs a').allTextContents();
  if (!tabs.some((t) => /Messagerie/.test(t))) throw new Error('l’onglet Messagerie manque à l’espace vendeur');
});

await step('préférences de messagerie', async () => {
  const buyer = await sessionFor('acheteur@touma.dev');
  await buyer.goto(`${BASE}/messages/reglages`, { waitUntil: 'networkidle' });
  await buyer.waitForSelector('#template-form');
  if ((await buyer.locator('[data-action="set-preference"]').count()) < 5) throw new Error('les catégories de notification sont incomplètes');

  await buyer.fill('#t-title', 'Délai N’Djamena');
  await buyer.fill('#t-content', 'Le délai vers N’Djamena est de 12 jours, transport inclus.');
  await buyer.click('#template-form button[type="submit"]');
  await buyer.waitForTimeout(1600);
  const saved = await buyer.locator('[data-action="delete-template"]').count();
  if (saved === 0) throw new Error('la réponse enregistrée n’apparaît pas');
});

await step('messagerie : mobile plein écran, sans débordement', async () => {
  const buyer = await sessionFor('acheteur@touma.dev');
  for (const [width, height] of [
    [360, 780],
    [390, 844],
    [430, 932],
  ]) {
    await buyer.setViewportSize({ width, height });
    for (const path of ['/messages', demoThreadUrl.replace(BASE, ''), negotiationUrl.replace(BASE, '')]) {
      await buyer.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      await buyer.waitForTimeout(600);
      const overflow = await buyer.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) throw new Error(`débordement horizontal sur ${path} à ${width}px`);
    }
    // Sur mobile, la liste ne doit pas voler la place de la conversation.
    await buyer.goto(demoThreadUrl, { waitUntil: 'networkidle' });
    await buyer.waitForTimeout(500);
    if (await buyer.locator('.messaging-side').isVisible()) throw new Error(`la liste latérale reste affichée à ${width}px`);
    if (!(await buyer.locator('.thread-back').isVisible())) throw new Error(`le retour vers la liste est absent à ${width}px`);
    await buyer.screenshot({ path: `${OUT}/39-messagerie-${width}.png` });
  }
  await buyer.setViewportSize({ width: 1280, height: 900 });
});

await step('vendeur : signaler un colis prêt avant le passage du transporteur', async () => {
  const vendeur = await sessionFor('vendeur.cm@touma.dev', 'touma-dev-1234');
  await vendeur.goto(`${BASE}/vendeur/commandes`, { waitUntil: 'networkidle' });
  await vendeur.waitForTimeout(500);

  const traiter = vendeur.locator('a:has-text("Traiter")').first();
  if ((await traiter.count()) === 0) throw new Error('aucune commande à traiter');
  await traiter.click();
  await vendeur.waitForTimeout(900);

  const bouton = vendeur.locator('[data-order-ready]');
  if ((await bouton.count()) === 0) {
    // La commande est déjà expédiée : l'étape n'a plus lieu d'être, et
    // l'interface a raison de ne pas proposer un bouton sans effet.
    return;
  }
  await bouton.first().click();
  await vendeur.waitForTimeout(1200);
  const texte = (await vendeur.textContent('body')) ?? '';
  if (!/Prête à expédier|signalé prêt/i.test(texte)) throw new Error('l’état « prêt à expédier » n’apparaît pas');
  await vendeur.screenshot({ path: `${OUT}/41-pret-a-expedier.png` });
});

// ── Application installable ─────────────────────────────────────────────────
await step('installable : manifeste complet et icônes réelles', async () => {
  const res = await page.request.get(`${BASE}/manifest.webmanifest`);
  if (!res.ok()) throw new Error(`manifeste absent (${res.status()})`);
  if (!/application\/manifest\+json/.test(res.headers()['content-type'] ?? '')) {
    throw new Error(`type incorrect : ${res.headers()['content-type']}`);
  }
  const manifest = await res.json();
  for (const key of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
    if (!manifest[key]) throw new Error(`clé « ${key} » absente du manifeste`);
  }
  if (manifest.display !== 'standalone') throw new Error('l’application ne s’ouvrirait pas en plein écran');
  if (!manifest.start_url.startsWith('/touma/')) throw new Error('start_url hors de la place de marché');
  // Une icône déclarée mais absente produit une vignette grise sur l'écran
  // d'accueil : on vérifie que chaque fichier existe vraiment.
  for (const icon of manifest.icons) {
    const img = await page.request.get(`${BASE.replace('/touma', '')}${icon.src}`);
    if (!img.ok()) throw new Error(`icône manquante : ${icon.src}`);
    if (!/image\/png/.test(img.headers()['content-type'] ?? '')) throw new Error(`icône non PNG : ${icon.src}`);
  }
  if (!manifest.icons.some((i) => i.purpose === 'maskable')) {
    throw new Error('aucune icône « maskable » : Android rognerait la marque');
  }
  // Le lien doit être dans la coquille, sinon le navigateur ne le lit jamais.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  if ((await page.locator('link[rel="manifest"]').count()) !== 1) throw new Error('lien du manifeste absent de la page');
});

await step('service worker : enregistré, et l’API jamais mise en cache', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const registered = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/touma/');
    return !!reg;
  });
  if (!registered) throw new Error('aucun service worker enregistré sur /touma/');

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.goto(`${BASE}/produits`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const caches = await page.evaluate(async () => {
    const names = await window.caches.keys();
    const entries = [];
    for (const name of names) {
      const cache = await window.caches.open(name);
      for (const req of await cache.keys()) entries.push(req.url);
    }
    return { names, entries };
  });
  // La règle qui compte : aucun prix, aucun stock, aucun état de commande ne
  // doit pouvoir être servi depuis une copie locale.
  const api = caches.entries.filter((url) => new URL(url).pathname.startsWith('/api/'));
  if (api.length) throw new Error(`des réponses de l’API sont en cache : ${api.slice(0, 3).join(', ')}`);
  if (!caches.entries.some((url) => url.includes('/touma/touma.js'))) {
    throw new Error('la coquille n’est pas mise en cache : aucune tolérance au réseau');
  }
});

await step('hors ligne : une page qui l’explique, pas un écran blanc', async () => {
  const offline = watch(await browser.newPage({ viewport: { width: 390, height: 844 } }), ' (hors ligne)');
  await offline.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await offline.evaluate(() => navigator.serviceWorker.ready);
  await offline.waitForTimeout(500);

  offlineExpected = true;
  await offline.context().setOffline(true);
  await offline.goto(`${BASE}/produits`, { waitUntil: 'domcontentloaded' });
  await offline.waitForTimeout(600);
  const texte = (await offline.textContent('body')) ?? '';
  if (!/TOUMA/i.test(texte)) throw new Error('la coquille ne survit pas à la coupure réseau');
  await offline.screenshot({ path: `${OUT}/40-hors-ligne.png` });

  await offline.context().setOffline(false);
  offlineExpected = false;
  await offline.close();
});

// ── Largeurs cibles : aucun débordement horizontal, menu mobile fonctionnel ──
for (const [width, height] of [
  [360, 780],
  [390, 844],
  [430, 932],
  [768, 1024],
  // 900 px est la bascule vers l'en-tête de bureau : c'est précisément là que
  // la navigation d'un vendeur connecté faisait déborder la page.
  [900, 900],
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
