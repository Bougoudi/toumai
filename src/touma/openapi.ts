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
      { name: 'Touma Business', description: 'Profil entreprise, appels d’offres, offres fournisseurs' },
      { name: 'Messagerie' },
      { name: 'Après-vente', description: 'Retours, remboursements' },
      { name: 'Assistance' },
      { name: 'Promotions', description: 'Codes de réduction et fidélité' },
      { name: 'Documents', description: 'Facture, avoir, reçu, bon de commande, bon de livraison' },
      { name: 'Réputation', description: 'Indicateurs calculés sur les transactions réelles' },
      { name: 'Sourcing', description: 'Recherche de fournisseurs et sollicitation' },
      { name: 'Vendeur' },
      { name: 'Touma Trade', description: 'Commerce transfrontalier : corridors, éligibilité, documents, coûts' },
      { name: 'Administration' },
    ],
    paths: {
      '/auth/register': { post: op('Auth', 'Créer un compte', { auth: false, body: true }) },
      '/auth/login': { post: op('Auth', 'Se connecter', { auth: false, body: true }) },
      '/auth/refresh': { post: op('Auth', 'Renouveler le jeton d’accès (rotation)', { auth: false, body: true }) },
      '/auth/logout': { post: op('Auth', 'Se déconnecter', { body: true }) },
      '/auth/me': { get: op('Auth', 'Profil courant'), patch: op('Auth', 'Mettre à jour le profil', { body: true }) },
      '/auth/me/export': { post: op('Auth', 'Exporter mes données personnelles') },
      '/auth/me/delete-request': {
        get: op('Auth', 'État de ma demande de suppression'),
        post: op('Auth', 'Demander la suppression de mon compte', { body: true }),
      },
      '/auth/me/delete-request/cancel': { post: op('Auth', 'Annuler ma demande de suppression') },
      '/auth/me/sessions': { get: op('Auth', 'Sessions actives de mon compte', { query: ['refreshToken'] }) },
      '/auth/me/sessions/{id}/revoke': { post: op('Auth', 'Révoquer une session', { params: ['id'] }) },
      '/auth/me/addresses': { get: op('Auth', 'Carnet d’adresses'), post: op('Auth', 'Ajouter une adresse', { body: true }) },
      '/countries': { get: op('Catalogue', 'Pays desservis', { auth: false }) },
      '/categories': {
        get: op('Catalogue', 'Catégories', { auth: false }),
        post: op('Catalogue', 'Créer une catégorie', { body: true, role: 'ADMIN' }),
      },
      '/stores': { get: op('Catalogue', 'Boutiques', { auth: false, query: ['q', 'country', 'verified', 'page', 'limit'] }), post: op('Catalogue', 'Créer une boutique', { body: true }) },
      '/stores/{id}': { get: op('Catalogue', 'Fiche boutique', { auth: false, params: ['id'] }), patch: op('Catalogue', 'Modifier sa boutique', { params: ['id'], body: true, role: 'SELLER' }) },
      '/products': {
        get: op('Catalogue', 'Rechercher des produits', {
          auth: false,
          query: ['q', 'category', 'country', 'sellerCountry', 'originCountry', 'deliverTo', 'corridor', 'store', 'minPrice', 'maxPrice', 'availability', 'sort', 'page', 'limit'],
        }),
        post: op('Catalogue', 'Publier un produit', { body: true, role: 'SELLER' }),
      },
      '/products/facets': {
        get: op('Catalogue', 'Compteurs de la recherche en cours (facettes)', {
          auth: false,
          query: ['q', 'category', 'country', 'sellerCountry', 'originCountry', 'deliverTo', 'corridor', 'store', 'minPrice', 'maxPrice', 'availability', 'verifiedOnly'],
        }),
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
      '/disputes/{id}': { get: op('Avis & litiges', 'Le dossier : échanges, pièces, décision', { params: ['id'] }) },
      '/disputes/{id}/ledger': { get: op('Avis & litiges', 'Mouvements d’argent de la commande en litige', { params: ['id'] }) },
      '/disputes/{id}/evidence': {
        get: op('Avis & litiges', 'Pièces du dossier, avec leurs liens signés', { params: ['id'] }),
        post: op('Avis & litiges', 'Verser une pièce (corps brut)', { params: ['id'], body: true }),
      },
      '/disputes/evidence/{evidenceId}': {
        get: op('Avis & litiges', 'Contenu d’une pièce (URL signée ou partie du dossier)', { auth: false, params: ['evidenceId'], query: ['expires', 'signature'] }),
      },
      '/disputes/evidence/{evidenceId}/remove': {
        post: op('Avis & litiges', 'Écarter une pièce, avec motif (elle reste au dossier)', { params: ['evidenceId'], body: true, role: 'ADMIN' }),
      },
      '/disputes/{id}/resolve': { post: op('Avis & litiges', 'Trancher un litige', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/business/profile': { get: op('Touma Business', 'Mon profil entreprise'), put: op('Touma Business', 'Enregistrer mon profil entreprise', { body: true }) },
      '/rfqs': {
        get: op('Touma Business', 'Appels d’offres (ouverts ou les miens)', { auth: false, query: ['scope', 'country', 'status', 'q', 'page', 'limit'] }),
        post: op('Touma Business', 'Publier un appel d’offres', { body: true }),
      },
      '/rfqs/{id}': { get: op('Touma Business', 'Détail d’un appel d’offres', { auth: false, params: ['id'] }) },
      '/rfqs/{id}/close': { post: op('Touma Business', 'Clore un appel d’offres', { params: ['id'] }) },
      '/rfqs/{id}/quotes': { post: op('Touma Business', 'Répondre par une offre', { params: ['id'], body: true, role: 'SELLER' }) },
      '/quotes/mine': { get: op('Touma Business', 'Mes offres émises', { role: 'SELLER' }) },
      '/quotes/{id}/messages': { post: op('Touma Business', 'Négocier une offre', { params: ['id'], body: true }) },
      '/quotes/{id}/accept': { post: op('Touma Business', 'Accepter une offre (crée la commande)', { params: ['id'], body: true }) },
      '/quotes/{id}/reject': { post: op('Touma Business', 'Refuser une offre', { params: ['id'], body: true }) },
      '/conversations': {
        get: op('Messagerie', 'Mes conversations (filtres et pagination)', { query: ['q', 'kind', 'status', 'unread', 'rfqId', 'quoteId', 'orderId', 'page', 'limit'] }),
        post: op('Messagerie', 'Ouvrir une conversation (boutique, appel d’offres ou commande)', { body: true }),
      },
      '/conversations/unread-count': { get: op('Messagerie', 'Compteurs de non-lus (messages, fils, notifications)') },
      '/conversations/{id}': {
        get: op('Messagerie', 'En-tête du fil et dernière page de messages', { params: ['id'] }),
        patch: op('Messagerie', 'Archiver ou couper les alertes, pour soi seul', { params: ['id'], body: true }),
      },
      '/conversations/{id}/read': { post: op('Messagerie', 'Marquer le fil comme lu', { params: ['id'] }) },
      '/conversations/{id}/messages': {
        get: op('Messagerie', 'Messages (pagination par curseur)', { params: ['id'], query: ['before', 'limit'] }),
        post: op('Messagerie', 'Envoyer un message (réponse citée possible)', { params: ['id'], body: true }),
      },
      '/conversations/{id}/attachments': {
        post: op('Messagerie', 'Envoyer un fichier (corps brut ; type déduit du contenu)', { params: ['id'], body: true }),
      },
      '/messages/search': { get: op('Messagerie', 'Rechercher dans ses propres fils', { query: ['q', 'limit'] }) },
      '/messages/{id}': {
        patch: op('Messagerie', 'Modifier son message (fenêtre courte)', { params: ['id'], body: true }),
        delete: op('Messagerie', 'Supprimer en douceur (jamais un message financier)', { params: ['id'] }),
      },
      '/messages/{id}/reply': { post: op('Messagerie', 'Répondre en citant un message', { params: ['id'], body: true }) },
      '/messages/{id}/report': { post: op('Messagerie', 'Signaler un message', { params: ['id'], body: true }) },
      '/attachments/{id}': { get: op('Messagerie', 'Télécharger une pièce jointe (URL signée ou participant)', { auth: false, params: ['id'], query: ['expires', 'signature'] }) },
      '/messaging/stream-ticket': { post: op('Messagerie', 'Ticket court pour le flux d’événements') },
      '/messaging/stream': { get: op('Messagerie', 'Flux d’événements (SSE ; REST reste la source de vérité)', { auth: false, query: ['ticket'] }) },
      '/messaging/templates': {
        get: op('Messagerie', 'Raccourcis commerciaux et réponses enregistrées'),
        post: op('Messagerie', 'Enregistrer une réponse type', { body: true }),
      },
      '/messaging/templates/{id}': {
        patch: op('Messagerie', 'Modifier une réponse type', { params: ['id'], body: true }),
        delete: op('Messagerie', 'Supprimer une réponse type', { params: ['id'] }),
      },
      '/messaging/preferences': {
        get: op('Messagerie', 'Préférences de notification par catégorie'),
        put: op('Messagerie', 'Changer une préférence', { body: true }),
      },
      '/messaging/blocks': {
        get: op('Messagerie', 'Comptes que j’ai bloqués'),
        post: op('Messagerie', 'Bloquer un compte (les fils passent en lecture seule)', { body: true }),
      },
      '/messaging/blocks/{userId}': { delete: op('Messagerie', 'Débloquer un compte', { params: ['userId'] }) },
      '/messaging/reports': { get: op('Messagerie', 'File des signalements', { role: 'ADMIN', query: ['status', 'page', 'limit'] }) },
      '/messaging/reports/{id}/resolve': { post: op('Messagerie', 'Trancher un signalement', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/messaging/risk-flags': { get: op('Messagerie', 'Signaux de risque détectés', { role: 'ADMIN', query: ['status', 'page', 'limit'] }) },
      '/messaging/risk-flags/{id}/resolve': { post: op('Messagerie', 'Classer un signal de risque', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/negotiations/{id}': { get: op('Touma Business', 'Négociation : offre courante, chronologie, droits', { params: ['id'] }) },
      '/negotiations/{id}/counter': {
        post: op('Touma Business', 'Contre-proposition (totaux calculés côté serveur)', { params: ['id'], body: true }),
      },
      '/negotiations/{id}/offers': { post: op('Touma Business', 'Offre révisée du fournisseur', { params: ['id'], body: true, role: 'SELLER' }) },
      '/negotiations/{id}/accept': { post: op('Touma Business', 'Accepter (acheteur : crée la commande)', { params: ['id'], body: true }) },
      '/negotiations/{id}/apply': { post: op('Touma Business', 'Entériner la contre-proposition (fournisseur)', { params: ['id'], body: true, role: 'SELLER' }) },
      '/negotiations/{id}/reject': { post: op('Touma Business', 'Refuser', { params: ['id'], body: true }) },
      '/negotiations/{id}/withdraw': { post: op('Touma Business', 'Retirer son offre (fournisseur)', { params: ['id'], body: true, role: 'SELLER' }) },
      '/pickup-points': { get: op('Touma Logistics', 'Points relais desservis', { auth: false, query: ['country', 'city', 'q'] }) },
      '/returns': { get: op('Après-vente', 'Mes retours / retours reçus', { query: ['scope', 'status', 'page', 'limit'] }), post: op('Après-vente', 'Demander un retour', { body: true }) },
      '/returns/eligibility/{orderId}': { get: op('Après-vente', 'Articles retournables d’une commande', { params: ['orderId'] }) },
      '/returns/{id}': { get: op('Après-vente', 'Détail d’une demande de retour', { params: ['id'] }) },
      '/returns/{id}/approve': { post: op('Après-vente', 'Accepter le retour', { params: ['id'], body: true, role: 'SELLER' }) },
      '/returns/{id}/reject': { post: op('Après-vente', 'Refuser le retour', { params: ['id'], body: true, role: 'SELLER' }) },
      '/returns/{id}/ship': { post: op('Après-vente', 'Déclarer le colis réexpédié', { params: ['id'], body: true }) },
      '/returns/{id}/receive': { post: op('Après-vente', 'Accuser réception du retour', { params: ['id'], body: true, role: 'SELLER' }) },
      '/returns/{id}/cancel': { post: op('Après-vente', 'Retirer la demande', { params: ['id'] }) },
      '/returns/{id}/refund': { post: op('Après-vente', 'Rembourser le retour (décision humaine)', { params: ['id'], body: true, role: 'SELLER' }) },
      '/support/tickets': { get: op('Assistance', 'Mes tickets / file d’assistance', { query: ['scope', 'status', 'category', 'page', 'limit'] }), post: op('Assistance', 'Ouvrir un ticket', { body: true }) },
      '/support/tickets/{id}': { get: op('Assistance', 'Détail d’un ticket', { params: ['id'] }), patch: op('Assistance', 'Statut, priorité, affectation', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/support/tickets/{id}/messages': { post: op('Assistance', 'Répondre au ticket', { params: ['id'], body: true }) },
      '/support/tickets/{id}/close': { post: op('Assistance', 'Clore le ticket', { params: ['id'] }) },
      '/coupons': {
        get: op('Promotions', 'Mes codes de réduction', { query: ['scope', 'storeId', 'status', 'page', 'limit'] }),
        post: op('Promotions', 'Créer un code (vendeur pour sa boutique, admin pour TOUMA)', { body: true }),
      },
      '/coupons/preview': { post: op('Promotions', 'Simuler un code sur le panier courant', { body: true }) },
      '/coupons/{id}': { patch: op('Promotions', 'Suspendre, réactiver ou ajuster un code', { params: ['id'], body: true }) },
      '/coupons/{id}/redemptions': { get: op('Promotions', 'Utilisations et coût réel d’un code', { params: ['id'] }) },
      '/loyalty': { get: op('Promotions', 'Mon solde de points, mon palier et mon historique') },
      '/loyalty/usable': { get: op('Promotions', 'Points utilisables sur le panier courant') },
      '/loyalty/adjust': { post: op('Promotions', 'Ajuster un solde de points', { body: true, role: 'ADMIN' }) },
      '/documents': { get: op('Documents', 'Mes documents (reçus ou émis)', { query: ['scope', 'type', 'page', 'limit'] }) },
      '/documents/order/{orderId}': { get: op('Documents', 'Documents d’une commande', { params: ['orderId'] }) },
      '/documents/store/{storeId}/totals': { get: op('Documents', 'Totaux facturés et avoirés d’une boutique', { params: ['storeId'], role: 'SELLER' }) },
      '/documents/{id}': { get: op('Documents', 'Contenu figé d’un document', { params: ['id'] }) },
      '/reputation/store/{idOrSlug}': { get: op('Réputation', 'Réputation publique d’une boutique', { auth: false, params: ['idOrSlug'] }) },
      '/reputation/mine/{storeId}': { get: op('Réputation', 'Ma réputation, recalculée à la demande', { params: ['storeId'], role: 'SELLER' }) },
      '/reputation/leaderboard': { get: op('Réputation', 'Classement des boutiques par score', { role: 'ADMIN', query: ['limit'] }) },

      // ── Confiance, réputation et vérification (V21) ───────────────────────
      //
      // Aucune de ces routes ne permet d'écrire un score, un badge ou un statut
      // de vérification : ce sont des lectures, plus un recours déposé par
      // l'intéressé et des décisions d'administration auditées.
      '/trust/weights': {
        get: op('Confiance', 'Pondérations, seuils et règles de badges — publiés pour être contestables', { auth: false }),
      },
      '/trust/sellers/{idOrSlug}': {
        get: op('Confiance', 'Confiance publique d’une boutique, avec sa ventilation', { auth: false, params: ['idOrSlug'] }),
      },
      '/trust/products/{idOrSlug}': {
        get: op('Confiance', 'Confiance d’un produit', { auth: false, params: ['idOrSlug'] }),
      },
      '/trust/suppliers/{userId}': {
        get: op('Confiance', 'Confiance d’un fournisseur B2B', { auth: false, params: ['userId'] }),
      },
      '/trust/me': { get: op('Confiance', 'Ma confiance : score, badges, état du compte, recours') },
      '/trust/history/{entityType}/{entityId}': {
        get: op('Confiance', 'Historique daté d’un score — l’intéressé ou l’administration', { params: ['entityType', 'entityId'] }),
      },
      '/trust/verification/requirements': {
        get: op('Confiance', 'Ce qui manque pour atteindre un niveau de vérification', { query: ['level', 'storeId'] }),
      },
      '/trust/appeals': {
        get: op('Confiance', 'Mes recours'),
        post: op('Confiance', 'Contester une décision de confiance', { body: true }),
      },
      '/admin/trust/overview': { get: op('Confiance', 'Tableau de bord de la confiance', { role: 'ADMIN' }) },
      '/admin/trust/reviews': {
        get: op('Confiance', 'File de modération des avis', { role: 'ADMIN', query: ['status', 'page', 'limit'] }),
      },
      '/admin/trust/reviews/{id}/moderate': {
        post: op('Confiance', 'Décider du sort d’un avis — motif obligatoire, audité', { role: 'ADMIN', params: ['id'], body: true }),
      },
      '/admin/trust/risk': {
        get: op('Confiance', 'Transactions évaluées à risque', { role: 'ADMIN', query: ['level', 'page', 'limit'] }),
      },
      '/admin/trust/appeals': {
        get: op('Confiance', 'File des recours', { role: 'ADMIN', query: ['status', 'page', 'limit'] }),
      },
      '/admin/trust/appeals/{id}/decide': {
        post: op('Confiance', 'Trancher un recours — motivation obligatoire', { role: 'ADMIN', params: ['id'], body: true }),
      },
      '/admin/trust/users/{id}/standing': {
        post: op('Confiance', 'Restreindre, suspendre, bannir ou rétablir un compte', { role: 'ADMIN', params: ['id'], body: true }),
      },
      '/admin/trust/recompute/{entityType}/{entityId}': {
        post: op('Confiance', 'Recalculer une confiance à la demande', { role: 'ADMIN', params: ['entityType', 'entityId'] }),
      },

      // ── Croissance : promotions, campagnes (V22) ──────────────────────────
      //
      // Aucune de ces routes ne permet d'écrire un prix. Une promotion réduit
      // un prix au moment du calcul ; elle ne le remplace jamais en base.
      '/growth/promotions': {
        get: op('Croissance', 'Promotions en cours', { auth: false, query: ['page', 'limit'] }),
      },
      '/growth/promotions/{id}': {
        get: op('Croissance', 'Fiche d’une promotion en cours', { auth: false, params: ['id'] }),
      },
      '/seller/marketing/promotions': {
        get: op('Croissance', 'Mes promotions, avec ce qu’elles ont coûté', { role: 'SELLER', query: ['storeId', 'page', 'limit'] }),
        post: op('Croissance', 'Créer une promotion (en brouillon, financée par la boutique)', { role: 'SELLER', body: true }),
      },
      '/seller/marketing/promotions/{id}': {
        patch: op('Croissance', 'Modifier, planifier, suspendre ou archiver une promotion', { role: 'SELLER', params: ['id'], body: true }),
      },
      '/seller/marketing/promotions/{id}/performance': {
        get: op('Croissance', 'Ce qu’une promotion a réellement coûté — sans ROI inventé', { role: 'SELLER', params: ['id'] }),
      },
      '/seller/marketing/promotions/preview': {
        post: op('Croissance', 'Évaluer un panier contre ses promotions, avant publication', { role: 'SELLER', body: true }),
      },
      '/admin/marketing/overview': {
        get: op('Croissance', 'Tableau de bord marketing — décomptes observés, par devise', { role: 'ADMIN' }),
      },
      '/admin/marketing/campaigns': {
        get: op('Croissance', 'Campagnes', { role: 'ADMIN', query: ['page', 'limit'] }),
        post: op('Croissance', 'Créer une campagne (aucun événement culturel codé en dur)', { role: 'ADMIN', body: true }),
      },
      '/referrals': {
        get: op('Croissance', 'Mon parrainage — des décomptes, aucune donnée sur les filleuls'),
      },
      '/referrals/code': { post: op('Croissance', 'Obtenir mon code de parrainage') },
      '/admin/marketing/referrals': {
        get: op('Croissance', 'Parrainages qualifiés en attente de décision', { role: 'ADMIN', query: ['page', 'limit'] }),
      },
      '/admin/marketing/referrals/{id}/reward': {
        post: op('Croissance', 'Marquer un parrainage récompensé — jamais automatique', { role: 'ADMIN', params: ['id'], body: true }),
      },
      '/growth/flash-sales/product/{productId}': {
        get: op('Croissance', 'Vente flash en cours sur un produit — jamais une vente épuisée', { auth: false, params: ['productId'] }),
      },
      '/seller/marketing/flash-sales': {
        get: op('Croissance', 'Mes ventes flash', { role: 'SELLER', query: ['page', 'limit'] }),
        post: op('Croissance', 'Créer une vente flash (en brouillon, prix obligatoirement réduit)', { role: 'SELLER', body: true }),
      },
      '/admin/marketing/segments': {
        get: op('Croissance', 'Effectifs par segment — des décomptes, pas une projection', { role: 'ADMIN' }),
        post: op('Croissance', 'Créer un segment (faits commerciaux uniquement)', { role: 'ADMIN', body: true }),
      },
      '/sourcing/suppliers': {
        get: op('Sourcing', 'Trouver un fournisseur', {
          auth: false,
          query: ['q', 'category', 'country', 'destination', 'minQuantity', 'verifiedOnly', 'sort', 'page', 'limit'],
        }),
      },
      '/sourcing/suppliers/{idOrSlug}': { get: op('Sourcing', 'Fiche fournisseur', { auth: false, params: ['idOrSlug'] }) },
      '/rfqs/{id}/invitations': { post: op('Sourcing', 'Solliciter des fournisseurs sur un appel d’offres', { params: ['id'], body: true }) },
      '/notifications': { get: op('Auth', 'Mes notifications') },
      '/ai/generate': { post: op('Touma AI', 'Générer un texte (proposition, validation humaine requise)', { body: true }) },
      '/ai/classify': { post: op('Touma AI', 'Classer un texte', { body: true }) },
      '/ai/recommend': { post: op('Touma AI', 'Recommander des produits', { auth: false, body: true }) },
      '/seller/dashboard': { get: op('Vendeur', 'Tableau de bord vendeur', { role: 'SELLER' }) },
      '/seller/inventory/low-stock': { get: op('Vendeur', 'Stocks faibles', { role: 'SELLER' }) },
      '/seller/stores/{storeId}/catalogue/import': {
        post: op('Vendeur', 'Importer un catalogue CSV (dryRun=true pour simuler)', { params: ['storeId'], query: ['dryRun'], body: true, role: 'SELLER' }),
      },
      '/seller/stores/{storeId}/catalogue/export': { get: op('Vendeur', 'Exporter le catalogue en CSV', { params: ['storeId'], role: 'SELLER' }) },
      '/seller/catalogue/modele': { get: op('Vendeur', 'Modèle de fichier d’import', { role: 'SELLER' }) },
      '/admin/dashboard': { get: op('Administration', 'Tableau de bord', { role: 'ADMIN' }) },
      '/admin/users': { get: op('Administration', 'Utilisateurs', { role: 'ADMIN', query: ['q', 'page', 'limit'] }) },
      '/admin/verifications': { get: op('Administration', 'Dossiers de vérification', { role: 'ADMIN' }) },
      '/admin/verifications/{id}/approve': { post: op('Administration', 'Approuver un dossier', { params: ['id'], role: 'ADMIN' }) },
      '/admin/verifications/{id}/reject': { post: op('Administration', 'Rejeter un dossier', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/admin/intelligence': {
        get: op('Administration', 'TOUMA Intelligence : corridors, demande non servie, paiements, tensions', { role: 'ADMIN', query: ['days'] }),
      },
      '/admin/risk': { get: op('Administration', 'Scores de risque', { role: 'ADMIN' }) },
      '/features': { get: op('Catalogue', 'Drapeaux de fonctionnalité exposés au navigateur', { auth: false, query: ['country'] }) },
      '/admin/feature-flags': { get: op('Administration', 'Drapeaux de fonctionnalité (ADMIN_SYSTEM)', { role: 'ADMIN' }) },
      '/admin/feature-flags/{key}': { put: op('Administration', 'Définir un drapeau (ADMIN_SYSTEM)', { role: 'ADMIN', params: ['key'], body: true }) },
      '/admin/incidents': {
        get: op('Administration', 'Incidents d’exploitation (ADMIN_SYSTEM)', { role: 'ADMIN', query: ['status', 'severity'] }),
        post: op('Administration', 'Ouvrir un incident (ADMIN_SYSTEM)', { role: 'ADMIN', body: true }),
      },
      '/admin/incidents/{id}': { get: op('Administration', 'Un incident et sa chronologie (ADMIN_SYSTEM)', { role: 'ADMIN', params: ['id'] }) },
      '/admin/incidents/{id}/events': { post: op('Administration', 'Ajouter une ligne à la chronologie (ADMIN_SYSTEM)', { role: 'ADMIN', params: ['id'], body: true }) },
      '/admin/incidents/{id}/status': { post: op('Administration', 'Changer l’état d’un incident (ADMIN_SYSTEM)', { role: 'ADMIN', params: ['id'], body: true }) },
      '/admin/operations': { get: op('Administration', 'Centre d’opérations : santé réelle des services (ADMIN_SYSTEM)', { role: 'ADMIN' }) },
      '/admin/data-integrity': { get: op('Administration', 'Contrôles d’intégrité des données (ADMIN_SYSTEM)', { role: 'ADMIN' }) },
      '/admin/data-integrity/catalogue': { get: op('Administration', 'Invariants contrôlés (ADMIN_SYSTEM)', { role: 'ADMIN' }) },
      '/admin/permissions': { get: op('Administration', 'Permissions des administrateurs (ADMIN_SYSTEM)', { role: 'ADMIN' }) },
      '/admin/permissions/{id}': { put: op('Administration', 'Définir les permissions d’un administrateur (ADMIN_SYSTEM)', { role: 'ADMIN', params: ['id'], body: true }) },
      '/admin/audit': { get: op('Administration', 'Journal d’audit', { role: 'ADMIN', query: ['action', 'page', 'limit'] }) },

      // ── Index et sondes ─────────────────────────────────────────────────
      '/': { get: op('Catalogue', 'Index de l’API : produits, points d’entrée, taux de commission de repli', { auth: false }) },
      '/health': { get: op('Catalogue', 'Le processus vit', { auth: false }) },
      '/ready': { get: op('Catalogue', 'Dépendances joignables ; 503 tant qu’une dépendance requise manque', { auth: false }) },
      '/search': { get: op('Catalogue', 'Recherche globale : produits et boutiques', { auth: false, query: ['q', 'limit'] }) },

      // ── Catalogue ───────────────────────────────────────────────────────
      '/categories/{slug}': { get: op('Catalogue', 'Fiche catégorie', { auth: false, params: ['slug'] }) },
      '/countries/{code}': { get: op('Catalogue', 'Fiche pays', { auth: false, params: ['code'] }) },
      '/stores/mine': { get: op('Vendeur', 'Mes boutiques', { role: 'SELLER' }) },
      '/products/{id}/paliers': {
        get: op('Catalogue', 'Grille de paliers B2B', { auth: false, params: ['id'] }),
        put: op('Vendeur', 'Remplacer la grille de paliers', { params: ['id'], body: true, role: 'SELLER' }),
      },
      '/products/{id}/disponibilite': {
        get: op(
          'Touma Logistics',
          'Ce produit peut-il arriver dans cette province ? Quatre réponses : livrable, refus du vendeur, aucun transporteur, destination inconnue',
          { auth: false, params: ['id'], query: ['province'] },
        ),
      },
      '/stores/{id}/zones-service': {
        get: op('Touma Logistics', 'Où cette boutique livre (lecture publique)', { auth: false, params: ['id'] }),
        put: op('Touma Logistics', 'Déclarer ses zones de service (remplacement complet)', { params: ['id'], body: true, role: 'SELLER' }),
      },
      '/auth/me/addresses/{id}': { delete: op('Auth', 'Supprimer une adresse', { params: ['id'] }) },

      // ── Géographie ──────────────────────────────────────────────────────
      '/geo/provinces': { get: op('Catalogue', 'Provinces d’un pays', { auth: false, query: ['country'] }) },
      '/geo/provinces/{idOrCode}': { get: op('Catalogue', 'Fiche d’une province : boutiques, points relais, desserte', { auth: false, params: ['idOrCode'], query: ['country'] }) },
      '/geo/provinces/{id}/departments': { get: op('Catalogue', 'Départements d’une province', { auth: false, params: ['id'] }) },
      '/geo/provinces/{id}/localities': { get: op('Catalogue', 'Localités d’une province', { auth: false, params: ['id'], query: ['q', 'department', 'limit'] }) },
      '/geo/localities': { get: op('Catalogue', 'Rechercher une localité dans tout un pays', { auth: false, query: ['country', 'q', 'limit'] }) },

      // ── Commandes ───────────────────────────────────────────────────────
      '/orders/groups/{id}': { get: op('Commandes', 'Détail d’un panier multi-vendeurs', { params: ['id'] }) },
      '/orders/{id}/tracking': { get: op('Touma Logistics', 'Suivi d’une commande', { params: ['id'] }) },
      '/orders/{id}/confirm': { post: op('Commandes', 'Accepter la commande', { params: ['id'], role: 'SELLER' }) },
      '/orders/{id}/process': { post: op('Commandes', 'Mettre en préparation', { params: ['id'], role: 'SELLER' }) },
      '/orders/{id}/ready-to-ship': { post: op('Commandes', 'Déclarer le colis prêt', { params: ['id'], role: 'SELLER' }) },
      '/orders/{id}/ship': { post: op('Commandes', 'Déclarer l’expédition', { params: ['id'], body: true, role: 'SELLER' }) },
      '/orders/{id}/deliver': { post: op('Commandes', 'Déclarer la livraison', { params: ['id'], role: 'SELLER' }) },
      '/orders/{id}/confirm-delivery': { post: op('Commandes', 'L’acheteur confirme la réception', { params: ['id'] }) },
      '/orders/{id}/cancel': { post: op('Commandes', 'Annuler la commande', { params: ['id'], body: true }) },
      '/pickup-points/orders/{orderId}/release': {
        post: op('Touma Logistics', 'Remettre un colis en point relais (code de retrait obligatoire)', { params: ['orderId'], body: true, role: 'SELLER' }),
      },

      // ── Touma Pay ───────────────────────────────────────────────────────
      '/payments/providers': { get: op('Touma Pay', 'Adaptateurs enregistrés dans le code (≠ moyens ouverts)', { auth: false }) },
      '/payments/methods': {
        get: op('Touma Pay', 'Moyens réellement proposables, chacun avec son motif quand il est fermé', { query: ['country', 'currency', 'order', 'group'] }),
      },
      '/payments/{id}/cash': { get: op('Touma Pay', 'Suivi d’un encaissement à la livraison', { params: ['id'] }) },
      '/payments/{id}/cash/confirm': { post: op('Touma Pay', 'Le vendeur s’engage à encaisser', { params: ['id'], role: 'SELLER' }) },
      '/payments/{id}/cash/collect': { post: op('Touma Pay', 'Constater la remise de l’argent (seul chemin d’entrée au registre)', { params: ['id'], body: true, role: 'SELLER' }) },
      '/payments/{id}/cash/fail': { post: op('Touma Pay', 'Déclarer l’échec de l’encaissement', { params: ['id'], body: true, role: 'SELLER' }) },

      // ── Logistique et IA ────────────────────────────────────────────────
      '/shipping/providers': { get: op('Touma Logistics', 'Transporteurs raccordés', { auth: false }) },
      '/shipping/{id}/cancel': { post: op('Touma Logistics', 'Annuler une expédition', { params: ['id'], role: 'SELLER' }) },
      '/ai/provider': { get: op('Touma AI', 'Adaptateur d’IA actif', { auth: false }) },

      // ── Touma Trade (V24) ──────────────────────────────────────────────────
      '/trade': { get: op('Touma Trade', 'État du commerce transfrontalier : corridors configurés et réellement opérationnels', { auth: false }) },
      '/trade/countries': { get: op('Touma Trade', 'Configuration commerciale des pays', { auth: false }) },
      '/trade/corridors': { get: op('Touma Trade', 'Corridors, avec statut déclaré **et** capacité réelle', { auth: false }) },
      '/trade/corridors/{code}': { get: op('Touma Trade', 'Un corridor, ses règles et ses itinéraires sourcés', { auth: false, params: ['code'] }) },
      '/trade/eligibility/check': { post: op('Touma Trade', 'Vérifier l’éligibilité d’une vente transfrontalière, avec le motif de chaque critère', { auth: false, body: true }) },
      '/trade/cost-estimate': { post: op('Touma Trade', 'Coût rendu : chaque ligne porte sa fiabilité (confirmé, estimé, inconnu)', { auth: false, body: true }) },
      '/trade/fx': { get: op('Touma Trade', 'Source de taux de change configurée, ou absence de source', { auth: false }) },
      '/trade/fx/rate': { get: op('Touma Trade', 'Taux de change d’un couple de devises, avec sa source', { auth: false, query: ['base', 'quote'] }) },
      '/trade/orders': { get: op('Touma Trade', 'Mes commandes transfrontalières') },
      '/trade/orders/{id}': { get: op('Touma Trade', 'Une commande transfrontalière', { params: ['id'] }) },
      '/trade/orders/{id}/timeline': { get: op('Touma Trade', 'Chronologie réelle de l’opération', { params: ['id'] }) },
      '/trade/orders/{id}/checklist': { get: op('Touma Trade', 'Liste de contrôle, établie sur des faits vérifiables', { params: ['id'] }) },
      '/trade/orders/{id}/documents': { get: op('Touma Trade', 'Documents commerciaux de la commande', { params: ['id'] }) },
      '/trade/documents/issue': { post: op('Touma Trade', 'Émettre une facture commerciale ou une liste de colisage', { body: true }) },
      '/trade/documents/proforma': { post: op('Touma Trade', 'Établir une proforma depuis un devis accepté', { body: true }) },
      '/trade/documents/{id}': { get: op('Touma Trade', 'Un document commercial', { params: ['id'] }) },
      '/seller/trade': { get: op('Touma Trade', 'Centre commerce international du vendeur', { role: 'SELLER' }) },
      '/seller/trade/orders': { get: op('Touma Trade', 'Commandes internationales du vendeur', { role: 'SELLER' }) },
      '/seller/trade/analytics': { get: op('Touma Trade', 'Ventes internationales, par devise et par destination', { role: 'SELLER', query: ['days'] }) },
      '/business/trade': { get: op('Touma Trade', 'Centre commerce international professionnel') },
      '/business/trade/orders': { get: op('Touma Trade', 'Importations de l’acheteur professionnel') },
      '/business/trade/analytics': { get: op('Touma Trade', 'Importations, fournisseurs et dépense par devise', { query: ['days'] }) },
      '/admin/trade/overview': { get: op('Touma Trade', 'Vue d’ensemble : ce qui manque à chaque corridor', { role: 'ADMIN' }) },
      '/admin/trade/corridors': {
        get: op('Touma Trade', 'Corridors configurés', { role: 'ADMIN' }),
        post: op('Touma Trade', 'Créer un corridor (« à venir » par défaut)', { role: 'ADMIN', body: true }),
      },
      '/admin/trade/corridors/{id}': { patch: op('Touma Trade', 'Modifier un corridor ; l’activation exige des prestataires réels', { role: 'ADMIN', params: ['id'], body: true }) },
      '/admin/trade/countries/{code}': { put: op('Touma Trade', 'Configurer le commerce d’un pays', { role: 'ADMIN', params: ['code'], body: true }) },
      '/admin/trade/rules': {
        get: op('Touma Trade', 'Règles commerciales versionnées et sourcées', { role: 'ADMIN' }),
        post: op('Touma Trade', 'Créer une version de règle (brouillon)', { role: 'ADMIN', body: true }),
      },
      '/admin/trade/rules/{id}/activate': { post: op('Touma Trade', 'Activer une version ; l’ancienne est remplacée, jamais modifiée', { role: 'ADMIN', params: ['id'] }) },
      '/admin/trade/exceptions': { get: op('Touma Trade', 'Incidents d’acheminement non résolus', { role: 'ADMIN' }) },
      '/admin/trade/analytics': { get: op('Touma Trade', 'Analytique par corridor : taux mesurés, sans explication', { role: 'ADMIN', query: ['days'] }) },
      '/admin/trade/fx/rates': { post: op('Touma Trade', 'Enregistrer un taux de change avec sa source', { role: 'ADMIN', body: true }) },
      '/admin/trade/documents/{id}/verify': { post: op('Touma Trade', 'Vérifier un document, en consignant la méthode', { role: 'ADMIN', params: ['id'], body: true }) },
      '/admin/trade/documents/{id}/reject': { post: op('Touma Trade', 'Rejeter un document, avec son motif', { role: 'ADMIN', params: ['id'], body: true }) },

      // ── Touma Intelligence (V23) ───────────────────────────────────────────
      '/ai/chat': { post: op('Touma Intelligence', 'Assistant acheteur : la réponse est composée à partir des données réelles, jamais inventée', { auth: false, body: true }) },
      '/ai/capabilities': { get: op('Touma Intelligence', 'Outils réellement disponibles depuis l’espace acheteur', { auth: false }) },
      '/ai/conversations': { get: op('Touma Intelligence', 'Mes conversations avec l’assistant') },
      '/ai/conversations/{id}': {
        get: op('Touma Intelligence', 'Une conversation, ses messages et la trace des outils appelés', { params: ['id'] }),
        delete: op('Touma Intelligence', 'Supprimer une de mes conversations', { params: ['id'] }),
      },
      '/ai/feedback': { post: op('Touma Intelligence', 'Signaler une réponse (incorrecte, prix faux, produit faux…)', { body: true }) },
      '/ai/confirmations': { get: op('Touma Intelligence', 'Actions en attente de ma confirmation') },
      '/ai/confirmations/{id}/confirm': { post: op('Touma Intelligence', 'Confirmer une action sensible proposée par l’assistant', { params: ['id'] }) },
      '/ai/confirmations/{id}/reject': { post: op('Touma Intelligence', 'Refuser une action proposée par l’assistant', { params: ['id'] }) },
      '/ai/memory': {
        get: op('Touma Intelligence', 'Ce que l’assistant a retenu de moi, avec sa date d’expiration'),
        delete: op('Touma Intelligence', 'Effacer ce que l’assistant a retenu', { query: ['key'] }),
      },
      '/seller/ai': { post: op('Touma Intelligence', 'Copilote vendeur : ventes, stock, brouillon de fiche', { role: 'SELLER', body: true }) },
      '/seller/ai/capabilities': { get: op('Touma Intelligence', 'Outils disponibles depuis l’espace vendeur', { role: 'SELLER' }) },
      '/business/ai': { post: op('Touma Intelligence', 'Assistant professionnel : fournisseurs, devis, demande de devis', { body: true }) },
      '/business/ai/capabilities': { get: op('Touma Intelligence', 'Outils disponibles depuis l’espace professionnel') },
      '/admin/ai/query': { post: op('Touma Intelligence', 'Agent d’administration, en lecture : les décisions restent humaines', { role: 'ADMIN', body: true }) },
      '/admin/ai/usage': { get: op('Touma Intelligence', 'Consommation et coûts estimés de l’IA', { role: 'ADMIN', query: ['days'] }) },
      '/admin/ai/quality': { get: op('Touma Intelligence', 'Qualité : échecs d’outils, signalements factuels, latence', { role: 'ADMIN', query: ['days'] }) },
      '/admin/ai/feedback': { get: op('Touma Intelligence', 'File des signalements non traités', { role: 'ADMIN', query: ['days'] }) },
      '/admin/ai/jobs': { get: op('Touma Intelligence', 'Exécutions des travaux périodiques d’intelligence', { role: 'ADMIN' }) },
      '/admin/ai/prompts': {
        get: op('Touma Intelligence', 'Versions d’invites de production', { role: 'ADMIN' }),
        post: op('Touma Intelligence', 'Créer une version d’invite (inactive par défaut)', { role: 'ADMIN', body: true }),
      },
      '/admin/ai/prompts/{id}/activate': { post: op('Touma Intelligence', 'Activer une version d’invite (une seule active par fonctionnalité)', { role: 'ADMIN', params: ['id'] }) },

      // ── Notifications ───────────────────────────────────────────────────
      '/notifications/{id}/read': { post: op('Auth', 'Marquer une notification comme lue', { params: ['id'] }) },
      '/notifications/read-all': { post: op('Auth', 'Tout marquer comme lu') },

      // ── Finance vendeur ─────────────────────────────────────────────────
      '/seller/finance': { get: op('Vendeur', 'Ce qui m’est dû, par devise, et pourquoi pas encore', { role: 'SELLER', query: ['store'] }) },
      '/seller/finance/payouts': { get: op('Vendeur', 'Mes versements', { role: 'SELLER', query: ['store'] }) },
      '/seller/finance/payouts/{id}': { get: op('Vendeur', 'Détail d’un versement', { params: ['id'], role: 'SELLER' }) },
      '/seller/finance/orders/{orderId}/ledger': { get: op('Vendeur', 'Mouvements comptables d’une commande', { params: ['orderId'], role: 'SELLER' }) },
      '/seller/orders': { get: op('Vendeur', 'Mes ventes', { role: 'SELLER', query: ['status', 'page', 'limit'] }) },
      '/seller/orders/{id}': { get: op('Vendeur', 'Détail d’une vente', { params: ['id'], role: 'SELLER' }) },
      '/seller/stores/{id}/stats': { get: op('Vendeur', 'Chiffres d’une boutique', { params: ['id'], role: 'SELLER' }) },
      '/seller/stores/{id}/analytics': { get: op('Vendeur', 'Séries temporelles d’une boutique', { params: ['id'], role: 'SELLER', query: ['days'] }) },

      // ── Administration : listes ─────────────────────────────────────────
      '/admin/stores': { get: op('Administration', 'Boutiques', { role: 'ADMIN', query: ['status', 'page', 'limit'] }) },
      '/admin/orders': { get: op('Administration', 'Commandes', { role: 'ADMIN', query: ['status', 'page', 'limit'] }) },
      '/admin/payments': { get: op('Administration', 'Paiements', { role: 'ADMIN', query: ['page', 'limit'] }) },
      '/admin/shipments': { get: op('Administration', 'Expéditions', { role: 'ADMIN', query: ['page', 'limit'] }) },
      '/admin/disputes': { get: op('Administration', 'Litiges', { role: 'ADMIN', query: ['status', 'page', 'limit'] }) },
      '/admin/analytics': { get: op('Administration', 'Séries temporelles de la place de marché', { role: 'ADMIN', query: ['days'] }) },
      '/admin/webhooks': {
        get: op('Administration', 'Tentatives de webhook, acceptées et refusées, comptées par issue', { role: 'ADMIN', query: ['outcome', 'provider', 'page', 'limit'] }),
      },
      '/admin/users/{id}/status': { patch: op('Administration', 'Suspendre ou réactiver un compte', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/admin/users/{id}/role': { patch: op('Administration', 'Changer le rôle d’un compte', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/admin/stores/{id}/status': { patch: op('Administration', 'Changer le statut d’une boutique', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/admin/products/{id}/status': { patch: op('Administration', 'Changer le statut d’un produit', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/admin/risk/{userId}/recompute': { post: op('Administration', 'Recalculer un score de risque', { params: ['userId'], role: 'ADMIN' }) },

      // ── Administration : commission ─────────────────────────────────────
      '/admin/commission-rules': {
        get: op('Administration', 'Règles de commission en vigueur, et taux de repli', { role: 'ADMIN', query: ['all'] }),
        post: op('Administration', 'Poser une règle de commission', { body: true, role: 'ADMIN' }),
      },
      '/admin/commission-rules/{id}/close': {
        post: op('Administration', 'Clore une règle (il n’existe ni modification ni suppression)', { params: ['id'], body: true, role: 'ADMIN' }),
      },
      '/admin/commission-rules/simulate': { post: op('Administration', 'Quel taux s’appliquerait, et pourquoi', { body: true, role: 'ADMIN' }) },

      // ── Administration : finance ────────────────────────────────────────
      '/admin/finance/overview': { get: op('Administration', 'Vue d’ensemble financière, par devise', { role: 'ADMIN' }) },
      '/admin/finance/ledger': { get: op('Administration', 'Registre d’une boutique', { role: 'ADMIN', query: ['store'] }) },
      '/admin/finance/payouts': {
        get: op('Administration', 'Versements', { role: 'ADMIN', query: ['status'] }),
        post: op('Administration', 'Créer un versement (regroupe les parts réglables)', { body: true, role: 'ADMIN' }),
      },
      '/admin/finance/payouts/{id}/process': { post: op('Administration', 'Consigner l’exécution d’un virement fait ailleurs', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/admin/finance/payouts/{id}/hold': { post: op('Administration', 'Retenir un versement (motif visible du vendeur)', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/admin/finance/payouts/{id}/release': { post: op('Administration', 'Lever une retenue', { params: ['id'], role: 'ADMIN' }) },
      '/admin/finance/payouts/{id}/cancel': { post: op('Administration', 'Annuler un versement (ses parts redeviennent réglables)', { params: ['id'], body: true, role: 'ADMIN' }) },

      // ── Administration : géographie ─────────────────────────────────────
      '/admin/geo/national': { get: op('Administration', 'Tableau de bord national, province par province', { role: 'ADMIN', query: ['country'] }) },
      '/admin/geo/provinces/{id}': { patch: op('Administration', 'Désactiver ou renommer une province (jamais supprimer)', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/admin/geo/localities/{id}': { patch: op('Administration', 'Corriger une localité', { params: ['id'], body: true, role: 'ADMIN' }) },
      '/admin/geo/delivery-zones': {
        get: op('Administration', 'Zones de livraison déclarées', { role: 'ADMIN', query: ['country', 'province'] }),
        post: op('Administration', 'Déclarer une zone de livraison', { body: true, role: 'ADMIN' }),
      },
      '/admin/geo/delivery-zones/{id}': {
        patch: op('Administration', 'Modifier une zone', { params: ['id'], body: true, role: 'ADMIN' }),
        delete: op('Administration', 'Retirer une zone (seulement si elle n’a jamais servi)', { params: ['id'], role: 'ADMIN' }),
      },
      '/admin/geo/pickup-points': { post: op('Administration', 'Créer un point relais', { body: true, role: 'ADMIN' }) },
      '/admin/geo/pickup-points/{id}': { patch: op('Administration', 'Modifier un point relais', { params: ['id'], body: true, role: 'ADMIN' }) },
    },
  };
}
