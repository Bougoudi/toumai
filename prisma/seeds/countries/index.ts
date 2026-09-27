import type { PrismaClient } from '@prisma/client';
import type { DescripteurPays } from './types.js';
import TD from './TD.js';
import CM from './CM.js';
import RESTE from './reste.js';

/**
 * Chargement des marchés (V26 §9, §55).
 *
 * Les descripteurs sont déclaratifs et vérifiés avant écriture : un code pays
 * mal formé, un fuseau resté à `UTC`, deux niveaux administratifs au même rang
 * ou une langue par défaut absente de la liste arrêtent le seed. Un jeu de
 * données géographiques faux est plus coûteux à découvrir en exploitation qu'à
 * refuser ici.
 */
export const PAYS: DescripteurPays[] = [TD, CM, ...RESTE];

/** Vérifie un descripteur. Retourne les erreurs, vide si tout va bien (§55). */
export function valider(p: DescripteurPays): string[] {
  const erreurs: string[] = [];
  if (!/^[A-Z]{2}$/.test(p.code)) erreurs.push(`code « ${p.code} » : deux majuscules attendues (ISO-3166-1 alpha-2)`);
  if (!/^[A-Z]{3}$/.test(p.currency)) erreurs.push(`devise « ${p.currency} » : trois majuscules attendues (ISO-4217)`);
  if (!/^\+\d{1,4}$/.test(p.dialCode)) erreurs.push(`indicatif « ${p.dialCode} » : « + » suivi de 1 à 4 chiffres attendu`);
  // Un pays réel n'est pas à UTC : afficher une date de livraison dans le fuseau
  // du serveur est faux pour celui qui attend le colis.
  if (!p.timezone || p.timezone === 'UTC') erreurs.push('fuseau horaire absent ou laissé à UTC');
  if (p.languages.length === 0) erreurs.push('aucune langue déclarée');

  const niveaux = p.divisionLevels.map((n) => n.level);
  if (new Set(niveaux).size !== niveaux.length) erreurs.push('deux niveaux administratifs portent le même rang');
  for (const n of p.divisionLevels) {
    if (n.level < 1 || n.level > 4) erreurs.push(`niveau ${n.level} hors de 1–4`);
    if (!n.name.trim() || !n.namePlural.trim()) erreurs.push(`niveau ${n.level} : nom manquant`);
  }

  // Un marché ouvert sans commerce déclaré serait ouvert sur rien.
  if ((p.status === 'ACTIVE' || p.status === 'PILOT') && !p.trade?.enabled) {
    erreurs.push(`statut « ${p.status} » sans configuration commerciale`);
  }
  return erreurs;
}

/** Écrit un marché et ses niveaux administratifs. */
export async function chargerPays(prisma: PrismaClient, p: DescripteurPays): Promise<void> {
  const erreurs = valider(p);
  if (erreurs.length > 0) throw new Error(`Descripteur ${p.code} invalide : ${erreurs.join(' ; ')}`);

  const identite = {
    name: p.name,
    nativeName: p.nativeName ?? null,
    currency: p.currency,
    dialCode: p.dialCode,
    timezone: p.timezone,
    status: p.status,
    active: p.active,
    buyingEnabled: p.buyingEnabled,
    sellingEnabled: p.sellingEnabled,
  };
  await prisma.country.upsert({ where: { code: p.code }, update: identite, create: { code: p.code, ...identite } });

  for (const n of p.divisionLevels) {
    const valeurs = { name: n.name, namePlural: n.namePlural, nameAr: n.nameAr ?? null, used: n.used };
    await prisma.toumaCountryDivisionLevel.upsert({
      where: { countryCode_level: { countryCode: p.code, level: n.level } },
      update: valeurs,
      create: { countryCode: p.code, level: n.level, ...valeurs },
    });
  }

  for (const provider of p.providers ?? []) {
    const valeurs = {
      name: provider.name,
      status: provider.status,
      priority: provider.priority ?? 100,
      simulation: provider.simulation ?? false,
      supportedMethods: provider.supportedMethods ?? [],
      notes: provider.notes ?? null,
    };
    await prisma.toumaCountryProvider.upsert({
      where: { countryCode_type_code: { countryCode: p.code, type: provider.type, code: provider.code } },
      update: valeurs,
      create: { countryCode: p.code, type: provider.type, code: provider.code, ...valeurs },
    });
  }

  if (p.trade) {
    const commerce = {
      tradeEnabled: p.trade.enabled,
      languages: p.languages,
      currencies: [p.currency, ...(p.extraCurrencies ?? [])],
      paymentMethods: p.trade.paymentMethods,
      shippingProviders: p.trade.shippingProviders,
      notes: p.trade.notes ?? null,
    };
    await prisma.toumaTradeCountryConfig.upsert({
      where: { countryCode: p.code },
      update: commerce,
      create: { countryCode: p.code, ...commerce },
    });
  }
}
