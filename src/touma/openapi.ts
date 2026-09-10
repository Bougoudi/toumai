import { env } from '../config/env.js';

/**
 * Document OpenAPI 3.1 de l'API Touma v1, servi sur `/api/v1/openapi.json`.
 * Écrit à la main et volontairement synthétique : il décrit les points d'entrée
 * réellement implémentés, jamais des routes imaginaires.
 */
const json = { 'application/json': { schema: { type: 'object' } } } as const;

function op(tag: string, summary: string, options: { auth?: boolean; role?: string; body?: boolean; params?: string[]; query?: string[] } = {}) {
  return {
    tags: [tag],
    summary: options.role ? `${summary} (rôle ${options.role})` : summary,
    security: options.auth === false ? [] : [{ bearerAuth: [] }],
    parameters: [
      ...(options.params ?? []).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
      ...(options.query ?? []).map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } })),
    ],
    ...(options.body ? { requestBody: { required: true, content: json } } : {}),
    responses: {
      200: { description: 'Succès', content: json },
      400: { description: 'Requête invalide' },
      401: { description: 'Authentification requise' },
      403: { description: 'Action non autorisée' },
      404: { description: 'Ressource introuvable' },
      409: { description: 'Conflit (stock, doublon, état incompatible)' },
    },
  };
}

export function toumaOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Touma API',
      version: '1.0.0',
      summary: 'Connecter le commerce africain.',
      description:
        "API de la place de marché Touma : catalogue, panier, commandes, Touma Pay (paiements), Touma Logistics (transport), Touma Verified (confiance), Touma AI. Corridor pilote Tchad ↔ Cameroun ; les pays vivent en base et s'ajoutent sans modifier le code.",
    },
    servers: [{ url: `${env.publicUrl}/api/v1` }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
    tags: [
      { name: 'Auth', description: 'Inscription, connexion, rotation des jetons' },
      { name: 'Catalogue', description: 'Pays, catégories, boutiques, produits' },
      { name: 'Panier' },
      { name: 'Commandes' },
      { name: 'Touma Pay' },
      { name: 'Touma Logistics' },
      { name: 'Touma Verified' },
      { name: 'Avis & litiges' },
      { name: 'Touma AI' },
      { name: 'Vendeur' },
      { name: 'Administration' },
    ],
    paths: {
      '/auth/register': { post: op('Auth', 'Créer un compte', { auth: false, body: true }) },
      '/auth/login': { post: op('Auth', 'Se connecter', { auth: false, body: true }) },
      '/auth/refresh': { post: op('Auth', 'Renouveler le jeton d’accès (rotation)', { auth: false, body: true }) },
      '/auth/logout': { post: op('Auth', 'Se déconnecter', { body: true }) },
      '/auth/me': { get: op('Auth', 'Profil courant'), patch: op('Auth', 'Mettre à jour le profil', { body: true }) },
      '/auth/me/addresses': { get: op('Auth', 'Carnet d’adresses'), post: op('Auth', 'Ajouter une adresse', { body: true }) },
      '/countries': { get: op('Catalogue', 'Pays desservis', { auth: false }) },
      '/categories': { get: op('Catalogue', 'Catégories', { auth: false }) },
      '/stores': { get: op('Catalogue', 'Boutiques', { auth: false, query: ['q', 'country', 'verified', 'page', 'limit'] }), post: op('Catalogue', 'Créer une boutique', { body: true }) },
      '/stores/{id}': { get: op('Catalogue', 'Fiche boutique', { auth: false, params: ['id'] }), patch: op('Catalogue', 'Modifier sa boutique', { params: ['id'], body: true, role: 'SELLER' }) },
      '/products': {
        get: op('Catalogue', 'Rechercher des produits', {
          auth: false,
          query: ['q', 'category', 'country', 'store', 'minPrice', 'maxPrice', 'availability', 'sort', 'page', 'limit'],
        }),
        post: op('Catalogue', 'Publier un produit', { body: true, role: 'SELLER' }),
      },
      '/products/mine': { get: op('Vendeur', 'Mes produits', { role: 'SELLER', query: ['storeId', 'status', 'page', 'limit'] }) },
      '/products/{id}': {
        get: op('Catalogue', 'Fiche produit', { auth: false, params: ['id'] }),
        patch: op('Catalogue', 'Modifier un produit', { params: ['id'], body: true, role: 'SELLER' }),
        delete: op('Catalogue', 'Archiver un produit', { params: ['id'], role: 'SELLER' }),
      },
      '/products/{id}/stock': { put: op('Vendeur', 'Mettre à jour le stock', { params: ['id'], body: true, role: 'SELLER' }) },
      '/cart': { get: op('Panier', 'Mon panier'), delete: op('Panier', 'Vider le panier') },
      '/cart/items': { post: op('Panier', 'Ajouter un article', { body: true }) },
      '/cart/items/{id}': { patch: op('Panier', 'Changer la quantité', { params: ['id'], body: true }), delete: op('Panier', 'Retirer un article', { params: ['id'] }) },
      '/checkout': { post: op('Commandes', 'Valider le panier (crée les commandes)', { body: true }) },
      '/orders': { get: op('Commandes', 'Mes commandes / ventes', { query: ['scope', 'status', 'page', 'limit'] }), post: op('Commandes', 'Créer une commande (checkout)', { body: true }) },
      '/orders/{id}': { get: op('Commandes', 'Détail d’une commande', { params: ['id'] }) },
      '/orders/{id}/status': { patch: op('Commandes', 'Changer le statut', { params: ['id'], body: true }) },
      '/payments/create': { post: op('Touma Pay', 'Créer un paiement (idempotent)', { body: true }) },
      '/payments/confirm': { post: op('Touma Pay', 'Confirmer un paiement (vérifié côté serveur)', { body: true }) },
      '/payments/refund': { post: op('Touma Pay', 'Rembourser', { body: true, role: 'ADMIN' }) },
      '/payments/webhook/{provider}': { post: op('Touma Pay', 'Webhook prestataire (signature obligatoire)', { auth: false, params: ['provider'], body: true }) },
      '/payments/{id}': { get: op('Touma Pay', 'Détail d’un paiement', { params: ['id'] }) },
      '/shipping/quote': { post: op('Touma Logistics', 'Obtenir des tarifs', { body: true }) },
      '/shipping/create': { post: op('Touma Logistics', 'Créer une expédition', { body: true, role: 'SELLER' }) },
      '/shipping/{id}': { get: op('Touma Logistics', 'Détail d’une expédition', { params: ['id'] }) },
      '/shipping/{id}/tracking': { get: op('Touma Logistics', 'Suivi', { params: ['id'] }) },
      '/shipping/{id}/status': { patch: op('Touma Logistics', 'Faire avancer le suivi', { params: ['id'], body: true, role: 'SELLER' }) },
      '/verification/submit': { post: op('Touma Verified', 'Déposer un dossier', { body: true, role: 'SELLER' }) },
      '/verification/status': { get: op('Touma Verified', 'Statut de mes dossiers', { role: 'SELLER' }) },
      '/reviews': { post: op('Avis & litiges', 'Déposer un avis (achat livré requis)', { body: true }) },
      '/reviews/product/{productId}': { get: op('Avis & litiges', 'Avis d’un produit', { auth: false, params: ['productId'] }) },
      '/disputes': { get: op('Avis & litiges', 'Mes litiges'), post: op('Avis & litiges', 'Ouvrir un litige', { body: true }) },
      '/disputes/{id}/messages': { post: op('Avis & litiges', 'Répondre dans un litige', { params: ['id'], body: true }) },
      '/disputes/{id}/resolve': { post: op('Avis & litiges', 'Trancher un litige', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/notifications': { get: op('Auth', 'Mes notifications') },
      '/ai/generate': { post: op('Touma AI', 'Générer un texte (proposition, validation humaine requise)', { body: true }) },
      '/ai/classify': { post: op('Touma AI', 'Classer un texte', { body: true }) },
      '/ai/recommend': { post: op('Touma AI', 'Recommander des produits', { auth: false, body: true }) },
      '/seller/dashboard': { get: op('Vendeur', 'Tableau de bord vendeur', { role: 'SELLER' }) },
      '/seller/inventory/low-stock': { get: op('Vendeur', 'Stocks faibles', { role: 'SELLER' }) },
      '/admin/dashboard': { get: op('Administration', 'Tableau de bord', { role: 'ADMIN' }) },
      '/admin/users': { get: op('Administration', 'Utilisateurs', { role: 'ADMIN', query: ['q', 'page', 'limit'] }) },
      '/admin/verifications': { get: op('Administration', 'Dossiers de vérification', { role: 'ADMIN' }) },
      '/admin/verifications/{id}/approve': { post: op('Administration', 'Approuver un dossier', { params: ['id'], role: 'ADMIN' }) },
      '/admin/verifications/{id}/reject': { post: op('Administration', 'Rejeter un dossier', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/admin/risk': { get: op('Administration', 'Scores de risque', { role: 'ADMIN' }) },
      '/admin/audit': { get: op('Administration', 'Journal d’audit', { role: 'ADMIN', query: ['action', 'page', 'limit'] }) },
    },
  };
}
