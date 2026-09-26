import type { Metadata } from 'next';
import { SITE_URL } from '../../lib/api';
import { LOCALE_OG, t } from '../../lib/i18n';
import { Ossature } from '../../vues/Ossature';
import '../globals.css';

/**
 * Disposition racine arabe.
 *
 * Next.js ne laisse pas une disposition imbriquée redéfinir `<html>` : le
 * français et l'arabe ont donc chacun la leur, dans leur propre groupe de
 * routes. C'est ce qui permet de servir `lang="ar" dir="rtl"` dès la
 * première ligne du document — un attribut posé après coup par un script
 * arriverait trop tard pour le navigateur comme pour un lecteur d'écran.
 */
export const metadata: Metadata = {
  // Sans base, Next.js ne peut pas résoudre les URL canoniques ni celles
  // d'OpenGraph, et les émet relatives — ce qu'aucun moteur ne sait recoller.
  metadataBase: new URL(SITE_URL),
  title: { default: t('ar', 'site.titre'), template: t('ar', 'site.gabaritTitre') },
  description: t('ar', 'site.description'),
  applicationName: 'TOUMA',
  openGraph: { type: 'website', siteName: 'TOUMA', locale: LOCALE_OG['ar'] },
};

export default function Disposition({ children }: { children: React.ReactNode }) {
  return <Ossature langue="ar">{children}</Ossature>;
}
