import type { DescripteurPays } from './types.js';

/**
 * Tchad — marché pilote.
 *
 * Le seul marché où TOUMA fonctionne réellement aujourd'hui : 23 provinces
 * chargées depuis GeoNames, des boutiques, des commandes, le paiement à la
 * livraison. Ce qui lui manque pour être un marché complet — un prestataire de
 * paiement agréé, un transporteur réel — lui manque aussi, et le contrôle de
 * préparation le dit sans ménagement.
 */
const TD: DescripteurPays = {
  code: 'TD',
  name: 'Tchad',
  nativeName: 'تشاد',
  currency: 'XAF',
  dialCode: '+235',
  timezone: 'Africa/Ndjamena',
  status: 'ACTIVE',
  active: true,
  buyingEnabled: true,
  sellingEnabled: true,
  // Français et arabe, les deux langues officielles.
  languages: ['fr', 'ar'],
  divisionLevels: [
    { level: 1, name: 'Province', namePlural: 'Provinces', nameAr: 'إقليم', used: true },
    { level: 2, name: 'Département', namePlural: 'Départements', nameAr: 'دائرة', used: true },
    // Le niveau existe dans l'organisation du pays ; aucune source exploitable
    // ne le décrit, la table reste donc vide (voir docs/chad-geography-sources.md).
    { level: 3, name: 'Sous-préfecture', namePlural: 'Sous-préfectures', nameAr: 'قسم', used: true },
    { level: 4, name: 'Localité', namePlural: 'Localités', nameAr: 'بلدة', used: true },
  ],
  trade: {
    enabled: true,
    paymentMethods: ['MOBILE_MONEY', 'CASH_ON_DELIVERY'],
    // Aucun transporteur réel n'est enregistré : la liste est vide plutôt que
    // de nommer l'adaptateur de simulation, qui n'achemine aucun colis.
    shippingProviders: [],
    notes: 'Marché pilote. Paiement à la livraison opérationnel ; aucun prestataire de paiement agréé raccordé.',
  },
  notes:
    'Seul marché en exploitation. Manquent un prestataire de paiement agréé et un transporteur réel — ' +
    'le contrôle de préparation les signale comme bloquants pour une ouverture complète.',
};

export default TD;
