import type { DescripteurPays } from './types.js';

/**
 * Marchés référencés, non configurés.
 *
 * Ils existent dans le référentiel pour une seule raison : que leur devise,
 * leur indicatif et leur fuseau soient connus le jour où quelqu'un saisit une
 * adresse ou un numéro de ce pays. Rien d'autre n'est déclaré — pas de
 * géographie, pas de commerce, pas de niveaux administratifs inventés.
 *
 * Les noms de niveaux sont absents **à dessein**. Écrire que le Kenya a des
 * « provinces » sans l'avoir vérifié produirait une donnée officielle fausse,
 * affichée à un utilisateur kényan le jour de l'ouverture.
 */
const RESTE: DescripteurPays[] = [
  { code: 'NG', name: 'Nigeria', nativeName: 'Nigeria', currency: 'NGN', dialCode: '+234', timezone: 'Africa/Lagos', status: 'PLANNED', active: false, buyingEnabled: false, sellingEnabled: false, languages: ['en'], divisionLevels: [], notes: 'Référencé pour sa devise, son indicatif et son fuseau. Non configuré.' },
  { code: 'CI', name: "Côte d'Ivoire", nativeName: "Côte d'Ivoire", currency: 'XOF', dialCode: '+225', timezone: 'Africa/Abidjan', status: 'PLANNED', active: false, buyingEnabled: false, sellingEnabled: false, languages: ['fr'], divisionLevels: [], notes: 'Référencé pour sa devise, son indicatif et son fuseau. Non configuré.' },
  { code: 'SN', name: 'Sénégal', nativeName: 'Sénégal', currency: 'XOF', dialCode: '+221', timezone: 'Africa/Dakar', status: 'PLANNED', active: false, buyingEnabled: false, sellingEnabled: false, languages: ['fr'], divisionLevels: [], notes: 'Référencé pour sa devise, son indicatif et son fuseau. Non configuré.' },
  { code: 'GH', name: 'Ghana', nativeName: 'Ghana', currency: 'GHS', dialCode: '+233', timezone: 'Africa/Accra', status: 'PLANNED', active: false, buyingEnabled: false, sellingEnabled: false, languages: ['en'], divisionLevels: [], notes: 'Référencé pour sa devise, son indicatif et son fuseau. Non configuré.' },
  { code: 'KE', name: 'Kenya', nativeName: 'Kenya', currency: 'KES', dialCode: '+254', timezone: 'Africa/Nairobi', status: 'PLANNED', active: false, buyingEnabled: false, sellingEnabled: false, languages: ['en', 'sw'], divisionLevels: [], notes: 'Référencé pour sa devise, son indicatif et son fuseau. Non configuré.' },
];

export default RESTE;
