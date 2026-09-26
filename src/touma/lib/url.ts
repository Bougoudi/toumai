import { z } from 'zod';

/**
 * VALIDATION D'URL (V25 §40).
 *
 * `z.string().url()` accepte bien plus que ce qu'on croit. Vérifié :
 *
 * ```
 * javascript:alert(1)                → ACCEPTÉ
 * data:text/html;base64,PHNjcmlwdD4= → ACCEPTÉ
 * file:///etc/passwd                 → ACCEPTÉ
 * vbscript:msgbox(1)                 → ACCEPTÉ
 * ```
 *
 * Il s'appuie sur `new URL()`, qui valide la *forme* et ne dit rien du
 * schéma. Dix champs du domaine l'employaient : image de produit, logo de
 * boutique, pièce de vérification, preuve de litige, site d'entreprise,
 * source d'une règle commerciale, retour de paiement.
 *
 * Deux de ces champs finissent dans un `<a href>` — la source d'un itinéraire
 * de corridor est rendue ainsi sur la vitrine publique, qui n'a pas de
 * politique de sécurité de contenu. Un `javascript:` y aurait été exécuté
 * dans le navigateur de chaque visiteur, planté par un administrateur ne
 * disposant que de `ADMIN_TRADE`. Le découpage des permissions rend ce
 * scénario concret plutôt que théorique.
 *
 * Aucun de ces champs n'a de raison d'accepter autre chose que `http` et
 * `https`.
 */

const SCHEMAS_AUTORISES = new Set(['http:', 'https:']);

/**
 * URL web, et rien d'autre.
 *
 * Les identifiants dans l'URL (`https://alice:motdepasse@exemple.test`) sont
 * refusés aussi : ils servent surtout à déguiser un domaine hostile derrière
 * un nom rassurant, et aucun usage légitime du domaine n'en a besoin.
 */
export function urlWeb(maxLength = 500) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .refine(
      (valeur) => {
        let parsee: URL;
        try {
          parsee = new URL(valeur);
        } catch {
          return false;
        }
        if (!SCHEMAS_AUTORISES.has(parsee.protocol)) return false;
        if (parsee.username || parsee.password) return false;
        return parsee.hostname.length > 0;
      },
      { message: 'Adresse invalide : seules les adresses http:// et https:// sont acceptées.' },
    );
}

/**
 * Origines autorisées pour un retour de paiement.
 *
 * Vide tant que rien n'est configuré. `returnUrl` n'est aujourd'hui consommé
 * par aucun prestataire — mais c'est le champ qui **deviendra** la cible d'une
 * redirection le jour où un vrai prestataire sera raccordé, et une redirection
 * ouverte est le moyen le plus commode de faire atterrir un acheteur sur une
 * fausse page de confirmation.
 *
 * La liste se configure avant ce raccordement, pas après.
 */
export function originesRetourAutorisees(): string[] {
  return (process.env.TOUMA_PAYMENT_RETURN_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** URL de retour de paiement : web, et dans la liste d'origines si elle existe. */
export function urlRetourPaiement(maxLength = 500) {
  return urlWeb(maxLength).refine(
    (valeur) => {
      const autorisees = originesRetourAutorisees();
      if (autorisees.length === 0) return true; // non configurée : on ne bloque pas ce qui n'est pas encore branché
      try {
        return autorisees.includes(new URL(valeur).origin);
      } catch {
        return false;
      }
    },
    { message: 'Adresse de retour non autorisée.' },
  );
}
