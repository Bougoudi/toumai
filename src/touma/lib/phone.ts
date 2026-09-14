import { badRequest } from './errors.js';

/**
 * Normalisation des numéros de téléphone en E.164.
 *
 * **Le défaut corrigé.** La seule validation était `^\+?[0-9\s-]{6,20}$`. Étaient
 * donc acceptés, et stockés tels quels, `66 12 34 56`, `+235 66123456`,
 * `00235 66123456` et `235-66-12-34-56` — quatre écritures du même numéro, que
 * la base tenait pour quatre numéros différents.
 *
 * Ce que cela coûtait : impossible de reconnaître deux comptes ouverts avec le
 * même numéro, impossible d'envoyer un SMS de façon fiable, impossible de
 * détecter une fraude par numéro. Et pour l'acheteur tchadien qui écrit son
 * numéro comme il le dit — sans indicatif —, un livreur qui ne peut pas le
 * joindre.
 *
 * **Ce que cette fonction ne fait pas.** Elle ne valide pas qu'un numéro existe,
 * ni qu'il appartient à un opérateur réel : personne ne peut le savoir sans
 * appeler. Elle garantit une seule chose, mais elle la garantit vraiment — un
 * numéro, une écriture.
 */

/** Longueur du numéro national, par indicatif. Source : plans de numérotation. */
const NATIONAL_LENGTH: Record<string, number[]> = {
  // Tchad : 8 chiffres depuis le passage au format à 8 chiffres.
  '235': [8],
  // Cameroun : 9 chiffres.
  '237': [9],
};

/** Indicatif par défaut quand l'utilisateur n'en met pas. */
const DEFAULT_DIAL_CODE = '235';

export interface NormalizedPhone {
  /** Forme canonique E.164, la seule qui doit être stockée (ex. `+23566123456`). */
  e164: string;
  /** Indicatif pays retenu, sans le `+`. */
  dialCode: string;
  /** Numéro national, sans indicatif. */
  nationalNumber: string;
}

/** Indicatifs connus, du plus long au plus court pour que `235` batte `23`. */
const KNOWN_DIAL_CODES = Object.keys(NATIONAL_LENGTH).sort((a, b) => b.length - a.length);

/**
 * Normalise un numéro. `defaultDialCode` est l'indicatif du pays de
 * l'utilisateur, sans le `+` — celui du compte, jamais celui du serveur.
 */
export function normalizePhone(input: string, defaultDialCode = DEFAULT_DIAL_CODE): NormalizedPhone {
  const brut = input.trim();
  if (!brut) throw badRequest('Numéro de téléphone requis.');

  // On ne garde que les chiffres, après avoir retenu si le numéro était déjà
  // international. `+235…` et `00235…` disent la même chose.
  const international = brut.startsWith('+') || brut.startsWith('00');
  let chiffres = brut.replace(/[^0-9]/g, '');
  if (brut.startsWith('00')) chiffres = chiffres.slice(2);

  if (!/^[0-9]+$/.test(chiffres)) throw badRequest('Numéro de téléphone invalide.');

  let dialCode: string;
  let national: string;

  if (international) {
    dialCode = KNOWN_DIAL_CODES.find((c) => chiffres.startsWith(c)) ?? '';
    if (!dialCode) {
      // Indicatif inconnu : on ne devine pas. Un numéro dont on ne sait pas
      // découper l'indicatif ne doit pas être rangé au hasard.
      throw badRequest('Indicatif pays non reconnu. Utilisez le format +235XXXXXXXX.');
    }
    national = chiffres.slice(dialCode.length);
  } else {
    dialCode = defaultDialCode;
    // Un zéro de tête est une habitude d'appel national ; il ne fait pas partie
    // du numéro en E.164.
    national = chiffres.replace(/^0+/, '');
  }

  const longueurs = NATIONAL_LENGTH[dialCode];
  if (longueurs && !longueurs.includes(national.length)) {
    const attendu = longueurs.join(' ou ');
    throw badRequest(`Un numéro +${dialCode} compte ${attendu} chiffres ; celui-ci en a ${national.length}.`);
  }
  // Pays sans plan connu : on applique les bornes de la norme E.164 elle-même.
  if (!longueurs && (national.length < 4 || dialCode.length + national.length > 15)) {
    throw badRequest('Numéro de téléphone invalide.');
  }

  return { e164: `+${dialCode}${national}`, dialCode, nationalNumber: national };
}

/**
 * Variante tolérante : rend `null` au lieu de lever. Utile là où le numéro est
 * facultatif et où une saisie douteuse ne doit pas faire échouer l'opération
 * entière — on préfère alors ne rien stocker à stocker n'importe quoi.
 */
export function tryNormalizePhone(input: string | null | undefined, defaultDialCode = DEFAULT_DIAL_CODE): string | null {
  if (!input) return null;
  try {
    return normalizePhone(input, defaultDialCode).e164;
  } catch {
    return null;
  }
}

/**
 * Affichage lisible d'un numéro tchadien : `+235 66 12 34 56`. Purement
 * cosmétique — c'est la forme E.164 qui est stockée et comparée.
 */
export function formatPhone(e164: string): string {
  const match = /^\+(\d{1,3})(\d+)$/.exec(e164);
  if (!match) return e164;
  const [, dialCode, national] = match;
  const groupes = national.match(/\d{1,2}/g) ?? [national];
  return `+${dialCode} ${groupes.join(' ')}`;
}
