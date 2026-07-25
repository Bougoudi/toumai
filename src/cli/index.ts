import { createInterface, type Interface } from 'node:readline';
import { runFullCycle } from '../automation/autopilot.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { dashboardService } from '../modules/dashboard/dashboard.service.js';
import { generationService } from '../modules/products/generation.service.js';
import { marketService } from '../modules/market/market.service.js';
import { orderService } from '../modules/orders/order.service.js';
import { searchService } from '../modules/search/search.service.js';
import { banner, c, hr, money, statusColor, table, clear } from './ui.js';

// La CLI pilote ses propres messages : on réduit les logs techniques.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';

let rl: Interface;
let autopilotTimer: NodeJS.Timeout | null = null;
let lastCycle: string | null = null;

// File de lignes : robuste aussi bien en terminal interactif qu'en entrée
// redirigée (les lignes bufferisées ne sont jamais perdues entre deux invites).
const lineQueue: string[] = [];
const waiters: Array<(line: string) => void> = [];
let inputClosed = false;

function initInput() {
  rl.on('line', (line) => {
    const next = waiters.shift();
    if (next) next(line.trim());
    else lineQueue.push(line.trim());
  });
  rl.on('close', () => {
    inputClosed = true;
    // Débloque les invites en attente en simulant « Quitter ».
    while (waiters.length) waiters.shift()!('0');
  });
}

function ask(question: string): Promise<string> {
  if (question) process.stdout.write(question);
  if (lineQueue.length) return Promise.resolve(lineQueue.shift()!);
  if (inputClosed) return Promise.resolve('0');
  return new Promise((resolve) => waiters.push(resolve));
}

async function pause() {
  await ask(c.dim('\nAppuyez sur Entrée pour revenir au menu...'));
}

// ─────────────────────────────────────────────────────────────
// Écran principal
// ─────────────────────────────────────────────────────────────

function renderMenu() {
  clear();
  console.log(banner);
  const state = autopilotTimer
    ? c.green('● ACTIF') + c.dim(`  (cycle toutes les ${env.autopilot.intervalSeconds}s)`)
    : c.gray('○ arrêté');
  console.log(`\n  Pilote automatique : ${state}`);
  if (lastCycle) console.log(c.dim(`  Dernier cycle : ${lastCycle}`));
  console.log(`\n${hr()}\n`);
  console.log(`  ${c.bold('1')}  Tableau de bord`);
  console.log(`  ${c.bold('2')}  Lancer un cycle complet maintenant`);
  console.log(`  ${c.bold('3')}  ${autopilotTimer ? 'Arrêter' : 'Démarrer'} le pilote automatique`);
  console.log(hr(30));
  console.log(`  ${c.bold('4')}  [1] Analyser le marché`);
  console.log(`  ${c.bold('5')}  [2] Générer des produits`);
  console.log(`  ${c.bold('6')}  [4] Rechercher des fournisseurs`);
  console.log(`  ${c.bold('7')}  [3] Voir les commandes`);
  console.log(`  ${c.bold('8')}  Voir les produits`);
  console.log(hr(30));
  console.log(`  ${c.bold('0')}  Quitter\n`);
}

// ─────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────

async function showDashboard() {
  clear();
  console.log(c.bold('\n  📊 TABLEAU DE BORD\n'));
  const d = await dashboardService.overview();
  console.log(`  ${c.cyan('Marché')}      ${d.market.opportunities} opportunités · score moyen ${d.market.avgOpportunityScore}/100`);
  console.log(`  ${c.cyan('Catalogue')}   ${d.catalog.products} produits (${d.catalog.active} actifs, ${d.catalog.generatedToday} générés aujourd'hui)`);
  console.log(`  ${c.cyan('Fournisseurs')} ${d.suppliers.total}`);
  console.log(`  ${c.cyan('Commandes')}   ${d.orders.total}  ${formatStatusMap(d.orders.byStatus)}`);
  console.log(`\n${hr()}\n`);
  console.log(`  ${c.bold('Finances')}`);
  console.log(`    Chiffre d'affaires : ${c.green(money(d.finance.revenue, d.finance.currency))}`);
  console.log(`    Coût d'achat       : ${money(d.finance.purchaseCost, d.finance.currency)}`);
  console.log(`    ${c.bold('Profit estimé')}      : ${c.green(money(d.finance.estimatedProfit, d.finance.currency))}`);

  if (d.recent.orders.length) {
    console.log(`\n${hr()}\n\n  ${c.bold('Dernières commandes')}\n`);
    console.log(
      table(
        ['N°', 'Client', 'Statut', 'Total', 'Art.'],
        d.recent.orders.map((o) => [
          o.orderNumber,
          o.customer,
          statusColor(o.status),
          money(o.total),
          String(o.items),
        ]),
      ),
    );
  }
  await pause();
}

function formatStatusMap(map: Record<string, number>): string {
  const entries = Object.entries(map);
  if (!entries.length) return c.dim('(aucune)');
  return entries.map(([k, v]) => `${statusColor(k)}:${v}`).join('  ');
}

async function runCycleNow() {
  clear();
  console.log(c.bold('\n  ⚙️  Exécution d’un cycle complet...\n'));
  const r = await runFullCycle();
  lastCycle = new Date().toLocaleTimeString('fr-FR');
  console.log(c.green('  ✓ Cycle terminé') + c.dim(` (${r.durationMs} ms)\n`));
  console.log(`    Opportunités détectées : ${r.opportunities}`);
  console.log(`    Produits générés       : ${r.productsGenerated}`);
  console.log(`    Fournisseurs synchro.  : ${r.suppliers}`);
  console.log(`    Commandes créées       : ${r.ordersCreated}`);
  console.log(`    Commandes expédiées    : ${r.ordersFulfilled}`);
  console.log(`    Recherches traitées    : ${r.searchesProcessed}`);
  await pause();
}

function toggleAutopilot() {
  if (autopilotTimer) {
    clearInterval(autopilotTimer);
    autopilotTimer = null;
    return;
  }
  const tick = () => {
    runFullCycle()
      .then(() => {
        lastCycle = new Date().toLocaleTimeString('fr-FR');
      })
      .catch(() => undefined);
  };
  tick(); // premier cycle immédiat
  autopilotTimer = setInterval(tick, env.autopilot.intervalSeconds * 1000);
}

async function scanMarket() {
  clear();
  console.log(c.bold('\n  🔎 [1] Analyse du marché\n'));
  const region = await ask('  Région (EU/Asia/Africa, vide = toutes) : ');
  const { discovered } = await marketService.scan({ region: region || undefined });
  console.log(c.green(`\n  ✓ ${discovered} opportunités analysées\n`));
  const top = await marketService.list({ take: 10, skip: 0, minScore: 0 });
  console.log(
    table(
      ['Produit', 'Catégorie', 'Score', 'Demande', 'Concur.', 'Statut'],
      top.items.map((o) => [
        o.title.slice(0, 30),
        o.category,
        c.bold(String(Math.round(o.opportunityScore))),
        String(Math.round(o.demandScore)),
        String(Math.round(o.competitionScore)),
        statusColor(o.status),
      ]),
    ),
  );
  await pause();
}

async function generateProducts() {
  clear();
  console.log(c.bold('\n  🏭 [2] Génération de produits\n'));
  const nb = await ask('  Combien de produits générer ? (défaut 20) : ');
  const limit = Number(nb) || 20;
  console.log(c.dim('\n  Génération en cours...'));
  const run = await generationService.generate({ limit, autoPublish: true });
  console.log(
    c.green(`\n  ✓ ${run.generated} produits générés`) +
      c.dim(` (${run.skipped} ignorés, ${run.failed} échecs)\n`),
  );
  const products = await prisma.product.findMany({
    where: { source: 'generated' },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  console.log(
    table(
      ['Nom', 'Catégorie', 'Achat', 'Vente', 'Marge'],
      products.map((p) => [
        p.name.slice(0, 34),
        p.category,
        money(p.costPrice ?? 0),
        c.green(money(p.salePrice ?? 0)),
        money(p.margin ?? 0),
      ]),
    ),
  );
  await pause();
}

async function searchSuppliers() {
  clear();
  console.log(c.bold('\n  🤝 [4] Recherche de fournisseurs\n'));
  const query = await ask('  Produit / mots-clés : ');
  const category = await ask('  Catégorie (vide = toutes) : ');
  const region = await ask('  Région (vide = toutes) : ');
  if (!query && !category) {
    console.log(c.red('\n  Veuillez saisir au moins un mot-clé ou une catégorie.'));
    return pause();
  }
  const result = await searchService.searchNow({
    query,
    category: category || undefined,
    region: region || undefined,
    keywords: '',
    requiredCertifications: '',
    limit: 10,
    async: false,
  });
  console.log(c.green(`\n  ✓ ${result.results.length} fournisseurs classés\n`));
  console.log(
    table(
      ['#', 'Fournisseur', 'Pays', 'Note', 'Score', 'Meilleure offre'],
      result.results.map((r) => [
        String(r.rank),
        r.supplier.name.slice(0, 24),
        r.supplier.country ?? '-',
        `${r.supplier.rating}/5`,
        c.bold(String(r.breakdown.total)),
        r.offer ? `${r.offer.title.slice(0, 22)} (${money(r.offer.unitPrice ?? 0)})` : c.dim('—'),
      ]),
    ),
  );
  await pause();
}

async function showOrders() {
  clear();
  console.log(c.bold('\n  📦 [3] Commandes\n'));
  const list = await orderService.list({ take: 15, skip: 0 });
  console.log(c.dim(`  ${list.total} commandes au total\n`));
  console.log(
    table(
      ['N°', 'Client', 'Statut', 'Total', 'Créée'],
      list.items.map((o: any) => [
        o.orderNumber,
        o.customer?.name ?? '-',
        statusColor(o.status),
        money(o.total),
        new Date(o.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }),
      ]),
    ),
  );
  await pause();
}

async function showProducts() {
  clear();
  console.log(c.bold('\n  🛍️  Produits du catalogue\n'));
  const products = await prisma.product.findMany({ orderBy: { createdAt: 'desc' }, take: 15 });
  const total = await prisma.product.count();
  console.log(c.dim(`  ${total} produits au total\n`));
  console.log(
    table(
      ['Nom', 'Catégorie', 'Vente', 'Marge', 'Statut'],
      products.map((p) => [
        p.name.slice(0, 34),
        p.category,
        c.green(money(p.salePrice ?? 0)),
        money(p.margin ?? 0),
        statusColor(p.status),
      ]),
    ),
  );
  await pause();
}

// ─────────────────────────────────────────────────────────────
// Boucle principale
// ─────────────────────────────────────────────────────────────

async function loop() {
  for (;;) {
    renderMenu();
    const choice = await ask('  Votre choix : ');
    switch (choice) {
      case '1': await showDashboard(); break;
      case '2': await runCycleNow(); break;
      case '3': toggleAutopilot(); break;
      case '4': await scanMarket(); break;
      case '5': await generateProducts(); break;
      case '6': await searchSuppliers(); break;
      case '7': await showOrders(); break;
      case '8': await showProducts(); break;
      case '0':
      case 'q':
        return;
      default:
        // choix inconnu → on réaffiche le menu
        break;
    }
  }
}

async function main() {
  rl = createInterface({ input: process.stdin, output: process.stdout });
  initInput();
  try {
    await loop();
  } finally {
    if (autopilotTimer) clearInterval(autopilotTimer);
    rl.close();
    await prisma.$disconnect();
    console.log(c.cyan('\n  À bientôt ! 👋\n'));
  }
}

main().catch(async (err) => {
  console.error(c.red('Erreur fatale :'), err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
