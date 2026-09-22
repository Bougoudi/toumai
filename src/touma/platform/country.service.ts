import type { Country, CountryStatus, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { currencyDecimals } from '../lib/money.js';
import { estSimulation } from '../trade/corridor.service.js';
import { providerStatus as paiementStatus } from '../payments/methods.service.js';
import { providerStatus as iaStatus } from '../ai/registry.js';
import {
  AVANT_ACTIF,
  AVANT_PILOTE,
  AVANT_TEST,
  type Controle,
  type Domaine,
  type Preparation,
  statutsAtteignables,
  verdictGlobal,
} from './country-readiness.js';

/**
 * PLATEFORME MULTI-PAYS (V26 §2, §3, §4).
 *
 * TOUMA doit pouvoir ajouter un marché sans écrire un système par pays. Ce
 * fichier porte la seule chose qui rend cela sûr : **un pays ne devient ouvert
 * que si ses dépendances réelles le sont**, et le système le vérifie au lieu de
 * le croire.
 *
 * Avant, l'ouverture d'un marché tenait à trois booléens qu'un `UPDATE`
 * suffisait à mettre à vrai. Le Cameroun était ainsi déclaré actif sans
 * géographie ni transporteur : un marché annoncé ouvert par lequel rien ne
 * pouvait passer. §79 l'interdit ; le dépôt le faisait déjà.
 */

/**
 * Transitions autorisées (§3).
 *
 * On ne saute pas d'étape vers le haut : `PLANNED → ACTIVE` n'existe pas, et
 * c'est le point de tout le mécanisme. Vers le bas, en revanche, tout est
 * ouvert — suspendre un marché qui va mal ne doit jamais demander de passer
 * par un état intermédiaire.
 */
const TRANSITIONS: Record<CountryStatus, readonly CountryStatus[]> = {
  PLANNED: ['CONFIGURING', 'DEPRECATED'],
  CONFIGURING: ['TESTING', 'PLANNED', 'SUSPENDED', 'DEPRECATED'],
  TESTING: ['PILOT', 'CONFIGURING', 'SUSPENDED', 'DEPRECATED'],
  PILOT: ['ACTIVE', 'LIMITED', 'TESTING', 'SUSPENDED', 'DEPRECATED'],
  ACTIVE: ['LIMITED', 'SUSPENDED', 'DEPRECATED'],
  LIMITED: ['ACTIVE', 'SUSPENDED', 'DEPRECATED'],
  // Un marché suspendu reprend là où il en était, pas directement à l'ouverture
  // pleine : ce qui l'a fait suspendre doit être revérifié.
  SUSPENDED: ['CONFIGURING', 'TESTING', 'PILOT', 'LIMITED', 'DEPRECATED'],
  DEPRECATED: ['PLANNED'],
};

/** Statuts où le marché accepte de nouvelles transactions. */
const STATUTS_OUVERTS: ReadonlySet<CountryStatus> = new Set<CountryStatus>(['PILOT', 'ACTIVE', 'LIMITED']);

export function transitionAutorisee(depuis: CountryStatus, vers: CountryStatus): boolean {
  return TRANSITIONS[depuis].includes(vers);
}

/** Devises dont TOUMA connaît la subdivision. Ailleurs, un arrondi serait deviné. */
const DEVISES_CONNUES = ['XAF', 'XOF', 'NGN', 'GHS', 'KES', 'ZAR', 'MAD', 'EUR', 'USD'];

function controle(domaine: Domaine, etat: Controle['etat'], detail: string, bloque: readonly CountryStatus[] = []): Controle {
  return { domaine, etat, detail, bloque };
}

/**
 * Contrôle de préparation d'un marché.
 *
 * Chaque ligne interroge le système. Aucune n'est écrite en dur, aucune ne
 * répond « OK » : le détail dit ce qui a été constaté, pour qu'un administrateur
 * qui lit `BLOCKED` sache quoi faire sans ouvrir le code.
 */
export async function preparation(countryCode: string): Promise<Preparation> {
  const code = countryCode.toUpperCase();
  const pays = await prisma.country.findUnique({ where: { code }, include: { tradeConfig: true } });
  if (!pays) throw notFound(`Pays « ${code} » inconnu.`);

  const [provinces, transporteurs, boutiques, corridorsDepuis] = await Promise.all([
    prisma.toumaProvince.count({ where: { countryCode: code, active: true } }),
    prisma.toumaShippingProvider.findMany({ where: { active: true }, select: { code: true, countries: true } }),
    prisma.toumaStore.count({ where: { countryCode: code } }),
    prisma.toumaTradeCorridor.count({ where: { OR: [{ originCountry: code }, { destinationCountry: code }] } }),
  ]);

  const controles: Controle[] = [];

  // 1. Référentiel — les champs sans lesquels rien d'autre n'a de sens.
  const manquants = [
    !pays.name && 'nom',
    !pays.currency && 'devise',
    !pays.dialCode && 'indicatif téléphonique',
    !pays.timezone || pays.timezone === 'UTC' ? 'fuseau horaire' : '',
  ].filter(Boolean);
  controles.push(
    manquants.length === 0
      ? controle('database', 'READY', `Référentiel complet : ${pays.currency}, ${pays.dialCode}, ${pays.timezone}.`)
      : controle('database', 'BLOCKED', `Référentiel incomplet — manque : ${manquants.join(', ')}.`, AVANT_TEST),
  );

  // 2. Géographie — sans découpage administratif, une adresse reste du texte
  //    libre : aucun regroupement, aucune zone de livraison, aucune statistique.
  controles.push(
    provinces > 0
      ? controle('geography', 'READY', `${provinces} division(s) de premier niveau chargée(s).`)
      : controle(
          'geography',
          'BLOCKED',
          'Aucune division administrative chargée : les adresses de ce pays resteraient du texte libre, sans zone de livraison possible.',
          AVANT_PILOTE,
        ),
  );

  // 3. Devise — TOUMA doit savoir arrondir. Une devise dont la subdivision est
  //    inconnue produirait des centimes inventés.
  controles.push(
    DEVISES_CONNUES.includes(pays.currency)
      ? controle('currency', 'READY', `${pays.currency}, ${currencyDecimals(pays.currency)} décimale(s).`)
      : controle(
          'currency',
          'BLOCKED',
          `Devise « ${pays.currency} » dont la subdivision n'est pas déclarée : tout arrondi serait deviné.`,
          AVANT_TEST,
        ),
  );

  // 4. Paiements — deux conditions distinctes : des moyens déclarés pour ce
  //    pays, et un prestataire réellement agréé pour les opérer.
  const moyens = pays.tradeConfig?.paymentMethods ?? [];
  const psp = paiementStatus();
  controles.push(
    moyens.length === 0
      ? controle('payments', 'BLOCKED', 'Aucun moyen de paiement déclaré pour ce pays.', AVANT_PILOTE)
      : psp.real
        ? controle('payments', 'READY', `${moyens.join(', ')} opérés par ${psp.name}.`)
        : controle(
            'payments',
            'BLOCKED',
            `${moyens.join(', ')} déclarés, mais aucun prestataire agréé n'est raccordé (« ${psp.code} » est une simulation).`,
            AVANT_ACTIF,
          ),
  );

  // 5. Expédition — un adaptateur de simulation ne compte pas : il répond à
  //    tout, y compris à des destinations que personne ne dessert.
  const desservants = transporteurs.filter((t) => {
    if (estSimulation(t.code)) return false;
    const liste = t.countries.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    return liste.length === 0 || liste.includes(code);
  });
  const simules = transporteurs.filter((t) => estSimulation(t.code)).map((t) => t.code);
  controles.push(
    desservants.length > 0
      ? controle('shipping', 'READY', `${desservants.length} transporteur(s) réel(s) : ${desservants.map((t) => t.code).join(', ')}.`)
      : controle(
          'shipping',
          'BLOCKED',
          simules.length > 0
            ? `Aucun transporteur réel ne dessert ce pays : seul un adaptateur de simulation est enregistré (${simules.join(', ')}).`
            : 'Aucun transporteur enregistré ne dessert ce pays.',
          AVANT_PILOTE,
        ),
  );

  // 6-7. Remboursements et versements — adossés au prestataire de paiement. Il
  //      n'y a pas de remboursement réel sans encaissement réel.
  const motifPsp = `Aucun prestataire de paiement agréé n'est raccordé (« ${psp.code} »).`;
  controles.push(
    psp.real
      ? controle('refunds', 'READY', `Remboursements opérés par ${psp.name}.`)
      : controle('refunds', 'BLOCKED', motifPsp, AVANT_ACTIF),
  );
  controles.push(
    psp.real
      ? controle('payouts', 'READY', `Versements vendeurs opérés par ${psp.name}.`)
      : controle('payouts', 'BLOCKED', motifPsp, AVANT_ACTIF),
  );

  // 8. Confiance — la vérification vendeur existe-t-elle pour ce marché ?
  controles.push(
    boutiques > 0
      ? controle('trust', 'READY', `${boutiques} boutique(s) enregistrée(s), soumises à la vérification TOUMA.`)
      : controle('trust', 'WARNING', 'Aucune boutique enregistrée dans ce pays : la vérification vendeur n’y a jamais été exercée.'),
  );

  // 9-11. Assistance, notifications, cadre légal — non modélisés par pays à ce
  //       jour. Les déclarer verts serait exactement le faux statut que V25 §89
  //       interdit ; les déclarer rouges laisserait croire qu'on a mesuré.
  controles.push(controle('support', 'NOT_MEASURED', 'Aucune configuration d’assistance par pays n’existe : horaires, canaux et langue ne sont pas mesurés.'));
  // Les notifications dans l'application existent et fonctionnent. Aucune
  // passerelle SMS n'existe en revanche dans le dépôt — vérifié, pas supposé.
  // C'est un manque réel sur un marché où beaucoup d'acheteurs n'ouvriront pas
  // l'application entre la commande et la livraison, mais ce n'est pas un
  // blocage : le Tchad fonctionne aujourd'hui avec les seules notifications
  // internes.
  const notifications = await prisma.toumaNotification.count({ where: { user: { countryCode: code } } });
  controles.push(
    controle(
      'notifications',
      'WARNING',
      `Notifications dans l’application opérationnelles (${notifications} émise(s) pour ce pays). ` +
        'Aucune passerelle SMS n’est implémentée : un acheteur qui n’ouvre pas l’application ne serait pas joint.',
    ),
  );
  controles.push(controle('legal', 'NOT_MEASURED', 'Aucune configuration de conformité par pays n’existe : obligations fiscales et documentaires non modélisées.'));

  // 12. IA — la même règle qu'ailleurs : un prestataire de démonstration n'est
  //     pas un prestataire.
  const ia = iaStatus();
  controles.push(
    ia.realProviderConfigured
      ? controle('ai', 'READY', 'Assistance IA adossée à un prestataire réel.')
      : controle('ai', 'WARNING', 'Aucun prestataire d’IA réel : l’assistance répond en mode dégradé.'),
  );

  // 13. Référencement — une page pays n'est proposée à l'indexation que si le
  //     marché est ouvert (§21). Le contrôle dit où en est ce marché de ce
  //     point de vue, il ne le force pas.
  controles.push(
    STATUTS_OUVERTS.has(pays.status)
      ? controle('seo', 'READY', 'Marché ouvert : ses pages publiques sont indexables.')
      : controle('seo', 'WARNING', `Marché en « ${pays.status} » : ses pages publiques ne sont pas proposées à l’indexation.`),
  );

  // 14. Analytique — les corridors et commandes sont comptés, mais aucune
  //     métrique par pays n'est instrumentée.
  controles.push(
    controle(
      'analytics',
      'NOT_MEASURED',
      `Aucune métrique par pays n’est instrumentée (${corridorsDepuis} corridor(s) référencé(s) pour ce pays).`,
    ),
  );

  const atteignables = statutsAtteignables(controles);
  return {
    countryCode: code,
    verdict: verdictGlobal(controles),
    controles,
    atteignables,
    nonMesures: controles.filter((c) => c.etat === 'NOT_MEASURED').map((c) => c.domaine),
    statutActuel: pays.status,
    statutJustifie: atteignables.includes(pays.status),
    verifieLe: new Date().toISOString(),
  };
}

export interface ChangementStatut {
  countryCode: string;
  vers: CountryStatus;
  reason: string;
  changedById?: string | null;
}

/**
 * Change le statut d'un marché.
 *
 * Trois refus, et aucun n'est une formalité :
 * 1. une transition qui saute une étape ;
 * 2. un contrôle bloquant pour le statut visé ;
 * 3. un motif vide — une activation qu'on ne saura pas relire dans six mois.
 *
 * Le contrôle est enregistré **tel qu'il était** au moment de la décision. Le
 * recalculer plus tard donnerait l'état du jour, pas celui sur lequel on a
 * tranché.
 */
export async function changerStatut(entree: ChangementStatut): Promise<{ country: Country; readiness: Preparation }> {
  const code = entree.countryCode.toUpperCase();
  const motif = entree.reason?.trim() ?? '';
  if (motif.length < 10) {
    throw badRequest('Un changement de statut de marché doit être motivé (10 caractères au minimum).');
  }

  const pays = await prisma.country.findUnique({ where: { code } });
  if (!pays) throw notFound(`Pays « ${code} » inconnu.`);
  if (pays.status === entree.vers) throw badRequest(`Le marché ${code} est déjà en « ${entree.vers} ».`);

  if (!transitionAutorisee(pays.status, entree.vers)) {
    throw badRequest(
      `Transition « ${pays.status} » → « ${entree.vers} » non autorisée. ` +
        `Depuis « ${pays.status} », les statuts possibles sont : ${TRANSITIONS[pays.status].join(', ')}.`,
    );
  }

  const readiness = await preparation(code);
  const bloquants = readiness.controles.filter((c) => c.etat === 'BLOCKED' && c.bloque.includes(entree.vers));
  if (bloquants.length > 0) {
    throw badRequest(
      `Le marché ${code} ne peut pas passer en « ${entree.vers} » : ` +
        bloquants.map((c) => `${c.domaine} — ${c.detail}`).join(' '),
    );
  }

  const country = await prisma.$transaction(async (tx) => {
    await tx.toumaCountryStatusChange.create({
      data: {
        countryCode: code,
        fromStatus: pays.status,
        toStatus: entree.vers,
        reason: motif,
        readiness: readiness as unknown as Prisma.InputJsonValue,
        changedById: entree.changedById ?? null,
      },
    });
    return tx.country.update({
      where: { code },
      data: {
        status: entree.vers,
        // Suspendre ferme les nouvelles transactions sans rien supprimer (§45) :
        // les commandes en cours restent gérées, l'historique reste lisible.
        ...(entree.vers === 'SUSPENDED' ? { buyingEnabled: false, sellingEnabled: false } : {}),
      },
    });
  });

  return { country, readiness };
}

/** Historique des décisions d'ouverture et de fermeture d'un marché. */
export async function historiqueStatuts(countryCode: string, limite = 50) {
  return prisma.toumaCountryStatusChange.findMany({
    where: { countryCode: countryCode.toUpperCase() },
    orderBy: { createdAt: 'desc' },
    take: limite,
    select: { id: true, fromStatus: true, toStatus: true, reason: true, createdAt: true, changedById: true },
  });
}

/** Liste des marchés, avec ce que chacun autorise aujourd'hui. */
export async function marches() {
  const pays = await prisma.country.findMany({ orderBy: { code: 'asc' } });
  return pays.map((p) => ({
    code: p.code,
    name: p.name,
    nativeName: p.nativeName,
    currency: p.currency,
    dialCode: p.dialCode,
    timezone: p.timezone,
    status: p.status,
    /**
     * Trois champs, trois questions distinctes — et c'est voulu.
     *
     * `active` dit que la ligne pays est utilisable du tout : une adresse peut
     * s'y rattacher, un numéro s'y normaliser. Il est conservé tel quel, parce
     * qu'il est dans le contrat public depuis le début et que le retirer
     * casserait des clients pour un gain nul.
     *
     * `buyingEnabled` et `sellingEnabled` disent ce que le marché **autorise
     * aujourd'hui**, et croisent désormais le statut : des interrupteurs à vrai
     * sur un marché en configuration laissaient passer achats et ventes.
     */
    active: p.active,
    buyingEnabled: p.buyingEnabled && STATUTS_OUVERTS.has(p.status),
    sellingEnabled: p.sellingEnabled && STATUTS_OUVERTS.has(p.status),
  }));
}

/** Un marché accepte-t-il aujourd'hui ce type d'opération ? */
export function marcheOuvert(pays: Pick<Country, 'status' | 'buyingEnabled' | 'sellingEnabled'>, operation: 'BUY' | 'SELL'): boolean {
  if (!STATUTS_OUVERTS.has(pays.status)) return false;
  return operation === 'BUY' ? pays.buyingEnabled : pays.sellingEnabled;
}
