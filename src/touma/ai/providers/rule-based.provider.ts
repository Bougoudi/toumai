import {
  NO_CAPABILITIES,
  ProviderUnsupported,
  type AiCapabilities,
  type AiProvider,
  type AiSegment,
  type ClassifyTextRequest,
  type ClassifyTextResult,
  type EmbedRequest,
  type EmbedResult,
  type GenerateTextRequest,
  type GenerateTextResult,
  type ModerateRequest,
  type ModerateResult,
  type StructuredRequest,
  type StructuredResult,
} from '../ai.types.js';

/**
 * Fournisseur **déterministe**, sans appel réseau, sans clé, sans coût.
 *
 * Il s'appelait `mock`. Le nom était faux : il ne simule rien. Il calcule sur
 * des règles explicites, et ses résultats sont exacts — simplement plus pauvres
 * qu'un modèle de langage. Un nom qui laisse croire à de la donnée fictive sur
 * une brique qui produit de la donnée réelle est un mensonge dans l'autre sens,
 * et il coûte autant.
 *
 * C'est le **repli obligatoire** (§47) : tant qu'aucun fournisseur réel n'est
 * configuré, c'est lui qui répond, et l'application entière continue de
 * fonctionner. Il ne produit jamais un fait qu'il n'a pas reçu.
 */
export class RuleBasedProvider implements AiProvider {
  readonly code = 'RULE_BASED';
  readonly name = 'Touma — règles locales';
  readonly configured = true;
  readonly defaultModel = 'touma-rules-v1';

  /**
   * Pas d'embedding, et c'est délibéré.
   *
   * Un vecteur produit par hachage local passerait le typage et porterait le
   * nom « sémantique » sans l'être : deux formulations d'une même intention en
   * sortiraient éloignées. La recherche se replie alors sur PostgreSQL (§32),
   * qui est moins fin mais dit la vérité sur ce qu'il fait.
   */
  readonly capabilities: AiCapabilities = {
    ...NO_CAPABILITIES,
    generateText: true,
    generateStructuredOutput: true,
    moderate: true,
    classify: true,
  };

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const faits = collectFacts(request.segments);
    const max = request.maxWords ?? 120;
    const phrases = composer(request, faits);
    const text = phrases.join(' ').split(/\s+/).slice(0, max).join(' ');
    return { text, provider: this.code, model: this.defaultModel, ...noTokens() };
  }

  /**
   * Sortie structurée par analyse déterministe.
   *
   * Le seul schéma que ce fournisseur sait remplir est l'intention d'achat —
   * budget, devise, catégorie, destination. Il l'extrait de la phrase par des
   * règles lisibles. Pour tout autre schéma il refuse, plutôt que de rendre un
   * objet vide que l'appelant prendrait pour une analyse.
   */
  async generateStructuredOutput(request: StructuredRequest): Promise<StructuredResult> {
    if (request.schemaName !== 'shopping_intent') {
      throw new ProviderUnsupported(this.code, `produire « ${request.schemaName} » sans modèle de langage`);
    }
    const phrase = request.segments
      .filter((s) => s.origin === 'USER')
      .map((s) => s.content)
      .join(' ');
    return { raw: parseShoppingIntent(phrase), provider: this.code, model: this.defaultModel, ...noTokens() };
  }

  async embed(_request: EmbedRequest): Promise<EmbedResult> {
    throw new ProviderUnsupported(this.code, 'produire des vecteurs sémantiques');
  }

  /** Modération par lexique explicite : on peut lire pourquoi un texte est signalé. */
  async moderate(request: ModerateRequest): Promise<ModerateResult> {
    const mots = tokens(request.text);
    const categories = new Set<string>();
    for (const [categorie, lexique] of Object.entries(LEXIQUE_MODERATION)) {
      if (lexique.some((terme) => mots.has(terme))) categories.add(categorie);
    }
    // Les coordonnées hors plateforme sont le signal de fraude le plus courant
    // sur une place de marché : le vendeur propose de traiter « en direct »,
    // et l'acheteur perd toute protection.
    if (/\b(?:whatsapp|telegram)\b/i.test(request.text)) categories.add('HORS_PLATEFORME');
    const liste = [...categories];
    return {
      flagged: liste.length > 0,
      categories: liste,
      score: Math.min(1, liste.length / 3),
      provider: this.code,
      model: this.defaultModel,
    };
  }

  /** Classement par recouvrement de mots. Transparent, donc contestable. */
  async classify(request: ClassifyTextRequest): Promise<ClassifyTextResult> {
    const mots = tokens(request.text);
    let best = { label: request.labels[0] ?? '', score: 0 };
    for (const label of request.labels) {
      const termes = [...tokens(label)];
      if (termes.length === 0) continue;
      const touches = termes.filter((t) => mots.has(t)).length;
      const score = touches / termes.length;
      if (score > best.score) best = { label, score };
    }
    return {
      ...best,
      // Aucun recouvrement : le premier libellé n'est pas une réponse, c'est un
      // défaut de liste. Le dire évite qu'un appelant range un produit dans la
      // première catégorie venue.
      uncertain: best.score === 0,
      provider: this.code,
      model: this.defaultModel,
    };
  }
}

/** Un fournisseur local ne consomme ni jeton ni budget, et l'inscrit tel quel. */
function noTokens() {
  return { inputTokens: 0, outputTokens: 0 };
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
}

const LEXIQUE_MODERATION: Record<string, string[]> = {
  CONTREFACON: ['contrefacon', 'replique', 'copie', 'faux'],
  ARME: ['arme', 'munition', 'pistolet', 'fusil'],
  MEDICAMENT: ['medicament', 'ordonnance', 'antibiotique'],
  ESPECE_PROTEGEE: ['ivoire', 'pangolin', 'corne'],
};

/**
 * Faits **reçus**, par opposition aux faits inventés.
 *
 * Le générateur ne connaît du produit que ce que l'appelant lui a passé en
 * contexte. Tout le reste — matière, garantie, certification, norme — n'existe
 * pas pour lui, et c'est exactement ce que §14 exige.
 */
function collectFacts(segments: AiSegment[]): Map<string, string> {
  const faits = new Map<string, string>();
  for (const segment of segments) {
    if (segment.origin !== 'SYSTEM' && segment.origin !== 'TOOL_POLICY') continue;
    for (const ligne of segment.content.split('\n')) {
      const m = /^([a-zA-Zé_]+)\s*:\s*(.+)$/.exec(ligne.trim());
      if (m && m[2].trim()) faits.set(m[1].toLowerCase(), m[2].trim());
    }
  }
  return faits;
}

function composer(request: GenerateTextRequest, faits: Map<string, string>): string[] {
  const titre = faits.get('titre') ?? request.segments.find((s) => s.origin === 'USER')?.content?.trim() ?? '';
  const categorie = faits.get('categorie');
  const pays = faits.get('pays');
  const marque = faits.get('marque');

  if (request.feature === 'product_title') {
    const mots = titre.split(/\s+/).filter(Boolean).slice(0, 10);
    if (marque && !titre.toLowerCase().includes(marque.toLowerCase())) mots.unshift(marque);
    if (categorie && !titre.toLowerCase().includes(categorie.toLowerCase())) mots.push(`— ${categorie}`);
    return [mots.join(' ').slice(0, 120)];
  }

  const phrases = [titre ? `${titre}.` : ''];
  if (marque) phrases.push(`Marque : ${marque}.`);
  if (categorie) phrases.push(`Catégorie : ${categorie}.`);
  if (pays) phrases.push(`Expédié depuis : ${pays}.`);
  // Ce qui manque est nommé comme manquant, jamais comblé. Un vendeur qui lit
  // « matière : coton » qu'il n'a pas saisie publiera une fiche fausse en son
  // nom, et c'est lui qui en répondra.
  phrases.push('À compléter par le vendeur : matière, dimensions, conditionnement, délai de préparation.');
  return phrases.filter(Boolean);
}

/** Devises reconnues dans une phrase d'achat, avec leurs écritures courantes. */
const DEVISES: Array<[RegExp, string]> = [
  [/\b(?:xaf|fcfa|f\s?cfa|cfa|francs?)\b/i, 'XAF'],
  [/\b(?:eur|euros?|€)\b/i, 'EUR'],
  [/\b(?:usd|dollars?|\$)\b/i, 'USD'],
];

/**
 * Intention d'achat extraite d'une phrase.
 *
 * Volontairement conservateur : ce qui n'est pas reconnu reste `null`, et un
 * `null` veut dire « non exprimé », pas « sans limite ». C'est la différence
 * entre filtrer sur un budget que l'acheteur a donné et filtrer sur un budget
 * qu'on lui a prêté.
 */
export function parseShoppingIntent(phrase: string): {
  terms: string;
  maxPrice: string | null;
  minPrice: string | null;
  currency: string | null;
  destination: string | null;
  verifiedOnly: boolean;
  inStockOnly: boolean;
} {
  const brut = phrase.trim();
  const sansAccents = brut.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  let currency: string | null = null;
  for (const [motif, code] of DEVISES) if (motif.test(brut)) currency = code;

  // « 100 000 », « 100.000 », « 100000 » — les trois s'écrivent au Tchad.
  const nombre = '(\\d[\\d\\s.\\u202f\\u00a0]*\\d|\\d+)';
  const montant = (m: RegExpExecArray | null) => (m ? m[1].replace(/[\s.  ]/g, '') : null);

  const max = montant(new RegExp(`(?:moins de|sous|max(?:imum)?|jusqu'?a|inferieur a|budget de)\\s*${nombre}`, 'i').exec(sansAccents));
  const min = montant(new RegExp(`(?:plus de|au moins|min(?:imum)?|a partir de|superieur a)\\s*${nombre}`, 'i').exec(sansAccents));

  // La destination n'est pas résolue ici : ce fournisseur ne connaît pas la
  // géographie. Il isole la mention, et c'est `geoService` qui dira si elle
  // correspond à une province réelle — ou si elle n'existe pas.
  const dest = /(?:livr[ée]e?\s+(?:a|au|dans|vers)|destination|jusqu'?a)\s+([a-z'’\- ]{3,40})/i.exec(sansAccents);

  // Les mots de budget ne sont pas des mots de recherche : chercher « moins »
  // dans le catalogue ne rend rien.
  const termesBruts = brut
    .replace(new RegExp(`(?:moins de|sous|max(?:imum)?|jusqu'?[àa]|budget de|plus de|au moins|[àa] partir de)\\s*${nombre}`, 'gi'), ' ')
    .replace(/\b(?:xaf|fcfa|f\s?cfa|cfa|francs?|eur|euros?|usd|dollars?)\b/gi, ' ')
    .replace(/(?:livr[ée]e?\s+(?:à|a|au|dans|vers)|destination)\s+[a-zà-ÿ'’\- ]{3,40}/gi, ' ')
    .replace(/\b(?:je cherche|je veux|trouve[- ]moi|montre[- ]moi|il me faut)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const terms = elaguerMotsVides(termesBruts);

  return {
    terms,
    maxPrice: max,
    minPrice: min,
    currency,
    destination: dest ? dest[1].trim().replace(/\s+/g, ' ') : null,
    verifiedOnly: /\bverifi/i.test(sansAccents),
    inStockOnly: /\b(?:en stock|disponible|dispo)\b/i.test(sansAccents),
  };
}

/**
 * Mots vides français, retirés **uniquement aux extrémités**.
 *
 * « Je cherche un téléphone à moins de 100 000 XAF » laissait « un téléphone à »
 * une fois le budget extrait. La recherche catalogue compare cette chaîne par
 * inclusion : « un téléphone à » ne figure dans aucun titre, et la formulation
 * française la plus courante ne rendait rien.
 *
 * Aux extrémités seulement, et c'est le point délicat : retirer les mots vides
 * partout casserait « sac de voyage », dont le « de » fait partie du nom. Un
 * article en tête et une préposition orpheline en queue ne portent aucun sens ;
 * une préposition au milieu, si.
 */
const MOTS_VIDES = new Set([
  'je', 'j', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'un', 'une', 'des', 'du',
  'de', 'le', 'la', 'les', 'l', 'a', 'à', 'au', 'aux', 'pour', 'avec', 'en',
  'et', 'ou', 'moi', 'me', 'mon', 'ma', 'mes', 'ce', 'cet', 'cette', 'que',
  'qui', 'plaît', 'plait', 'stp', 'svp', 'bonjour', 'salut', 'merci',
]);

export function elaguerMotsVides(phrase: string): string {
  const mots = phrase.split(/\s+/).filter(Boolean);
  // La ponctuation est retirée avant comparaison : « Bonjour, » est le même
  // mot vide que « bonjour », et le laisser tel quel bloquait l'élagage de
  // tout ce qui le suivait.
  const vide = (m: string) =>
    MOTS_VIDES.has(
      m
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['\u2019]/g, '')
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''),
    );
  let debut = 0;
  let fin = mots.length;
  while (debut < fin && vide(mots[debut])) debut += 1;
  while (fin > debut && vide(mots[fin - 1])) fin -= 1;
  return mots.slice(debut, fin).join(' ');
}
