import type { Metadata } from 'next';
import { FicheProduit, metaFicheProduit } from '../../../../vues/FicheProduit';

export const revalidate = 30;

export function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return metaFicheProduit('fr', params);
}

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <FicheProduit langue="fr" params={params} />;
}
