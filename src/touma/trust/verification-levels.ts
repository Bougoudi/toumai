import type { VerificationLevel } from '@prisma/client';

/**
 * TOUMA TRUST — niveaux de vérification.
 *
 * **Un niveau est une liste de signaux, pas un palier de prix.** Chaque niveau
 * exige les signaux du précédent plus les siens ; aucun ne s'achète, aucun ne
 * s'obtient par ancienneté seule. C'est ce qui permet à « vendeur vérifié
 * ENTERPRISE » de vouloir dire quelque chose de précis, et à un vendeur de
 * savoir exactement ce qui lui manque.
 *
 * **Ce que TOUMA ne peut pas encore vérifier est dit ici.** Trois signaux
 * dépendent d'un prestataire qui n'est pas engagé : la confirmation d'un
 * téléphone (SMS), celle d'un compte de règlement (PSP), et l'existence légale
 * d'une entreprise auprès d'un registre. Ils sont déclarés `providerRequired`
 * et **ne peuvent pas être cochés** tant que le prestataire n'est pas branché.
 * Un niveau qui en dépend reste donc inatteignable — c'est voulu : mieux vaut
 * un niveau hors d'atteinte qu'un niveau accordé sur une vérification qui n'a
 * pas eu lieu.
 */

export interface VerificationSignal {
  code: string;
  /** Ce que le signal atteste réellement, en une phrase. */
  meaning: string;
  /**
   * `true` quand le signal ne peut être établi que par un prestataire externe
   * (SMS, PSP, registre du commerce). Tant qu'aucun n'est configuré, le signal
   * est déclaré manquant, jamais supposé acquis.
   */
  providerRequired: boolean;
}

export const SIGNALS: Record<string, VerificationSignal> = {
  EMAIL_ON_FILE: {
    code: 'EMAIL_ON_FILE',
    meaning: 'Une adresse électronique est enregistrée sur le compte.',
    providerRequired: false,
  },
  PHONE_CONFIRMED: {
    code: 'PHONE_CONFIRMED',
    meaning: 'Le numéro a été confirmé par son porteur au moyen d’un code reçu par SMS.',
    providerRequired: true,
  },
  IDENTITY_DOCUMENT: {
    code: 'IDENTITY_DOCUMENT',
    meaning: 'Une pièce d’identité a été fournie et relue par un examinateur.',
    providerRequired: false,
  },
  ADDRESS_DECLARED: {
    code: 'ADDRESS_DECLARED',
    meaning: 'Une adresse de retrait ou d’expédition est enregistrée.',
    providerRequired: false,
  },
  COMPANY_REGISTRY: {
    code: 'COMPANY_REGISTRY',
    meaning: 'L’existence légale de l’entreprise a été confirmée auprès d’un registre.',
    providerRequired: true,
  },
  COMPANY_DOCUMENTS: {
    code: 'COMPANY_DOCUMENTS',
    meaning: 'Registre du commerce et identifiant fiscal fournis et relus.',
    providerRequired: false,
  },
  PAYOUT_ACCOUNT: {
    code: 'PAYOUT_ACCOUNT',
    meaning: 'Un compte de règlement a été confirmé par le prestataire de paiement.',
    providerRequired: true,
  },
  TRANSACTION_HISTORY: {
    code: 'TRANSACTION_HISTORY',
    meaning: 'Un historique de commandes livrées existe sur la plateforme.',
    providerRequired: false,
  },
};

export interface LevelDefinition {
  level: VerificationLevel;
  /** Signaux exigés **en plus** de ceux du niveau précédent. */
  requires: string[];
  /** Antériorité minimale, en commandes livrées. */
  minDeliveredOrders: number;
}

export const LEVELS: LevelDefinition[] = [
  { level: 'NONE', requires: [], minDeliveredOrders: 0 },
  {
    level: 'BASIC',
    requires: ['EMAIL_ON_FILE', 'IDENTITY_DOCUMENT'],
    minDeliveredOrders: 0,
  },
  {
    level: 'BUSINESS',
    requires: ['ADDRESS_DECLARED', 'COMPANY_DOCUMENTS'],
    minDeliveredOrders: 0,
  },
  {
    level: 'PRO',
    requires: ['TRANSACTION_HISTORY'],
    minDeliveredOrders: 25,
  },
  {
    level: 'ENTERPRISE',
    // Les deux signaux qui exigent un tiers. Tant qu'aucun prestataire n'est
    // engagé, ce niveau n'est pas atteignable — et l'API le dit plutôt que de
    // laisser croire qu'il suffit de déposer un dossier de plus.
    requires: ['COMPANY_REGISTRY', 'PAYOUT_ACCOUNT'],
    minDeliveredOrders: 100,
  },
];

const ORDER: VerificationLevel[] = ['NONE', 'BASIC', 'BUSINESS', 'PRO', 'ENTERPRISE'];

/** Tous les signaux exigés jusqu'à un niveau donné, cumulés. */
export function requirementsFor(level: VerificationLevel): string[] {
  const jusqua = ORDER.indexOf(level);
  return LEVELS.filter((_, i) => i <= jusqua).flatMap((l) => l.requires);
}

export interface LevelAssessment {
  level: VerificationLevel;
  /** Niveau le plus élevé réellement atteint. */
  granted: VerificationLevel;
  /** Ce qui manque pour le niveau demandé, signal par signal. */
  missing: Array<{ code: string; meaning: string; blockedByProvider: boolean }>;
  /** `true` si un signal manquant dépend d'un prestataire non engagé. */
  blockedByProvider: boolean;
}

/**
 * Évalue le niveau réellement atteint à partir des signaux établis.
 *
 * Ne suppose jamais un signal acquis : ce qui n'est pas dans `established` est
 * manquant, y compris — et surtout — les signaux qui dépendent d'un
 * prestataire. Le résultat nomme ce qui bloque, pour que le vendeur puisse agir
 * ou comprendre qu'il ne le peut pas.
 */
export function assess(
  requested: VerificationLevel,
  established: Set<string>,
  deliveredOrders: number,
  providersConfigured: Set<string> = new Set(),
): LevelAssessment {
  let granted: VerificationLevel = 'NONE';
  for (const definition of LEVELS) {
    if (definition.level === 'NONE') continue;
    const requis = requirementsFor(definition.level);
    const complet = requis.every((code) => established.has(code));
    if (complet && deliveredOrders >= definition.minDeliveredOrders) granted = definition.level;
    else break;
  }

  const missing = requirementsFor(requested)
    .filter((code) => !established.has(code))
    .map((code) => {
      const signal = SIGNALS[code];
      return {
        code,
        meaning: signal?.meaning ?? code,
        blockedByProvider: Boolean(signal?.providerRequired) && !providersConfigured.has(code),
      };
    });

  return {
    level: requested,
    granted,
    missing,
    blockedByProvider: missing.some((m) => m.blockedByProvider),
  };
}
