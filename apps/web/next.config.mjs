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
/**
 * En-têtes de sécurité de la vitrine (V25 §39, §64).
 *
 * L'API en émettait un jeu complet via Helmet ; la vitrine, **aucun**. C'est
 * pourtant elle qui rend du contenu saisi par des vendeurs — titres,
 * descriptions, noms de boutique — et des adresses posées par des
 * administrateurs. Sans politique de sécurité de contenu, un script qui
 * parviendrait à s'y glisser s'exécuterait sans rien pour l'arrêter.
 *
 * La politique est plus permissive que celle de l'API sur un point : Next.js
 * injecte ses données d'hydratation dans des balises `<script>` en ligne, ce
 * qui impose `'unsafe-inline'` pour les scripts. C'est une limite réelle du
 * cadre, écrite ici plutôt que masquée — et elle n'annule pas le reste :
 * `default-src 'self'` ferme toujours les sources externes, `object-src
 * 'none'` les greffons, `frame-ancestors 'none'` l'encadrement.
 *
 * `img-src` accepte `https:` parce que les images de produit sont des
 * adresses externes fournies par les vendeurs. C'est un choix de conception
 * assumé, dont la contrepartie est qu'un vendeur voit l'adresse IP des
 * visiteurs qui chargent son image — d'où `referrer-policy: no-referrer`, qui
 * lui retire au moins la page consultée.
 */
const enTetesSecurite = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Aucune de ces interfaces n'a besoin de la caméra, du micro ni de la position.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  {
    // `preload` est volontairement absent : l'inscription sur la liste de
    // préchargement des navigateurs se défait très difficilement, et c'est un
    // engagement à prendre en connaissance de cause, pas par défaut.
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: enTetesSecurite }];
  },
  // Les images du catalogue viennent de l'API ou d'un stockage objet : aucune
  // optimisation distante n'est faite ici, pour ne pas ajouter un service de
  // plus entre l'acheteur et la photo du lot.
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
