import type { Metadata } from 'next';
import { Corridors, metaCorridors } from '../../../vues/Corridors';

export const revalidate = 60;
export const metadata: Metadata = metaCorridors('fr');

export default function Page() {
  return <Corridors langue="fr" />;
}
