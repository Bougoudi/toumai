import type { Metadata } from 'next';
import { Corridor, metaCorridor } from '../../../../vues/Corridor';

export const revalidate = 60;

export function generateMetadata({ params }: { params: Promise<{ corridor: string }> }): Promise<Metadata> {
  return metaCorridor('fr', params);
}

export default function Page({ params }: { params: Promise<{ corridor: string }> }) {
  return <Corridor langue="fr" params={params} />;
}
