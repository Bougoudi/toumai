/**
 * Détection de risque dans les messages commerciaux.
 *
 * Principe : **on signale, on ne supprime pas**. Un message qui parle de
 * WhatsApp n'est pas une fraude — dans le commerce d'Afrique centrale, WhatsApp
 * est un outil de travail quotidien. Ce qui mérite un signal, c'est
 * l'invitation à *payer en dehors* de TOUMA, là où l'acheteur perd toute
 * protection.
 *
 * Le score n'a aucun pouvoir automatique : il n'interdit rien, il n'abaisse
 * aucune réputation. Il porte un avertissement à l'acheteur et remonte à
 * l'administration, qui tranche.
 */

export type RiskCategory = 'OFF_PLATFORM_PAYMENT' | 'CONTACT_EXCHANGE' | 'SUSPICIOUS_LINK' | 'REPEATED_CONTENT' | 'FLOOD';

export interface RiskSignal {
  category: RiskCategory;
  score: number;
  /** Extrait déclencheur, borné : le message entier n'est jamais recopié. */
  excerpt: string;
}

/** Retire les accents et la casse pour que « payé » et « paye » se valent. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Formulations qui désignent un paiement hors plateforme. Chacune doit
 * exprimer un **mouvement d'argent hors TOUMA** ; un simple nom d'application
 * de messagerie ne suffit jamais.
 */
const OFF_PLATFORM_PATTERNS: Array<{ re: RegExp; score: number }> = [
  // Le séparateur peut être une espace ou un trait d'union : « payez-moi ».
  { re: /\bpay(?:ez|er|e|ment)?[\s-]+(?:moi[\s-]+)?(?:en[\s-]+)?direct(?:ement)?\b/, score: 70 },
  { re: /\bpay\s+me\s+direct(?:ly)?\b/, score: 70 },
  { re: /\b(?:en|hors)\s+dehors\s+(?:de\s+)?(?:la\s+)?(?:plateforme|touma|site)\b/, score: 75 },
  { re: /\boutside\s+(?:the\s+)?(?:platform|site|app)\b/, score: 75 },
  { re: /\benvoy(?:ez|er)[\s-]+(?:moi[\s-]+)?(?:l['’]?\s*argent|les?\s+fonds?)\b/, score: 65 },
  { re: /\bsend\s+(?:the\s+)?money\b/, score: 65 },
  { re: /\b(?:virement|transfert)\s+(?:direct|personnel|prive)\b/, score: 60 },
  { re: /\b(?:mobile\s*money|orange\s*money|mtn\s*money|wave|western\s*union|moneygram)\b/, score: 45 },
  { re: /\b(?:sans|eviter|contourner)\s+(?:passer\s+par\s+)?(?:la\s+)?commission\b/, score: 70 },
  { re: /\bcash\s+(?:only|uniquement|a\s+la\s+main)\b/, score: 50 },
];

/** Échange de coordonnées : informatif, faible score, jamais bloquant. */
const CONTACT_PATTERNS: Array<{ re: RegExp; score: number }> = [
  { re: /\b(?:whatsapp|telegram|signal|viber|wechat)\b/, score: 20 },
  // Numéro international ou local d'au moins 8 chiffres, espaces et tirets tolérés.
  { re: /(?:\+\d{1,3}[\s.-]?)?(?:\d[\s.-]?){8,14}\d/, score: 25 },
  { re: /[\w.+-]+@[\w-]+\.[a-z]{2,}/, score: 25 },
];

/** Domaines de raccourcisseurs : une URL masquée mérite qu'on la regarde. */
const SHORTENERS = /\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|is\.gd|rb\.gy|shorturl\.at)\b/;

const EXCERPT_MAX = 120;

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  const slice = text.slice(start, end).trim();
  return slice.length > EXCERPT_MAX ? `${slice.slice(0, EXCERPT_MAX)}…` : slice;
}

/**
 * Analyse un texte. Renvoie au plus un signal par catégorie, le plus fort.
 * Fonction pure : testable sans base de données.
 */
export function scanText(text: string): RiskSignal[] {
  const normalized = normalize(text);
  const signals = new Map<RiskCategory, RiskSignal>();

  const record = (category: RiskCategory, score: number, excerpt: string) => {
    const existing = signals.get(category);
    if (!existing || existing.score < score) signals.set(category, { category, score, excerpt });
  };

  for (const { re, score } of OFF_PLATFORM_PATTERNS) {
    const match = re.exec(normalized);
    if (match) record('OFF_PLATFORM_PAYMENT', score, excerptAround(text, match.index, match[0].length));
  }

  for (const { re, score } of CONTACT_PATTERNS) {
    const match = re.exec(normalized);
    if (match) record('CONTACT_EXCHANGE', score, excerptAround(text, match.index, match[0].length));
  }

  const shortener = SHORTENERS.exec(normalized);
  if (shortener) record('SUSPICIOUS_LINK', 40, excerptAround(text, shortener.index, shortener[0].length));

  return [...signals.values()].sort((a, b) => b.score - a.score);
}

/**
 * Seuil au-delà duquel l'expéditeur **et** le destinataire voient un rappel de
 * sécurité. En dessous, le signal est enregistré sans rien afficher : on
 * n'accuse pas un commerçant parce qu'il a écrit un numéro de téléphone.
 */
export const WARNING_THRESHOLD = 60;

/** Message d'avertissement affiché dans le fil, non bloquant. */
export const SAFETY_NOTICE =
  'Pour votre sécurité, réglez vos commandes via TOUMA : un paiement effectué en dehors de la plateforme ne bénéficie d’aucune protection en cas de litige.';

/** Le signal le plus fort mérite-t-il un avertissement visible ? */
export function needsWarning(signals: RiskSignal[]): boolean {
  return signals.some((s) => s.category === 'OFF_PLATFORM_PAYMENT' && s.score >= WARNING_THRESHOLD);
}
