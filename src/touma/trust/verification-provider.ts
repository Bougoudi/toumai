import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * TOUMA TRUST — frontière KYC / KYB.
 *
 * **Ce fichier ne vérifie rien.** C'est une frontière, et c'est tout ce qu'elle
 * doit être : une interface que branchera le jour venu un prestataire réel
 * (Smile ID, Dojah, Youverify, un registre national…), plus l'implémentation
 * `LOCAL` qui dit franchement qu'un humain relit les pièces.
 *
 * Construire ici un contrôle d'identité maison serait la pire des options :
 * cela donnerait l'apparence d'une vérification réglementaire là où il n'y a
 * qu'une lecture de document, et c'est précisément l'apparence trompeuse que
 * l'énoncé interdit. `EXTERNAL_PROVIDER` existe comme forme, refuse comme
 * comportement, tant qu'aucun prestataire n'est configuré.
 *
 * **Aucune pièce ne transite par cette couche en clair vers un journal.** Les
 * documents sont désignés par une référence ; leur contenu ne sort pas du
 * stockage privé.
 */

export type VerificationProviderKind = 'LOCAL' | 'EXTERNAL_PROVIDER';

export interface VerificationSubmission {
  caseId: string;
  storeId: string;
  legalName: string;
  businessType: 'INDIVIDUAL' | 'COMPANY';
  /** Références de documents, jamais leur contenu. */
  documentRefs: string[];
}

export interface ProviderStatus {
  /** Statut tel que le prestataire le rend, normalisé. */
  status: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'UNAVAILABLE';
  /** Identifiant chez le prestataire, quand il en donne un. */
  externalId?: string;
  /** Signaux que le prestataire atteste — voir `verification-levels.ts`. */
  establishedSignals: string[];
  /** Message destiné à un humain. */
  message: string;
}

export interface VerificationProvider {
  readonly kind: VerificationProviderKind;
  submitVerification(input: VerificationSubmission): Promise<ProviderStatus>;
  getVerificationStatus(caseId: string): Promise<ProviderStatus>;
  handleWebhook(payload: unknown, signature: string | undefined): Promise<ProviderStatus | null>;
}

/**
 * Revue humaine. C'est ce que TOUMA fait réellement aujourd'hui : un
 * administrateur ouvre les pièces et tranche. Rien de plus, et le dire
 * clairement vaut mieux que d'appeler cela « KYC ».
 */
class LocalProvider implements VerificationProvider {
  readonly kind = 'LOCAL' as const;

  async submitVerification(input: VerificationSubmission): Promise<ProviderStatus> {
    return {
      status: 'PENDING',
      establishedSignals: [],
      message: `Dossier ${input.caseId} déposé. Un examinateur TOUMA relira les pièces.`,
    };
  }

  async getVerificationStatus(): Promise<ProviderStatus> {
    // Le statut fait foi en base : cette couche n'a pas d'avis propre.
    return { status: 'PENDING', establishedSignals: [], message: 'Revue humaine en cours.' };
  }

  async handleWebhook(): Promise<ProviderStatus | null> {
    // Une revue humaine n'émet pas de webhook.
    return null;
  }
}

/**
 * Prestataire externe **non configuré**.
 *
 * Refuse au lieu de simuler. Une simulation qui rendrait `APPROVED` ferait
 * passer pour vérifié quelqu'un que personne n'a vérifié — la faute la plus
 * grave que puisse commettre ce module.
 */
class UnconfiguredExternalProvider implements VerificationProvider {
  readonly kind = 'EXTERNAL_PROVIDER' as const;

  private indisponible(): ProviderStatus {
    return {
      status: 'UNAVAILABLE',
      establishedSignals: [],
      message:
        'Prestataire de vérification réel non activé — configuration requise. ' +
        'Aucune vérification externe n’est effectuée, et aucun niveau qui en dépend ne peut être accordé.',
    };
  }

  async submitVerification(): Promise<ProviderStatus> {
    logger.warn('Vérification externe demandée sans prestataire configuré');
    return this.indisponible();
  }

  async getVerificationStatus(): Promise<ProviderStatus> {
    return this.indisponible();
  }

  async handleWebhook(): Promise<ProviderStatus | null> {
    // Un webhook reçu alors qu'aucun prestataire n'est engagé n'a aucune
    // signature vérifiable : il est refusé, pas interprété.
    logger.warn('Webhook de vérification reçu sans prestataire configuré — ignoré');
    return null;
  }
}

/**
 * Prestataires dont les signaux peuvent réellement être établis aujourd'hui.
 * Vide tant qu'aucun n'est engagé, et c'est cette vacuité qui rend les niveaux
 * qui en dépendent inatteignables plutôt qu'accordés à tort.
 */
export function configuredProviderSignals(): Set<string> {
  return new Set<string>();
}

let instance: VerificationProvider | null = null;

export function verificationProvider(): VerificationProvider {
  if (!instance) {
    instance = env.touma.trust.verificationEnabled ? new LocalProvider() : new UnconfiguredExternalProvider();
  }
  return instance;
}

/** Pour les tests : force l'implémentation. */
export function setVerificationProvider(provider: VerificationProvider | null) {
  instance = provider;
}
