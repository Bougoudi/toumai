/**
 * Rédaction des données sensibles avant journalisation ou mise en base.
 *
 * Le cahier des charges V20 §21 l'impose : **ne jamais logger** un numéro de
 * carte, un CVV, un code secret mobile money, un secret de prestataire ni un
 * jeton d'accès. Cette contrainte ne tient pas par la discipline de celui qui
 * écrit le code : elle tient parce qu'un seul passage obligatoire l'applique.
 *
 * Deux niveaux, parce qu'une seule passe ne suffit pas :
 *
 * 1. **Par nom de champ** — un objet est parcouru et toute clé qui ressemble à
 *    un secret voit sa valeur remplacée. C'est le cas courant.
 * 2. **Par forme** — un numéro de carte ou un jeton porteur reste reconnaissable
 *    même dans une chaîne libre, sous une clé anodine. Un corps de webhook
 *    arrive d'un tiers : personne ne garantit qu'il nomme ses champs
 *    raisonnablement.
 *
 * La règle en cas de doute est de masquer. Un journal amputé d'une valeur
 * anodine est un désagrément ; un secret recopié en base est une fuite.
 */

/** Remplacement : la clé reste visible, la valeur disparaît. */
export const REDACTED = '[rédigé]';

/**
 * Fragments qui, présents dans un nom de champ, suffisent à masquer sa valeur.
 * Comparaison insensible à la casse, aux tirets et aux soulignés, pour couvrir
 * `card_number`, `cardNumber` et `CARD-NUMBER` d'un seul fragment.
 */
const SENSITIVE_FRAGMENTS = [
  'password',
  'motdepasse',
  'secret',
  'token',
  'authorization',
  'apikey',
  'accesskey',
  'privatekey',
  'signature',
  'cvv',
  'cvc',
  'cryptogramme',
  'pin',
  'cardnumber',
  'pan',
  'iban',
  'otp',
  'session',
  'cookie',
];

/** Champs autorisés malgré un fragment sensible : ils ne portent aucun secret. */
const ALLOWED = new Set(['pinned', 'pincode_length', 'tokencount', 'panier', 'panierid', 'sessioncount']);

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

/** Ce nom de champ désigne-t-il une valeur qu'on ne conserve jamais ? */
export function isSensitiveKey(key: string): boolean {
  const k = normaliseKey(key);
  if (ALLOWED.has(k)) return false;
  return SENSITIVE_FRAGMENTS.some((fragment) => k.includes(fragment));
}

/**
 * Masque dans une chaîne libre ce qui *ressemble* à un secret, quel que soit le
 * champ qui le porte.
 *
 * Volontairement conservateur : seules des formes peu ambiguës sont visées.
 * Masquer tout nombre long transformerait un journal en purée illisible, et un
 * journal illisible n'est plus consulté.
 */
export function redactPatterns(text: string): string {
  return (
    text
      // Numéro de carte : 13 à 19 chiffres, éventuellement groupés par espaces
      // ou tirets. Le test de Luhn évite de masquer un numéro de commande.
      .replace(/\b(?:\d[ -]?){12,18}\d\b/g, (match) => (luhn(match) ? REDACTED : match))
      // Jeton porteur dans une chaîne d'en-tête recopiée.
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer ${REDACTED}`)
      // JWT : trois segments base64url séparés par des points.
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
      // Clés de prestataires, dans les formes répandues (sk_live_…, whsec_…).
      .replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/gi, REDACTED)
      .replace(/\bwhsec_[A-Za-z0-9]{8,}\b/gi, REDACTED)
  );
}

/** Algorithme de Luhn : distingue un numéro de carte d'une suite de chiffres. */
function luhn(candidate: string): boolean {
  const digits = candidate.replace(/[^\d]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Copie rédigée d'une valeur quelconque : objets et tableaux sont parcourus en
 * profondeur, les chaînes passent par la détection de formes.
 *
 * `maxDepth` borne la récursion — un corps reçu d'un tiers peut être
 * arbitrairement imbriqué, et une pile qui déborde sur un webhook hostile
 * serait un déni de service offert.
 */
export function redact<T>(value: T, maxDepth = 8): unknown {
  return walk(value, maxDepth);
}

function walk(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (depth <= 0) return REDACTED;

  if (typeof value === 'string') return redactPatterns(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.map((item) => walk(item, depth - 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : walk(item, depth - 1);
    }
    return out;
  }

  // Fonction, symbole, BigInt : rien de tout cela n'a sa place dans un journal.
  return REDACTED;
}

/**
 * Extrait rédigé et **borné** d'un corps brut.
 *
 * Trois précautions dans une seule fonction, parce qu'elles vont ensemble sur
 * un point d'entrée public : la taille est bornée (personne ne remplit la base
 * en postant un corps de 512 ko), le JSON valide est rédigé champ par champ, et
 * ce qui n'est pas du JSON est tout de même rédigé par forme plutôt que
 * conservé tel quel.
 */
export function redactedExcerpt(raw: Buffer | string, maxChars = 2000): string {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  let rendered: string;
  try {
    rendered = JSON.stringify(redact(JSON.parse(text)));
  } catch {
    // Corps illisible : c'est justement le cas intéressant à conserver.
    rendered = redactPatterns(text);
  }
  return rendered.length > maxChars ? `${rendered.slice(0, maxChars)}…[tronqué]` : rendered;
}
