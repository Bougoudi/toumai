import { redact } from '../lib/redact.js';

/**
 * Minimisation des données avant envoi à un fournisseur d'IA (§9).
 *
 * `lib/redact.ts` traite les **secrets** — carte, jeton, clé. Ce fichier traite
 * autre chose : les données personnelles qui ne sont pas des secrets mais qui
 * n'ont aucune raison de sortir de Touma. Le numéro de téléphone d'un acheteur
 * n'est pas un secret : c'est une donnée qui identifie une personne, et
 * l'envoyer à un tiers pour qu'il rédige une fiche produit n'a aucune
 * justification.
 *
 * La règle est celle du besoin : ce dont le modèle n'a pas besoin ne part pas.
 * Elle est appliquée ici, une fois, sur le chemin obligatoire — pas laissée à
 * la vigilance de chaque appelant.
 */

const MASQUE = '[masqué]';

/** Champs qui ne quittent jamais Touma, même vers un fournisseur sous contrat. */
const CHAMPS_INTERDITS = new Set([
  'email',
  'phone',
  'telephone',
  'phonenumber',
  'address',
  'adresse',
  'addressline1',
  'addressline2',
  'street',
  'rue',
  'recipientname',
  'nomdestinataire',
  'nationalid',
  'passport',
  'passeport',
  'idnumber',
  'taxid',
  'nif',
  'rccm',
  'bankaccount',
  'iban',
  'kyc',
  'documenturl',
  'birthdate',
  'datenaissance',
]);

function normalise(cle: string): string {
  return cle.toLowerCase().replace(/[-_\s]/g, '');
}

/**
 * Masque dans un texte libre ce qui identifie une personne.
 *
 * Adresses de courriel et numéros de téléphone traversent les descriptions et
 * les messages : un vendeur écrit son numéro dans sa fiche, un acheteur colle
 * le sien dans une question. Les masquer sert deux fins à la fois —
 * la minimisation, et le refus de la mise en relation hors plateforme, qui est
 * le vecteur de fraude le plus courant sur une place de marché.
 */
export function maskPersonalData(texte: string): string {
  return texte
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, MASQUE)
    // Numéros internationaux et locaux (Tchad : 8 chiffres, Cameroun : 9).
    .replace(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}/g, (m) => {
      const chiffres = m.replace(/\D/g, '');
      return chiffres.length >= 8 && chiffres.length <= 15 ? MASQUE : m;
    });
}

/**
 * Copie minimisée d'un objet destiné à un fournisseur externe.
 *
 * Deux passes successives : `redact` retire les secrets, puis les champs
 * personnels sont retirés par nom et les chaînes restantes par forme. L'ordre
 * compte peu ; le fait que les deux passent, beaucoup.
 */
export function minimizeForProvider<T>(valeur: T, profondeurMax = 8): unknown {
  return parcourir(redact(valeur, profondeurMax), profondeurMax);
}

function parcourir(valeur: unknown, profondeur: number): unknown {
  if (valeur === null || valeur === undefined) return valeur;
  if (profondeur <= 0) return MASQUE;
  if (typeof valeur === 'string') return maskPersonalData(valeur);
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return valeur;
  if (Array.isArray(valeur)) return valeur.map((v) => parcourir(v, profondeur - 1));
  if (typeof valeur === 'object') {
    const sortie: Record<string, unknown> = {};
    for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
      sortie[cle] = CHAMPS_INTERDITS.has(normalise(cle)) ? MASQUE : parcourir(v, profondeur - 1);
    }
    return sortie;
  }
  return MASQUE;
}
