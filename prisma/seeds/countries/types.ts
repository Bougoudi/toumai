/**
 * Descripteur d'un marché (V26 §9).
 *
 * Un pays par fichier, déclaratif. Le but n'est pas la propreté : c'est
 * qu'ajouter le Sénégal consiste à écrire un fichier, pas à retrouver sept
 * endroits dans un seed de six cents lignes où le Tchad est mentionné.
 *
 * **Aucun descripteur ne déclare un pays ouvert.** Le statut s'y écrit, mais
 * le contrôle de préparation a le dernier mot : un marché que le seed dirait
 * `ACTIVE` sans transporteur réel serait le faux pays de §79.
 */
import type { CountryStatus } from '@prisma/client';

/** Nom d'un niveau administratif dans ce pays (§7). */
export interface NiveauAdministratif {
  /** 1 = ADM1, 2 = ADM2, 3 = ADM3, 4 = lieu habité. */
  level: number;
  name: string;
  namePlural: string;
  nameAr?: string;
  /** Faux quand le pays n'a pas ce niveau : on laisse vide au lieu d'inventer. */
  used: boolean;
}

export interface DescripteurPays {
  code: string;
  name: string;
  /** Nom dans la langue principale du pays. Omis plutôt que translittéré au hasard. */
  nativeName?: string;
  currency: string;
  dialCode: string;
  /** Fuseau IANA. Jamais « UTC » pour un pays réel : ce serait une heure fausse. */
  timezone: string;
  status: CountryStatus;
  /** Interrupteurs de service (§46), distincts du statut. */
  buyingEnabled: boolean;
  sellingEnabled: boolean;
  active: boolean;
  /** Codes ISO-639-1, la première étant la langue par défaut. */
  languages: string[];
  /** Devises acceptées en plus de celle du pays. */
  extraCurrencies?: string[];
  /** Comment ce pays nomme ses niveaux administratifs. */
  divisionLevels: NiveauAdministratif[];
  /**
   * Participe-t-il au commerce transfrontalier, et avec quoi ?
   *
   * `paymentMethods` et `shippingProviders` listent ce qui est **déclaré
   * disponible**, pas ce qui fonctionne : la capacité réelle d'un corridor est
   * recalculée à chaque lecture depuis les prestataires enregistrés (V24 §72).
   */
  trade?: {
    enabled: boolean;
    paymentMethods: string[];
    shippingProviders: string[];
    notes?: string;
  };
  /** Ce qui manque à ce marché, écrit noir sur blanc dans le descripteur. */
  notes: string;
}
