/**
 * Vitrine publique de TOUMA.
 *
 * Elle ne remplace pas l'application : elle prend en charge les pages que des
 * inconnus et les moteurs de recherche consultent — accueil, catalogue, fiche
 * produit — et laisse tout ce qui demande un compte à l'application existante,
 * servie sur `/touma/`. Deux interfaces, deux métiers : l'une doit être lisible
 * sans JavaScript et indexable, l'autre doit être vivante et interactive.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  // Les images du catalogue viennent de l'API ou d'un stockage objet : aucune
  // optimisation distante n'est faite ici, pour ne pas ajouter un service de
  // plus entre l'acheteur et la photo du lot.
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
