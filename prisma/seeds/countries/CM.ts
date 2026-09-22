import type { DescripteurPays } from './types.js';

/**
 * Cameroun — deuxième marché, en configuration (V26 §10).
 *
 * **Il était déclaré actif.** `active: true`, achat et vente ouverts, alors
 * qu'aucune division administrative n'est chargée et qu'aucun transporteur réel
 * ne le dessert. Un marché annoncé ouvert par lequel rien ne peut passer :
 * exactement le « faux pays » que §79 interdit.
 *
 * Il est donc en `CONFIGURING`, et l'achat y est fermé. La vente reste ouverte :
 * des boutiques camerounaises existent et leurs produits sont en catalogue —
 * c'est vrai, et le fermer priverait le corridor de son offre. Acheter, non :
 * accepter une commande que personne ne peut livrer n'est pas une ouverture,
 * c'est une promesse creuse.
 *
 * Le vocabulaire administratif n'est pas celui du Tchad, et c'est tout le point
 * de §7 : le Cameroun a des **régions**, pas des provinces, et des
 * **arrondissements**, pas des sous-préfectures.
 */
const CM: DescripteurPays = {
  code: 'CM',
  name: 'Cameroun',
  nativeName: 'Cameroun',
  currency: 'XAF',
  dialCode: '+237',
  timezone: 'Africa/Douala',
  status: 'CONFIGURING',
  active: true,
  buyingEnabled: false,
  sellingEnabled: true,
  languages: ['fr', 'en'],
  divisionLevels: [
    { level: 1, name: 'Région', namePlural: 'Régions', used: true },
    { level: 2, name: 'Département', namePlural: 'Départements', used: true },
    { level: 3, name: 'Arrondissement', namePlural: 'Arrondissements', used: true },
    { level: 4, name: 'Localité', namePlural: 'Localités', used: true },
  ],
  providers: [
    {
      type: 'SHIPPING',
      code: 'mock',
      name: 'Simulation de transport',
      status: 'ACTIVE',
      simulation: true,
      notes: 'Seul transporteur enregistré pour ce marché, et il ne transporte rien.',
    },
  ],
  trade: {
    enabled: true,
    paymentMethods: ['MOBILE_MONEY'],
    shippingProviders: [],
    notes: 'Marché en configuration : aucune géographie chargée, aucun transporteur réel.',
  },
  notes:
    'Aucune division administrative chargée — les 10 régions du Cameroun demandent une source vérifiable, ' +
    'et les inscrire de mémoire produirait une donnée officielle inventée. Achat fermé tant qu’aucun ' +
    'transporteur ne dessert le pays.',
};

export default CM;
