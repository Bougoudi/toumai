import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Code de retrait en point relais.
 *
 * **Le défaut corrigé.** Le parcours allait jusqu'à l'arrivée du colis au point
 * relais, et s'arrêtait là. **Rien ne prouvait que celui qui se présentait était
 * le destinataire** : il suffisait de connaître le numéro de commande, qui
 * figure sur tous les écrans, dans tous les e-mails et sur l'étiquette du colis.
 *
 * Trois décisions, chacune pour une raison :
 *
 * **Six chiffres, pas une chaîne alphanumérique.** Le code se dicte au
 * téléphone, se lit sur un écran fissuré, se tape sur un clavier numérique. Un
 * code qu'on n'arrive pas à transmettre n'est pas utilisé, et un code non
 * utilisé est remplacé par « je le connais, c'est bon ».
 *
 * **La base ne stocke que l'empreinte.** Une base lue par un tiers — sauvegarde
 * égarée, accès en lecture mal réglé — ne doit pas lui permettre de retirer les
 * colis des autres. L'empreinte est un HMAC : sans le secret du serveur, un
 * dictionnaire des six chiffres ne sert à rien, ce qui ne serait pas vrai d'un
 * simple hachage.
 *
 * **La comparaison est à temps constant.** Sinon le temps de réponse dit, chiffre
 * par chiffre, si l'on approche.
 */

/** Longueur du code. Six chiffres se dictent ; douze ne se dictent pas. */
const CODE_LENGTH = 6;

/** Génère un code de retrait. Rendu **une seule fois**, à l'acheteur. */
export function generatePickupCode(): string {
  // randomInt du module crypto : Math.random est prévisible, et ce code ouvre un
  // colis.
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += String(randomInt(0, 10));
  return code;
}

/** Empreinte à stocker. Le code lui-même n'est jamais écrit en base. */
export function hashPickupCode(code: string, orderId: string): string {
  // L'identifiant de commande entre dans l'empreinte : un code valable pour une
  // commande ne vaut pour aucune autre, même s'il tombe juste par hasard.
  return createHmac('sha256', env.touma.accessSecret).update(`pickup.${orderId}.${code}`).digest('hex');
}

/** Vérifie un code présenté au comptoir. */
export function verifyPickupCode(code: string, orderId: string, expectedHash: string | null): boolean {
  if (!expectedHash) return false;
  const nettoye = code.replace(/[^0-9]/g, '');
  if (nettoye.length !== CODE_LENGTH) return false;

  const calcule = Buffer.from(hashPickupCode(nettoye, orderId));
  const attendu = Buffer.from(expectedHash);
  return calcule.length === attendu.length && timingSafeEqual(calcule, attendu);
}
