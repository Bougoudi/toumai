/**
 * Français et arabe — les deux langues officielles du Tchad.
 *
 * **Ce qui est traduit, et ce qui ne l'est pas.** L'ossature de l'application
 * l'est : navigation, actions, statuts de commande, moyens de paiement,
 * messages d'erreur, page d'accueil. Les écrans métier — catalogue détaillé,
 * espace vendeur, administration — ne le sont **pas encore**, et une clé
 * absente retombe sur le français plutôt que d'afficher son propre nom.
 *
 * Le dire est le point. Annoncer « interface bilingue » alors que la moitié des
 * écrans restent en français mettrait un arabophone devant une porte qui
 * s'ouvre sur un mur — exactement ce que le §80 interdit ailleurs pour les
 * paiements et les délais. La couverture est donc affichée dans le sélecteur
 * de langue, en arabe.
 *
 * **Le sens d'écriture suit la langue.** `dir="rtl"` est posé sur la racine du
 * document, et la feuille de style n'emploie que des propriétés logiques
 * (`margin-inline-start`, `inset-inline`, `text-align: start`) : le miroir est
 * donc complet sans une seule règle dupliquée.
 *
 * **La préférence vit dans le navigateur.** Pas de champ en base : ce serait une
 * migration pour une donnée que le navigateur conserve très bien, et qu'un
 * utilisateur non connecté doit pouvoir régler aussi. Au premier passage, la
 * langue vient de `navigator.language`.
 */

export const LOCALES = {
  fr: { code: 'fr', name: 'Français', nativeName: 'Français', dir: 'ltr' },
  ar: { code: 'ar', name: 'Arabe', nativeName: 'العربية', dir: 'rtl' },
};

const CLE = 'touma.locale';

/** Langue de départ : préférence enregistrée, sinon celle du navigateur. */
function localeInitiale() {
  try {
    const enregistree = localStorage.getItem(CLE);
    if (enregistree && LOCALES[enregistree]) return enregistree;
  } catch {
    // Navigation privée, stockage bloqué : ce n'est pas une panne, on continue.
  }
  const nav = (navigator.language || 'fr').slice(0, 2).toLowerCase();
  return LOCALES[nav] ? nav : 'fr';
}

let courante = localeInitiale();

export const locale = () => courante;
export const direction = () => LOCALES[courante].dir;
export const isRtl = () => direction() === 'rtl';

/**
 * Change la langue et applique le sens d'écriture.
 *
 * `lang` et `dir` sont posés sur `<html>` : c'est ce que lisent les lecteurs
 * d'écran pour choisir leur voix, et ce sur quoi la feuille de style s'appuie.
 */
export function setLocale(code) {
  if (!LOCALES[code]) return false;
  courante = code;
  try {
    localStorage.setItem(CLE, code);
  } catch {
    // Préférence non conservée : la langue change tout de même pour cette visite.
  }
  applyDocumentLocale();
  return true;
}

export function applyDocumentLocale() {
  const root = document.documentElement;
  root.setAttribute('lang', courante);
  root.setAttribute('dir', direction());
}

/**
 * Traduction d'une clé.
 *
 * Retombe sur le français, puis sur la clé elle-même. Une clé manquante affiche
 * donc du français — lisible — plutôt qu'un identifiant technique au milieu
 * d'une phrase.
 */
export function t(cle, variables) {
  const dict = DICTIONNAIRES[courante] ?? {};
  let texte = dict[cle] ?? DICTIONNAIRES.fr[cle] ?? cle;
  if (variables) {
    for (const [nom, valeur] of Object.entries(variables)) {
      texte = texte.replaceAll(`{${nom}}`, String(valeur));
    }
  }
  return texte;
}

/** Nombres et dates dans la langue courante. */
export const formatNumber = (n) => new Intl.NumberFormat(courante === 'ar' ? 'ar-TD' : 'fr-TD').format(n);

const FR = {
  // Ossature
  'nav.home': 'Accueil',
  'nav.catalog': 'Catalogue',
  'nav.stores': 'Boutiques',
  'nav.provinces': 'Provinces',
  'nav.business': 'Business',
  'nav.sourcing': 'Fournisseurs',
  'nav.cart': 'Panier',
  'nav.orders': 'Commandes',
  'nav.myOrders': 'Mes commandes',
  'nav.messages': 'Messages',
  'nav.sellerMessages': 'Messagerie vendeur',
  'nav.returns': 'Mes retours',
  'nav.disputes': 'Mes litiges',
  'nav.documents': 'Mes documents',
  'nav.support': 'Assistance',
  'nav.account': 'Mon compte',
  'nav.accountShort': 'Compte',
  'nav.seller': 'Espace vendeur',
  'nav.admin': 'Administration',
  'nav.login': 'Se connecter',
  'nav.loginShort': 'Connexion',
  'nav.logout': 'Se déconnecter',
  'nav.sell': 'Vendre sur TOUMA',
  'nav.menu': 'Menu',
  'nav.openMenu': 'Ouvrir le menu',
  'nav.closeMenu': 'Fermer le menu',
  'nav.skipToContent': 'Aller au contenu principal',
  'nav.quickNav': 'Navigation rapide',
  'nav.signedInAs': 'Connecté : {name}',

  // Recherche
  'search.label': 'Rechercher un produit ou une boutique',
  'search.placeholder': 'Que recherchez-vous ?',
  'search.submit': 'Rechercher',

  // Langue
  'locale.label': 'Langue',
  'locale.switchTo': 'Passer en {language}',
  'locale.coverage':
    'Le parcours d’achat est traduit : navigation, statuts, panier, commandes et tunnel de paiement. Les fiches produit détaillées, l’espace vendeur et l’administration restent en français pour l’instant.',

  // Actions communes
  'action.continue': 'Continuer',
  'action.cancel': 'Annuler',
  'action.confirm': 'Confirmer',
  'action.send': 'Envoyer',
  'action.save': 'Enregistrer',
  'action.back': 'Retour',
  'action.retry': 'Réessayer',
  'action.seeAll': 'Tout voir',

  // États et erreurs
  'state.loading': 'Chargement…',
  'state.empty': 'Rien à afficher',
  'state.offline': 'Vous êtes hors ligne.',
  'error.generic': 'Une erreur est survenue.',
  'error.network': 'Réseau indisponible. Réessayez dans un instant.',
  'error.notFound': 'Introuvable.',
  'error.unauthorized': 'Connectez-vous pour continuer.',

  // Marque
  'brand.tagline': 'Connecter le commerce africain',

  // Panier — l'écran où un acheteur décide avec son argent.
  'cart.title': 'Mon panier',
  'cart.emptyTitle': 'Votre panier est vide',
  'cart.emptyBody': 'Parcourez le catalogue pour trouver un fournisseur au Tchad ou au Cameroun.',
  'cart.emptyAction': 'Explorer le catalogue',
  'cart.summaryCount': '{items} article(s) · {stores} boutique(s)',
  'cart.unitPrice': '{price} l’unité',
  'cart.inStock': '{count} en stock',
  'cart.decrease': 'Diminuer la quantité',
  'cart.increase': 'Augmenter la quantité',
  'cart.quantityFor': 'Quantité pour {title}',
  'cart.remove': 'Retirer',
  'cart.subtotalFor': 'Sous-total {store}',
  'cart.clear': 'Vider le panier',
  'cart.recap': 'Récapitulatif',
  'cart.itemsLine': 'Articles ({count})',
  'cart.shipping': 'Livraison',
  'cart.shippingLater': 'calculée à l’étape suivante',
  'cart.subtotal': 'Sous-total',
  'cart.checkout': 'Continuer vers le paiement',
  'cart.fixIssues': 'Corrigez les lignes signalées avant de continuer.',
  'cart.onePerStore': 'Une commande distincte est créée par boutique : chaque vendeur gère sa préparation et son expédition.',

  // Anomalies d'une ligne de panier, renvoyées par le serveur sous forme de code.
  'cart.issue.PRODUCT_UNAVAILABLE': 'Ce produit n’est plus disponible',
  'cart.issue.VARIANT_UNAVAILABLE': 'Cette variante n’est plus disponible',
  'cart.issue.INSUFFICIENT_STOCK': 'Stock insuffisant',
  'cart.issue.PRICE_CHANGED': 'Le prix a changé depuis l’ajout',
  'cart.issue.BELOW_MIN_ORDER_QTY': 'Sous la quantité minimale de commande',

  // Liste des commandes.
  'orders.title': 'Mes commandes',
  'orders.emptyTitle': 'Aucune commande pour l’instant',
  'orders.emptyBody': 'Vos achats et leur suivi apparaîtront ici.',
  'orders.emptyAction': 'Explorer le catalogue',
  'orders.filterAll': 'Toutes',
  'orders.crossBorder': 'Transfrontalier',
  'orders.itemCount': '{count} article(s)',
  'orders.detail': 'Détail',
  'orders.tracking': 'Suivi {number}',
  'orders.noneInStatus': 'Aucune commande dans ce statut',
  'orders.tryAnotherFilter': 'Essayez un autre filtre.',

  // Tunnel de commande — l'écran où l'argent change de mains.
  'checkout.title': 'Commande',
  'checkout.step.address': 'Adresse',
  'checkout.step.shipping': 'Livraison',
  'checkout.step.payment': 'Paiement',
  'checkout.step.done': 'Confirmation',
  'checkout.emptyTitle': 'Votre panier est vide',
  'checkout.emptyBody': 'Ajoutez des produits avant de passer commande.',
  'checkout.emptyAction': 'Explorer le catalogue',

  'checkout.whereToDeliver': 'Où livrer votre commande ?',
  'checkout.noAddress': 'Aucune adresse enregistrée. Ajoutez-en une ci-dessous.',
  'checkout.addAddress': 'Ajouter une adresse',
  'checkout.fullName': 'Nom complet',
  'checkout.phone': 'Téléphone',
  'checkout.line1': 'Adresse ou rue',
  'checkout.district': 'Quartier',
  'checkout.districtHint': 'Souvent plus utile que le nom de rue pour trouver l’adresse.',
  'checkout.landmark': 'Point de repère',
  'checkout.landmarkPlaceholder': 'Face à la station Total, près du marché…',
  'checkout.city': 'Ville',
  'checkout.country': 'Pays',
  'checkout.instructions': 'Instructions pour le livreur',
  'checkout.instructionsPlaceholder': 'Appeler avant de passer…',
  'checkout.saveAddress': 'Enregistrer l’adresse',

  'checkout.deliveryMode': 'Mode de remise',
  'checkout.home': 'Livraison à mon adresse',
  'checkout.homeHint': 'Le transporteur vient au lieu indiqué.',
  'checkout.pickup': 'Retrait en point relais',
  'checkout.pickupHint': 'Souvent plus fiable et moins cher.',
  'checkout.pickupNone': 'Aucun point relais dans votre pays pour l’instant.',
  'checkout.pickupPoint': 'Point relais',
  'checkout.pickupNotice': 'Vous serez prévenu dès que le colis y sera déposé.',
  'checkout.toShipping': 'Continuer vers la livraison',

  'checkout.deliveryAddress': 'Adresse de livraison',
  'checkout.edit': 'Modifier',
  'checkout.chooseAddressFirst': 'Choisissez d’abord une adresse de livraison.',
  'checkout.crossBorder': 'Expédition transfrontalière',
  'checkout.eta': 'Livraison estimée en {min} à {max} jours · transporteur {carrier}',
  'checkout.toPayment': 'Continuer vers le paiement',
  'checkout.back': 'Retour',

  'checkout.discounts': 'Réductions',
  'checkout.couponCode': 'Code de réduction',
  'checkout.apply': 'Appliquer',
  'checkout.removeCoupon': 'Retirer',
  'checkout.couponApplied': '{label} appliqué',
  'checkout.loyaltyLabel': 'Points de fidélité ({count} utilisable(s), soit {value})',
  'checkout.use': 'Utiliser',
  'checkout.loyaltyHint': 'Vos points valent une remise immédiate sur cette commande.',
  'checkout.loyaltyNone': 'Aucun point de fidélité utilisable sur ce panier.',

  'checkout.paymentMethod': 'Moyen de paiement',
  'checkout.paymentNotice': 'Le paiement est confirmé par le serveur TOUMA auprès du prestataire. Aucune donnée bancaire n’est stockée par TOUMA.',
  'checkout.pay': 'Payer et confirmer la commande',
  'checkout.hint.MOBILE_MONEY': 'Paiement depuis votre portefeuille mobile.',
  'checkout.hint.CARD': 'Carte bancaire via une page sécurisée du prestataire.',
  'checkout.hint.BANK_TRANSFER': 'Virement bancaire avec référence de commande.',
  'checkout.hint.CASH_ON_DELIVERY': 'Réglez au livreur à la réception.',

  'checkout.thanks': 'Merci, votre commande est enregistrée',
  'checkout.severalOrders': '{count} commandes ont été créées, une par boutique.',
  'checkout.oneOrder': 'Votre commande a été transmise au vendeur.',
  'checkout.trackOrder': 'Suivre ma commande',
  'checkout.groupRecap': 'Récapitulatif du panier',
  'checkout.myOrders': 'Mes commandes',
  'checkout.keepShopping': 'Continuer mes achats',

  'summary.title': 'Récapitulatif',
  'summary.items': 'Articles ({count})',
  'summary.shipping': 'Livraison',
  'summary.shippingNext': 'à l’étape suivante',
  'summary.couponCode': 'Code {code}',
  'summary.loyaltyPoints': '{count} point(s) de fidélité',
  'summary.total': 'Total',

  // Catalogue — l'écran où l'on choisit.
  'home.verifiedStores': 'Boutiques vérifiées',
  'catalog.title': 'Catalogue',
  'catalog.home': 'Accueil',
  'catalog.allProducts': 'Tous les produits',
  'catalog.filterAndSort': 'Filtrer et trier',
  'catalog.keyword': 'Mot-clé',
  'catalog.category': 'Catégorie',
  'catalog.allCategories': 'Toutes les catégories',
  'catalog.shipsFrom': 'Pays d’expédition',
  'catalog.allCountries': 'Tous les pays',
  'catalog.priceRanges': 'Tranches de prix',
  'catalog.priceMin': 'Prix min.',
  'catalog.priceMax': 'Prix max.',
  'catalog.availability': 'Disponibilité',
  'catalog.inStockOnly': 'En stock uniquement',
  'catalog.sortBy': 'Trier par',
  'catalog.sort.recent': 'Plus récents',
  'catalog.sort.priceAsc': 'Prix croissant',
  'catalog.sort.priceDesc': 'Prix décroissant',
  'catalog.sort.popular': 'Les plus vendus',
  'catalog.apply': 'Appliquer',
  'catalog.reset': 'Réinitialiser',
  'catalog.noMatch': 'Aucun produit ne correspond',
  'catalog.noMatchBody': 'Élargissez vos critères : retirez un filtre, augmentez le prix maximum ou explorez une autre catégorie.',
  'catalog.seeAll': 'Voir tout le catalogue',

  // Fiche produit — ce qu'on achète, à quel prix, et si ça peut arriver.
  'product.breadcrumb': 'Produit',
  'product.verifiedSeller': 'Vendeur vérifié',
  'product.verificationPending': 'Vérification en cours',
  'product.shipsFrom': 'Expédié depuis {country}',
  'product.inStock': '{count} unité(s) disponible(s)',
  'product.outOfStock': 'Rupture de stock',
  'product.minOrder': 'commande minimale : {count}',
  'product.variant': 'Variante',
  'product.soldOut': 'épuisé',
  'product.quantity': 'Quantité',
  'product.buyNow': 'Acheter maintenant',
  'product.addToCart': 'Ajouter au panier',
  'product.contactSeller': 'Contacter le vendeur',
  'product.bulkPrompt': 'Besoin d’un volume important ?',
  'product.bulkLink': 'Publiez une demande d’achat',
  'product.shipping': 'Livraison',
  'product.shippingHint': 'Estimez le coût et le délai vers votre pays avant de commander.',
  'product.shipTo': 'Livrer vers',
  'product.estimate': 'Estimer',
  'product.availabilityTitle': 'Est-ce que ça arrive chez moi ?',
  'product.availabilityHint': 'Deux conditions, et les deux doivent être réunies : que la boutique accepte d’envoyer là-bas, et qu’un transporteur y aille.',
  'product.province': 'Province de livraison',
  'product.chooseProvince': 'Choisissez une province',
  'product.check': 'Vérifier',
  'product.description': 'Description',
  'product.noDescription': 'Le vendeur n’a pas encore rédigé de description.',
  'product.specs': 'Caractéristiques',
  'product.brand': 'Marque',
  'product.reference': 'Référence',
  'product.category': 'Catégorie',
  'product.weight': 'Poids unitaire',
  'product.minOrderQty': 'Quantité minimale',
  'product.noReviews': 'Aucun avis pour l’instant. Seuls les acheteurs ayant reçu ce produit peuvent en déposer un.',
};

/**
 * Arabe.
 *
 * Traduit pour l'ossature seulement, et c'est délibéré : une traduction
 * approximative de tout vaudrait moins qu'une traduction juste de ce qui sert
 * à tous les écrans. La couverture est annoncée à l'utilisateur.
 */
const AR = {
  'nav.home': 'الرئيسية',
  'nav.catalog': 'الكتالوج',
  'nav.stores': 'المتاجر',
  'nav.provinces': 'المقاطعات',
  'nav.business': 'الأعمال',
  'nav.sourcing': 'الموردون',
  'nav.cart': 'السلة',
  'nav.orders': 'الطلبات',
  'nav.myOrders': 'طلباتي',
  'nav.messages': 'الرسائل',
  'nav.sellerMessages': 'رسائل البائع',
  'nav.returns': 'مرتجعاتي',
  'nav.disputes': 'نزاعاتي',
  'nav.documents': 'مستنداتي',
  'nav.support': 'المساعدة',
  'nav.account': 'حسابي',
  'nav.accountShort': 'الحساب',
  'nav.seller': 'مساحة البائع',
  'nav.admin': 'الإدارة',
  'nav.login': 'تسجيل الدخول',
  'nav.loginShort': 'دخول',
  'nav.logout': 'تسجيل الخروج',
  'nav.sell': 'البيع على TOUMA',
  'nav.menu': 'القائمة',
  'nav.openMenu': 'فتح القائمة',
  'nav.closeMenu': 'إغلاق القائمة',
  'nav.skipToContent': 'الانتقال إلى المحتوى الرئيسي',
  'nav.quickNav': 'تنقل سريع',
  'nav.signedInAs': 'متصل: {name}',

  'search.label': 'ابحث عن منتج أو متجر',
  'search.placeholder': 'عن ماذا تبحث؟',
  'search.submit': 'بحث',

  'locale.label': 'اللغة',
  'locale.switchTo': 'التبديل إلى {language}',
  'locale.coverage':
    'تمت ترجمة مسار الشراء: التنقّل والحالات والسلة والطلبات ومسار الدفع. أما صفحات المنتج التفصيلية ومساحة البائع والإدارة فلا تزال بالفرنسية حالياً.',

  'action.continue': 'متابعة',
  'action.cancel': 'إلغاء',
  'action.confirm': 'تأكيد',
  'action.send': 'إرسال',
  'action.save': 'حفظ',
  'action.back': 'رجوع',
  'action.retry': 'إعادة المحاولة',
  'action.seeAll': 'عرض الكل',

  'state.loading': 'جارٍ التحميل…',
  'state.empty': 'لا شيء لعرضه',
  'state.offline': 'أنت غير متصل بالإنترنت.',
  'error.generic': 'حدث خطأ.',
  'error.network': 'الشبكة غير متاحة. أعد المحاولة بعد قليل.',
  'error.notFound': 'غير موجود.',
  'error.unauthorized': 'سجّل الدخول للمتابعة.',

  'brand.tagline': 'ربط التجارة الأفريقية',

  'cart.title': 'سلتي',
  'cart.emptyTitle': 'سلتك فارغة',
  'cart.emptyBody': 'تصفّح الكتالوج للعثور على مورّد في تشاد أو الكاميرون.',
  'cart.emptyAction': 'استكشاف الكتالوج',
  'cart.summaryCount': '{items} منتج · {stores} متجر',
  'cart.unitPrice': '{price} للوحدة',
  'cart.inStock': '{count} متوفّر',
  'cart.decrease': 'إنقاص الكمية',
  'cart.increase': 'زيادة الكمية',
  'cart.quantityFor': 'الكمية لـ {title}',
  'cart.remove': 'إزالة',
  'cart.subtotalFor': 'المجموع الفرعي لـ {store}',
  'cart.clear': 'إفراغ السلة',
  'cart.recap': 'الملخّص',
  'cart.itemsLine': 'المنتجات ({count})',
  'cart.shipping': 'الشحن',
  'cart.shippingLater': 'يُحتسب في الخطوة التالية',
  'cart.subtotal': 'المجموع الفرعي',
  'cart.checkout': 'المتابعة إلى الدفع',
  'cart.fixIssues': 'صحّح الأسطر المُشار إليها قبل المتابعة.',
  'cart.onePerStore': 'يُنشأ طلب منفصل لكل متجر: كل بائع يتولّى تحضيره وشحنه.',

  'cart.issue.PRODUCT_UNAVAILABLE': 'هذا المنتج لم يعد متاحاً',
  'cart.issue.VARIANT_UNAVAILABLE': 'هذا الخيار لم يعد متاحاً',
  'cart.issue.INSUFFICIENT_STOCK': 'المخزون غير كافٍ',
  'cart.issue.PRICE_CHANGED': 'تغيّر السعر منذ الإضافة',
  'cart.issue.BELOW_MIN_ORDER_QTY': 'أقل من الحد الأدنى للطلب',

  'orders.title': 'طلباتي',
  'orders.emptyTitle': 'لا توجد طلبات بعد',
  'orders.emptyBody': 'ستظهر هنا مشترياتك وتتبّعها.',
  'orders.emptyAction': 'استكشاف الكتالوج',
  'orders.filterAll': 'الكل',
  'orders.crossBorder': 'عبر الحدود',
  'orders.itemCount': '{count} منتج',
  'orders.detail': 'التفاصيل',
  'orders.tracking': 'التتبّع {number}',
  'orders.noneInStatus': 'لا توجد طلبات بهذه الحالة',
  'orders.tryAnotherFilter': 'جرّب مرشّحاً آخر.',

  'checkout.title': 'الطلب',
  'checkout.step.address': 'العنوان',
  'checkout.step.shipping': 'الشحن',
  'checkout.step.payment': 'الدفع',
  'checkout.step.done': 'التأكيد',
  'checkout.emptyTitle': 'سلتك فارغة',
  'checkout.emptyBody': 'أضف منتجات قبل إتمام الطلب.',
  'checkout.emptyAction': 'استكشاف الكتالوج',

  'checkout.whereToDeliver': 'أين نوصّل طلبك؟',
  'checkout.noAddress': 'لا يوجد عنوان محفوظ. أضف واحداً أدناه.',
  'checkout.addAddress': 'إضافة عنوان',
  'checkout.fullName': 'الاسم الكامل',
  'checkout.phone': 'الهاتف',
  'checkout.line1': 'العنوان أو الشارع',
  'checkout.district': 'الحي',
  'checkout.districtHint': 'غالباً أنفع من اسم الشارع للعثور على العنوان.',
  'checkout.landmark': 'علامة مميزة',
  'checkout.landmarkPlaceholder': 'مقابل محطة توتال، قرب السوق…',
  'checkout.city': 'المدينة',
  'checkout.country': 'البلد',
  'checkout.instructions': 'تعليمات لعامل التوصيل',
  'checkout.instructionsPlaceholder': 'اتّصل قبل المرور…',
  'checkout.saveAddress': 'حفظ العنوان',

  'checkout.deliveryMode': 'طريقة الاستلام',
  'checkout.home': 'التوصيل إلى عنواني',
  'checkout.homeHint': 'يأتي الناقل إلى المكان المحدّد.',
  'checkout.pickup': 'الاستلام من نقطة استلام',
  'checkout.pickupHint': 'غالباً أوثق وأقل كلفة.',
  'checkout.pickupNone': 'لا توجد نقطة استلام في بلدك حالياً.',
  'checkout.pickupPoint': 'نقطة الاستلام',
  'checkout.pickupNotice': 'سنُعلمك فور إيداع الطرد هناك.',
  'checkout.toShipping': 'المتابعة إلى الشحن',

  'checkout.deliveryAddress': 'عنوان التوصيل',
  'checkout.edit': 'تعديل',
  'checkout.chooseAddressFirst': 'اختر أولاً عنوان التوصيل.',
  'checkout.crossBorder': 'شحن عبر الحدود',
  'checkout.eta': 'التوصيل المقدّر خلال {min} إلى {max} يوماً · الناقل {carrier}',
  'checkout.toPayment': 'المتابعة إلى الدفع',
  'checkout.back': 'رجوع',

  'checkout.discounts': 'التخفيضات',
  'checkout.couponCode': 'رمز التخفيض',
  'checkout.apply': 'تطبيق',
  'checkout.removeCoupon': 'إزالة',
  'checkout.couponApplied': 'تم تطبيق {label}',
  'checkout.loyaltyLabel': 'نقاط الولاء ({count} قابلة للاستعمال، أي {value})',
  'checkout.use': 'استعمال',
  'checkout.loyaltyHint': 'نقاطك تساوي تخفيضاً فورياً على هذا الطلب.',
  'checkout.loyaltyNone': 'لا توجد نقاط ولاء قابلة للاستعمال على هذه السلة.',

  'checkout.paymentMethod': 'وسيلة الدفع',
  'checkout.paymentNotice': 'يؤكّد خادم TOUMA الدفع لدى المزوّد. لا تحتفظ TOUMA بأي بيانات مصرفية.',
  'checkout.pay': 'الدفع وتأكيد الطلب',
  'checkout.hint.MOBILE_MONEY': 'الدفع من محفظتك على الهاتف.',
  'checkout.hint.CARD': 'بطاقة مصرفية عبر صفحة آمنة لدى المزوّد.',
  'checkout.hint.BANK_TRANSFER': 'تحويل مصرفي مع مرجع الطلب.',
  'checkout.hint.CASH_ON_DELIVERY': 'الدفع لعامل التوصيل عند الاستلام.',

  'checkout.thanks': 'شكراً، تم تسجيل طلبك',
  'checkout.severalOrders': 'تم إنشاء {count} طلبات، واحد لكل متجر.',
  'checkout.oneOrder': 'أُرسل طلبك إلى البائع.',
  'checkout.trackOrder': 'تتبّع طلبي',
  'checkout.groupRecap': 'ملخّص السلة',
  'checkout.myOrders': 'طلباتي',
  'checkout.keepShopping': 'متابعة التسوّق',

  'summary.title': 'الملخّص',
  'summary.items': 'المنتجات ({count})',
  'summary.shipping': 'الشحن',
  'summary.shippingNext': 'في الخطوة التالية',
  'summary.couponCode': 'الرمز {code}',
  'summary.loyaltyPoints': '{count} نقطة ولاء',
  'summary.total': 'المجموع',

  'home.verifiedStores': 'متاجر موثّقة',
  'catalog.title': 'الكتالوج',
  'catalog.home': 'الرئيسية',
  'catalog.allProducts': 'كل المنتجات',
  'catalog.filterAndSort': 'التصفية والترتيب',
  'catalog.keyword': 'كلمة مفتاحية',
  'catalog.category': 'الفئة',
  'catalog.allCategories': 'كل الفئات',
  'catalog.shipsFrom': 'بلد الشحن',
  'catalog.allCountries': 'كل البلدان',
  'catalog.priceRanges': 'نطاقات السعر',
  'catalog.priceMin': 'أدنى سعر',
  'catalog.priceMax': 'أقصى سعر',
  'catalog.availability': 'التوفّر',
  'catalog.inStockOnly': 'المتوفّر فقط',
  'catalog.sortBy': 'الترتيب حسب',
  'catalog.sort.recent': 'الأحدث',
  'catalog.sort.priceAsc': 'السعر تصاعدياً',
  'catalog.sort.priceDesc': 'السعر تنازلياً',
  'catalog.sort.popular': 'الأكثر مبيعاً',
  'catalog.apply': 'تطبيق',
  'catalog.reset': 'إعادة الضبط',
  'catalog.noMatch': 'لا يوجد منتج مطابق',
  'catalog.noMatchBody': 'وسّع معاييرك: أزل مرشّحاً، أو ارفع الحد الأقصى للسعر، أو استكشف فئة أخرى.',
  'catalog.seeAll': 'عرض الكتالوج كاملاً',

  'product.breadcrumb': 'المنتج',
  'product.verifiedSeller': 'بائع موثّق',
  'product.verificationPending': 'التوثيق قيد المراجعة',
  'product.shipsFrom': 'يُشحن من {country}',
  'product.inStock': '{count} وحدة متوفّرة',
  'product.outOfStock': 'نفد المخزون',
  'product.minOrder': 'الحد الأدنى للطلب: {count}',
  'product.variant': 'الخيار',
  'product.soldOut': 'نفد',
  'product.quantity': 'الكمية',
  'product.buyNow': 'الشراء الآن',
  'product.addToCart': 'أضف إلى السلة',
  'product.contactSeller': 'مراسلة البائع',
  'product.bulkPrompt': 'تحتاج كمية كبيرة؟',
  'product.bulkLink': 'انشر طلب شراء',
  'product.shipping': 'الشحن',
  'product.shippingHint': 'قدّر التكلفة والمدة إلى بلدك قبل الطلب.',
  'product.shipTo': 'الشحن إلى',
  'product.estimate': 'تقدير',
  'product.availabilityTitle': 'هل يصل إليّ؟',
  'product.availabilityHint': 'شرطان، ولا بدّ من توفّرهما معاً: أن يقبل المتجر الإرسال إلى هناك، وأن يذهب ناقل إلى المكان.',
  'product.province': 'مقاطعة التوصيل',
  'product.chooseProvince': 'اختر مقاطعة',
  'product.check': 'تحقّق',
  'product.description': 'الوصف',
  'product.noDescription': 'لم يكتب البائع وصفاً بعد.',
  'product.specs': 'المواصفات',
  'product.brand': 'العلامة',
  'product.reference': 'المرجع',
  'product.category': 'الفئة',
  'product.weight': 'وزن الوحدة',
  'product.minOrderQty': 'الحد الأدنى للكمية',
  'product.noReviews': 'لا توجد تقييمات بعد. لا يمكن تقييم هذا المنتج إلا لمن استلمه.',
};

/**
 * Statuts, rôles et moyens de paiement.
 *
 * Séparés du reste parce qu'ils viennent du serveur sous forme de code
 * (`SHIPPED`, `MOBILE_MONEY`) : ce sont les mêmes valeurs partout, et les
 * traduire ici les traduit sur tous les écrans d'un coup — y compris ceux qui
 * ne sont pas encore traduits par ailleurs.
 */
export const STATUS_FR = {
  PENDING: 'En attente de paiement',
  PAID: 'Payée',
  CONFIRMED: 'Confirmée',
  PROCESSING: 'En préparation',
  READY_TO_SHIP: 'Prête à expédier',
  SHIPPED: 'Expédiée',
  PARTIALLY_SHIPPED: 'Partiellement expédiée',
  PARTIALLY_DELIVERED: 'Partiellement livrée',
  IN_TRANSIT: 'En transit',
  DELIVERED: 'Livrée',
  COMPLETED: 'Terminée',
  CANCELLED: 'Annulée',
  REFUNDED: 'Remboursée',
  DISPUTED: 'En litige',
  LABEL_CREATED: 'Étiquette créée',
  FAILED: 'Échec',
  RETURNED: 'Retournée',
  SUCCEEDED: 'Confirmé',
  PARTIALLY_REFUNDED: 'Partiellement remboursé',
  UNVERIFIED: 'Non vérifiée',
  APPROVED: 'Vérifiée',
  REJECTED: 'Refusée',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspendue',
  DRAFT: 'Brouillon',
  ARCHIVED: 'Archivé',
  CLOSED: 'Fermée',
  OPEN: 'Ouvert',
  UNDER_REVIEW: 'En cours d’examen',
  BUYER: 'Acheteur',
  SELLER: 'Vendeur',
  ADMIN: 'Administration',
  MOBILE_MONEY: 'Mobile money',
  CARD: 'Carte bancaire',
  BANK_TRANSFER: 'Virement bancaire',
  CASH_ON_DELIVERY: 'Paiement à la livraison',
};

const STATUS_AR = {
  PENDING: 'في انتظار الدفع',
  PAID: 'مدفوعة',
  CONFIRMED: 'مؤكدة',
  PROCESSING: 'قيد التحضير',
  READY_TO_SHIP: 'جاهزة للشحن',
  SHIPPED: 'تم شحنها',
  PARTIALLY_SHIPPED: 'مشحونة جزئياً',
  PARTIALLY_DELIVERED: 'مسلّمة جزئياً',
  IN_TRANSIT: 'في الطريق',
  DELIVERED: 'تم التسليم',
  COMPLETED: 'منتهية',
  CANCELLED: 'ملغاة',
  REFUNDED: 'مستردة',
  DISPUTED: 'قيد النزاع',
  LABEL_CREATED: 'تم إنشاء بطاقة الشحن',
  FAILED: 'فشل',
  RETURNED: 'مُرجعة',
  SUCCEEDED: 'مؤكد',
  PARTIALLY_REFUNDED: 'مسترد جزئياً',
  UNVERIFIED: 'غير موثّق',
  APPROVED: 'موثّق',
  REJECTED: 'مرفوضة',
  ACTIVE: 'نشطة',
  SUSPENDED: 'موقوفة',
  DRAFT: 'مسودة',
  ARCHIVED: 'مؤرشف',
  CLOSED: 'مغلقة',
  OPEN: 'مفتوح',
  UNDER_REVIEW: 'قيد المراجعة',
  BUYER: 'مشترٍ',
  SELLER: 'بائع',
  ADMIN: 'الإدارة',
  MOBILE_MONEY: 'المحفظة الإلكترونية',
  CARD: 'بطاقة مصرفية',
  BANK_TRANSFER: 'تحويل مصرفي',
  CASH_ON_DELIVERY: 'الدفع عند الاستلام',
};

const DICTIONNAIRES = { fr: FR, ar: AR };
const STATUTS = { fr: STATUS_FR, ar: STATUS_AR };

/** Libellé d'un statut serveur, dans la langue courante. */
export function statusLabel(code) {
  const dict = STATUTS[courante] ?? STATUS_FR;
  return dict[code] ?? STATUS_FR[code] ?? code ?? '';
}

applyDocumentLocale();
