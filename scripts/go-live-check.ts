/**
 * CONTRÔLE DE MISE EN SERVICE (V25 §79).
 *
 * Ce que ce script **ne** prouve **pas**, et qu'il faut dire d'emblée : que
 * les parcours fonctionnent. La preuve fonctionnelle, c'est la suite de bout
 * en bout (`npm run test:e2e`), qui passe des commandes réelles contre une
 * base réelle. Un script qui se contenterait de constater que les routes sont
 * montées dirait « le code existe » — et V24 §72 interdit explicitement de
 * conclure quoi que ce soit de la seule existence du code.
 *
 * Ce qu'il fait : pour chacun des quatorze domaines, il dit si le domaine est
 * **ouvert** sur cette instance, et si ce qu'il promet à un acheteur repose
 * sur quelque chose de réel. Un domaine ouvert dont le prestataire est une
 * simulation est signalé comme tel — c'est la différence entre « ça
 * fonctionne » et « ça a l'air de fonctionner ».
 *
 *     npm run check:go-live
 */
import { prisma } from '../src/db/prisma.js';
import { env } from '../src/config/env.js';
import { providerStatus as providerPaiement } from '../src/touma/payments/methods.service.js';
import { providerStatus as providerIa } from '../src/touma/ai/registry.js';
import { fxService } from '../src/touma/trade/fx.service.js';
import { estSimulation } from '../src/touma/trade/corridor.service.js';

type Etat = 'PRET' | 'SIMULATION' | 'FERME' | 'PARTIEL';

interface Domaine {
  nom: string;
  etat: Etat;
  detail: string;
}

async function transporteurReel(): Promise<boolean> {
  const actifs = await prisma.toumaShippingProvider.findMany({ where: { active: true }, select: { code: true } });
  return actifs.some((t) => !estSimulation(t.code));
}

async function domaines(): Promise<Domaine[]> {
  const paiement = providerPaiement();
  const ia = providerIa();
  const transport = await transporteurReel();
  const corridorsOperationnels = env.touma.trade.enabled
    ? (await prisma.toumaTradeCorridor.count({ where: { status: { in: ['ACTIVE', 'LIMITED'] } } })) > 0
    : false;

  return [
    { nom: 'Authentification', etat: 'PRET', detail: 'Jetons à rotation, sessions révocables, anti-force brute.' },
    { nom: 'Catalogue', etat: 'PRET', detail: 'Recherche, facettes et fiches servies depuis PostgreSQL.' },
    { nom: 'Panier', etat: 'PRET', detail: 'Réservation de stock avec expiration.' },
    { nom: 'Commandes', etat: 'PRET', detail: 'Machine à états complète, historique conservé.' },
    {
      nom: 'Paiement',
      etat: paiement.real ? 'PRET' : 'SIMULATION',
      detail: paiement.message,
    },
    {
      nom: 'Remboursement',
      etat: paiement.real ? 'PRET' : 'SIMULATION',
      detail: paiement.real ? 'Adossé au prestataire réel.' : 'Suit le paiement : simulé tant que le prestataire l’est.',
    },
    {
      nom: 'Versements vendeurs',
      etat: paiement.real ? 'PARTIEL' : 'SIMULATION',
      detail: 'Le grand livre est tenu ; aucun versement réel n’est émis tant qu’aucun prestataire de paiement sortant n’est raccordé.',
    },
    {
      nom: 'Expédition',
      etat: transport ? 'PRET' : 'SIMULATION',
      detail: transport ? 'Au moins un transporteur réel enregistré.' : 'Aucun transporteur réel : aucune expédition ne partira.',
    },
    { nom: 'Confiance et sécurité', etat: 'PRET', detail: 'Vérifications, litiges, risque — tous adossés à des faits en base.' },
    {
      nom: 'Croissance',
      etat: env.touma.growth.promotionsEnabled || env.touma.growth.couponsEnabled ? 'PRET' : 'FERME',
      detail: 'Promotions, coupons, fidélité : commandés par leurs interrupteurs d’environnement.',
    },
    {
      nom: 'Assistance IA',
      etat: !env.touma.ai.enabled ? 'FERME' : ia.realProviderConfigured ? 'PRET' : 'PARTIEL',
      detail: ia.realProviderConfigured
        ? `Modèle réel : ${ia.name}.`
        : 'Repli déterministe : il refuse d’inventer plutôt que de répondre à côté. Utilisable, mais ce n’est pas un modèle.',
    },
    {
      nom: 'Commerce transfrontalier',
      etat: !env.touma.trade.enabled ? 'FERME' : corridorsOperationnels && transport ? 'PRET' : 'PARTIEL',
      detail: !env.touma.trade.enabled
        ? 'Désactivé sur cette instance.'
        : transport
          ? 'Corridors déclarés ouverts et transporteur réel présent — la capacité réelle reste recalculée par corridor.'
          : 'Aucun transporteur réel : aucun corridor ne peut être opérationnel, quel que soit son statut déclaré.',
    },
    {
      nom: 'Notifications',
      etat: env.touma.notifications?.emailEnabled ? 'PRET' : 'PARTIEL',
      detail: env.touma.notifications?.emailEnabled
        ? 'Canal courriel configuré.'
        : 'Notifications dans l’application uniquement : aucun canal externe configuré, rien n’est envoyé hors du site.',
    },
    {
      nom: 'Taux de change',
      etat: fxService.status().configured ? 'PRET' : 'FERME',
      detail: fxService.status().message ?? 'Aucune source configurée : aucune conversion n’est présentée comme réelle.',
    },
    { nom: 'Administration', etat: 'PRET', detail: 'Permissions granulaires, audit immuable, centre d’opérations.' },
  ];
}

async function main(): Promise<void> {
  const liste = await domaines();
  const symbole: Record<Etat, string> = { PRET: '✓', PARTIEL: '~', SIMULATION: '!', FERME: '·' };

  console.log('\n═══ Mise en service TOUMA — état des domaines ═══\n');
  for (const d of liste) {
    console.log(`  ${symbole[d.etat]} ${d.etat.padEnd(11)} ${d.nom.padEnd(26)} ${d.detail}`);
  }

  const simules = liste.filter((d) => d.etat === 'SIMULATION');
  console.log('\n───────────────────────────────────────────────\n');
  if (simules.length > 0) {
    console.log(`! ${simules.length} domaine(s) reposent sur une simulation : ${simules.map((d) => d.nom).join(', ')}.`);
    console.log('  Ouvrir au public dans cet état promettrait à des acheteurs ce que personne ne peut tenir.\n');
  }

  console.log('Ce contrôle ne prouve pas que les parcours fonctionnent.');
  console.log('  Preuve fonctionnelle : npm run test:e2e');
  console.log('  Préalables d’exploitation : npm run check:production\n');

  await prisma.$disconnect();
  // Sortie non nulle dès qu'un domaine repose sur une simulation : c'est la
  // condition qui rend une ouverture au public malhonnête.
  if (simules.length > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error('✗ Le contrôle a échoué :', err instanceof Error ? err.message : String(err));
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
