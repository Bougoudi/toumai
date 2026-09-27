import type { Metadata } from 'next';
import { Catalogue, metaCatalogue } from '../../../../vues/Catalogue';

export const revalidate = 30;
export const metadata: Metadata = metaCatalogue('ar');

export default function Page({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; country?: string }> }) {
  return <Catalogue langue="ar" searchParams={searchParams} />;
}
