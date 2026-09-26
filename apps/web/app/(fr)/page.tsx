import type { Metadata } from 'next';
import { Accueil, metaAccueil } from '../../vues/Accueil';

export const revalidate = 30;
export const metadata: Metadata = metaAccueil('fr');

export default function Page() {
  return <Accueil langue="fr" />;
}
