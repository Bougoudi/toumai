/**
 * Français et arabe pour la vitrine publique (§62).
 *
 * L'application est bilingue depuis V17 ; la vitrine ne l'était pas. Elle est
 * pourtant la seule des deux qu'un inconnu rencontre : c'est elle que renvoie
 * un moteur de recherche, elle qu'on ouvre depuis un lien reçu, et elle qui
 * décide si quelqu'un crée un compte. Un arabophone du Tchad — où l'arabe est
 * langue officielle au même titre que le français — arrivait donc sur une
 * porte d'entrée qu'il ne pouvait pas lire, avant d'atteindre une application
 * qui, elle, lui parlait.
 *
 * **Les adresses françaises ne bougent pas.** `/produits`, `/trade/tchad-cameroun`
 * restent où elles sont : l'arabe vit sous `/ar/…`. Déplacer le français sous
 * `/fr/…` aurait cassé les URL canoniques, le plan du site et les liens déjà
 * partagés, pour un gain nul. Les deux versions se déclarent l'une l'autre par
 * `hreflang`, ce qui est la façon dont un moteur comprend qu'il s'agit d'une
 * même page en deux langues et non de deux contenus dupliqués.
 *
 * **La parité est vérifiée à la compilation, pas à l'exécution.** `AR` est
 * typé `Record<Cle, string>` où `Cle` dérive de `FR` : ajouter une clé
 * française sans sa traduction arabe fait échouer `npm run typecheck`. Un test
 * complète ce que le typage ne peut pas voir — que l'arabe est bien écrit en
 * caractères arabes, et pas recopié du français.
 *
 * **Le sens d'écriture suit la langue.** `dir="rtl"` est posé sur la racine du
 * document. La feuille de style de la vitrine n'emploie aucune propriété
 * latérale (`margin-left`, `float`, `text-align: left`) : le miroir est donc
 * complet sans une seule règle dupliquée.
 *
 * **Ce qui n'est pas traduit, et pourquoi.** Le contenu saisi par les vendeurs
 * — titre de produit, description, nom de boutique — reste tel qu'il a été
 * écrit. Le traduire automatiquement ferait qu'un acheteur et un vendeur ne
 * parleraient plus du même objet, et une erreur de traduction sur une fiche
 * produit est une erreur commerciale. Les codes de moyens de paiement et de
 * transporteurs restent eux aussi tels quels : ce sont des identifiants.
 */

export const LANGUES = ['fr', 'ar'] as const;
export type Langue = (typeof LANGUES)[number];

/** Langue servie aux adresses sans préfixe. */
export const LANGUE_PAR_DEFAUT: Langue = 'fr';

export const DIRECTION: Record<Langue, 'ltr' | 'rtl'> = { fr: 'ltr', ar: 'rtl' };

/** Nom de la langue dans cette langue : jamais « Arabe » dans un menu arabe. */
export const NOM_NATIF: Record<Langue, string> = { fr: 'Français', ar: 'العربية' };

/**
 * Locale OpenGraph.
 *
 * `ar_TD` plutôt que `ar` : l'arabe de la vitrine est celui du marché pilote,
 * et une locale régionale est plus juste qu'une locale générique pour un
 * contenu dont les exemples, les devises et les corridors sont tchadiens.
 */
export const LOCALE_OG: Record<Langue, string> = { fr: 'fr_FR', ar: 'ar_TD' };

/**
 * Noms de pays en arabe.
 *
 * L'API renvoie un nom français (`Tchad`). Sur une page arabe, il détonne — et
 * surtout, un nom propre latin au milieu d'un texte droite-à-gauche se
 * réordonne mal à l'affichage. La table couvre les pays réellement configurés ;
 * pour tout autre, on retombe sur le nom fourni par le serveur plutôt que
 * d'inventer une translittération.
 */
const PAYS_AR: Record<string, string> = {
  CI: 'كوت ديفوار',
  CM: 'الكاميرون',
  GH: 'غانا',
  KE: 'كينيا',
  NG: 'نيجيريا',
  SN: 'السنغال',
  TD: 'تشاد',
};

/** Nom d'un pays dans la langue de lecture, ou celui du serveur à défaut. */
export function nomPays(langue: Langue, code: string, nomServeur?: string | null): string {
  if (langue === 'ar') return PAYS_AR[code.toUpperCase()] ?? nomServeur ?? code;
  return nomServeur ?? code;
}

const FR = {
  // — Ossature —
  'site.titre': 'TOUMA — place de marché du commerce africain',
  'site.gabaritTitre': '%s — TOUMA',
  'site.description':
    "Acheter et vendre entre pays africains : catalogue, paiement, livraison, appels d'offres et négociation. Corridor pilote Tchad ↔ Cameroun.",
  'nav.aria': 'Navigation principale',
  'nav.catalogue': 'Catalogue',
  'nav.corridors': 'Corridors',
  'nav.compte': 'Mon compte',
  'nav.ouvrirBoutique': 'Ouvrir une boutique',
  'langue.aria': 'Langue',
  'banniere.un': 'Corridor ouvert : {liste}',
  'banniere.plusieurs': 'Corridors ouverts : {liste}',
  'pied.mention':
    'TOUMA — place de marché du commerce africain. Les vendeurs vérifiés ont fourni des justificatifs contrôlés par notre équipe ; cette vérification ne constitue pas une garantie de la transaction.',
  'pied.assistance': 'Assistance',
  'pied.api': 'API',
  'pied.confidentialite': 'Confidentialité',

  // — Accueil —
  'accueil.titre': 'Connecter le commerce africain',
  'accueil.lede':
    "Acheter et vendre entre le Tchad et le Cameroun : catalogue vérifié, paiement encadré, livraison suivie, appels d'offres et négociation entre entreprises.",
  'accueil.voirCatalogue': 'Voir le catalogue',
  'accueil.derniersProduits': 'Derniers produits',

  // — Produits —
  'produits.aucun': 'Aucun produit pour le moment.',
  'produits.quantiteMini': 'à partir de {n} unités',
  'produits.enStock': 'En stock',
  'produits.rupture': 'Rupture',
  'produits.enStockAvecNombre': 'En stock ({n})',

  // — Catalogue —
  'catalogue.titre': 'Catalogue',
  'catalogue.description':
    'Tous les produits disponibles sur TOUMA : agroalimentaire, textile, matériaux et équipements.',
  'catalogue.recherche': 'Recherche : {q}',
  'catalogue.parPays': 'Catalogue — {pays}',
  'catalogue.compte': '{total} produit(s) — page {page} sur {pages}.',
  'catalogue.pagination': 'Pagination',
  'catalogue.pagePrecedente': 'Page précédente',
  'catalogue.pageSuivante': 'Page suivante',
  'catalogue.indisponible': 'Le catalogue est momentanément indisponible. Réessayez dans un instant.',

  // — Fiche produit —
  'fiche.introuvable': 'Produit introuvable',
  'fiche.descriptionDefaut': '{titre} — vendu par {boutique} ({pays}) sur TOUMA.',
  'fiche.venduPar': 'Vendu par {boutique}',
  'fiche.venduParVille': 'Vendu par {boutique} — {ville}',
  'fiche.reference': 'Référence',
  'fiche.marque': 'Marque',
  'fiche.quantiteMinimale': 'Quantité minimale',
  'fiche.poidsUnitaire': 'Poids unitaire',
  'fiche.grammes': '{n} g',
  'fiche.expedieDepuis': 'Expédié depuis',
  'fiche.origineMarchandise': 'Origine de la marchandise',
  'fiche.origine.VERIFIED': 'Vérifiée sur pièces par TOUMA.',
  'fiche.origine.DISPUTED': 'Contestée : cette déclaration fait l’objet d’un examen.',
  'fiche.origine.DECLARED': 'Déclarée par le vendeur. TOUMA ne l’a pas vérifiée.',
  'fiche.commander': 'Commander sur TOUMA',
  'fiche.vendeurVerifie':
    'Vendeur vérifié : ses pièces justificatives ont été contrôlées. Cette vérification ne garantit pas la transaction.',
  'fiche.vendeurNonVerifie': 'Ce vendeur n’a pas encore été vérifié.',
  'fiche.avis': 'Avis',
  'fiche.note': '{note}/5 — {auteur}',
  'fiche.acheteur': 'Acheteur',

  // — Corridors —
  'corridors.titre': 'Corridors',
  'corridors.description':
    'Les corridors de commerce transfrontalier ouverts sur TOUMA, et ce qui manque à ceux qui ne le sont pas encore.',
  'corridors.lede':
    'Un corridor n’est opérationnel que si un moyen de paiement et un transporteur le couvrent réellement des deux côtés. Le statut déclaré par l’exploitant ne suffit pas, et les deux sont affichés séparément.',
  'corridors.statutDeclare': 'Statut déclaré : {statut}',
  'corridors.operationnel': 'Opérationnel',
  'corridors.pasOperationnel': 'Pas encore opérationnel',
  'corridors.ouverts': 'Corridors opérationnels',
  'corridors.aucunOuvert': 'Aucun corridor n’est opérationnel aujourd’hui.',
  'corridors.autres': 'Configurés, pas encore opérationnels',
  'corridors.indisponible': 'L’état des corridors est momentanément indisponible. Réessayez dans un instant.',

  // — Corridor —
  'corridor.titre': 'Commerce {depart} → {arrivee}',
  'corridor.generique': 'Corridor',
  'corridor.introuvable': 'Corridor introuvable',
  'corridor.descriptionOuvert':
    'Acheter et vendre sur le corridor {depart} → {arrivee} de TOUMA : moyens de paiement disponibles des deux côtés, transporteurs couvrant le corridor, documents commerciaux et suivi de commande.',
  'corridor.descriptionFerme':
    'Le corridor {depart} → {arrivee} est configuré sur TOUMA mais n’est pas encore opérationnel. Cette page dit ce qui manque pour qu’il le devienne.',
  'corridor.ledeOuvert':
    'Les commandes {depart} → {arrivee} peuvent être passées : un moyen de paiement et un transporteur couvrent réellement ce corridor.',
  'corridor.ledeFerme':
    'Ce corridor est configuré mais n’est pas opérationnel aujourd’hui. Aucune commande {depart} → {arrivee} ne peut aboutir tant que les points ci-dessous ne sont pas levés.',
  'corridor.etat': 'État du corridor',
  'corridor.statutDeclare': 'Statut déclaré',
  'corridor.fonctionne': 'Fonctionne réellement',
  'corridor.oui': 'oui',
  'corridor.non': 'non',
  'corridor.ceQuiManque': 'Ce qui manque',
  'corridor.disponible': 'Ce qui est disponible',
  'corridor.moyensPaiement': 'Moyens de paiement',
  'corridor.aucunMoyenPaiement': 'Aucun moyen de paiement n’est disponible des deux côtés de ce corridor.',
  'corridor.transporteurs': 'Transporteurs',
  'corridor.aucunTransporteur': 'Aucun transporteur enregistré ne couvre les deux pays.',
  'corridor.devises': 'Devises',
  'corridor.aucuneDevise': 'Aucune devise déclarée.',
  'corridor.delaiTransit': 'Délai de transit',
  'corridor.delaiAnnonce':
    '{min} à {max} jours, annoncés par les transporteurs. Ce n’est pas un engagement de TOUMA.',
  'corridor.estimationIndisponible': 'Estimation indisponible.',
  'corridor.documents': 'Documents attendus',
  'corridor.documentsMention':
    'Cette liste est celle configurée pour ce corridor sur TOUMA. Elle ne remplace pas les exigences des administrations douanières et fiscales des deux pays, qui font foi.',
  'corridor.itineraires': 'Itinéraires',
  'corridor.sourceLabel': '— source :',
  'corridor.aucuneSource': '— aucune source déclarée',
  'corridor.produitsAuDepart': 'Produits en catalogue au départ — {pays}',
  'corridor.voirTout': 'Voir tout le catalogue — {pays}',
  'corridor.aucunProduit': 'Aucun produit n’est actuellement en catalogue au départ de ce pays.',
  'corridor.typeService': 'Place de marché pour le commerce transfrontalier',

  // — Types de documents commerciaux (`TradeDocumentKind`) —
  'doc.COMMERCIAL_INVOICE': 'Facture commerciale',
  'doc.PROFORMA_INVOICE': 'Facture proforma',
  'doc.PACKING_LIST': 'Liste de colisage',
  'doc.PURCHASE_ORDER': 'Bon de commande',
  'doc.CERTIFICATE_OF_ORIGIN': 'Certificat d’origine',
  'doc.SHIPPING_DOCUMENT': 'Document de transport',
  'doc.OTHER': 'Autre document',

  // — Statuts déclarés d'un corridor (`TradeCorridorStatus`) —
  'statutCorridor.ACTIVE': 'ouvert',
  'statutCorridor.LIMITED': 'ouvert avec restrictions',
  'statutCorridor.COMING_SOON': 'annoncé, pas encore ouvert',
  'statutCorridor.SUSPENDED': 'suspendu',
  'statutCorridor.CLOSED': 'fermé',

  // — Motifs de blocage (`CorridorBlocker['code']`) —
  'blocage.CORRIDOR_NOT_CONFIGURED': 'Aucun corridor configuré de {origin} vers {destination}.',
  'blocage.ORIGIN_TRADE_DISABLED': 'Le pays {country} n’est pas ouvert au commerce transfrontalier.',
  'blocage.DESTINATION_TRADE_DISABLED': 'Le pays {country} n’est pas ouvert au commerce transfrontalier.',
  'blocage.NO_SHARED_PAYMENT_METHOD': 'Aucun moyen de paiement n’est disponible des deux côtés de ce corridor.',
  'blocage.NO_CARRIER_COVERING_BOTH': 'Aucun transporteur enregistré ne couvre les deux pays de ce corridor.',
  'blocage.ONLY_SIMULATED_CARRIER':
    'Aucun transporteur réel ne couvre les deux pays de ce corridor : seul un adaptateur de simulation est enregistré ({providers}), et une simulation n’achemine aucun colis.',
  'blocage.NO_DECLARED_CURRENCY': 'Aucune devise n’est déclarée pour ce corridor.',
  'blocage.CORRIDOR_SUSPENDED': 'Le corridor est suspendu par l’exploitant.',
  'blocage.CORRIDOR_NOT_YET_OPEN': 'Le corridor n’est pas encore ouvert.',
} as const;

export type Cle = keyof typeof FR;

/**
 * Le typage fait tout le travail : `Record<Cle, string>` refuse de compiler
 * s'il manque une clé. C'est le seul garde-fou qui ne peut pas être oublié,
 * parce qu'il est dans le chemin de la compilation et non dans un test qu'on
 * peut ne pas lancer.
 */
const AR: Record<Cle, string> = {
  'site.titre': 'تومّا — سوق التجارة الأفريقية',
  'site.gabaritTitre': '%s — تومّا',
  'site.description':
    'البيع والشراء بين البلدان الأفريقية: كتالوج، دفع، تسليم، طلبات عروض وتفاوض. الممر التجريبي تشاد ↔ الكاميرون.',
  'nav.aria': 'التنقّل الرئيسي',
  'nav.catalogue': 'الكتالوج',
  'nav.corridors': 'الممرات',
  'nav.compte': 'حسابي',
  'nav.ouvrirBoutique': 'افتح متجرًا',
  'langue.aria': 'اللغة',
  'banniere.un': 'ممر مفتوح: {liste}',
  'banniere.plusieurs': 'ممرات مفتوحة: {liste}',
  'pied.mention':
    'تومّا — سوق التجارة الأفريقية. البائعون المُوثَّقون قدّموا مستندات راجعها فريقنا؛ هذا التوثيق ليس ضمانًا للمعاملة.',
  'pied.assistance': 'المساعدة',
  'pied.api': 'واجهة البرمجة',
  'pied.confidentialite': 'الخصوصية',

  'accueil.titre': 'نربط التجارة الأفريقية',
  'accueil.lede':
    'البيع والشراء بين تشاد والكاميرون: كتالوج موثَّق، دفع مؤطَّر، تسليم متتبَّع، طلبات عروض وتفاوض بين الشركات.',
  'accueil.voirCatalogue': 'تصفّح الكتالوج',
  'accueil.derniersProduits': 'أحدث المنتجات',

  'produits.aucun': 'لا توجد منتجات حاليًا.',
  'produits.quantiteMini': 'ابتداءً من {n} وحدة',
  'produits.enStock': 'متوفّر',
  'produits.rupture': 'نفد المخزون',
  'produits.enStockAvecNombre': 'متوفّر ({n})',

  'catalogue.titre': 'الكتالوج',
  'catalogue.description': 'كل المنتجات المتاحة على تومّا: أغذية، نسيج، مواد بناء ومعدّات.',
  'catalogue.recherche': 'البحث: {q}',
  'catalogue.parPays': 'الكتالوج — {pays}',
  'catalogue.compte': 'عدد المنتجات: {total} — الصفحة {page} من {pages}.',
  'catalogue.pagination': 'تصفّح الصفحات',
  'catalogue.pagePrecedente': 'الصفحة السابقة',
  'catalogue.pageSuivante': 'الصفحة التالية',
  'catalogue.indisponible': 'الكتالوج غير متاح مؤقتًا. أعد المحاولة بعد قليل.',

  'fiche.introuvable': 'المنتج غير موجود',
  'fiche.descriptionDefaut': '{titre} — يبيعه {boutique} ({pays}) على تومّا.',
  'fiche.venduPar': 'يبيعه {boutique}',
  'fiche.venduParVille': 'يبيعه {boutique} — {ville}',
  'fiche.reference': 'المرجع',
  'fiche.marque': 'العلامة التجارية',
  'fiche.quantiteMinimale': 'الكمية الدنيا',
  'fiche.poidsUnitaire': 'وزن الوحدة',
  'fiche.grammes': '{n} غرام',
  'fiche.expedieDepuis': 'يُشحن من',
  'fiche.origineMarchandise': 'منشأ البضاعة',
  'fiche.origine.VERIFIED': 'تحقّقت منه تومّا بالمستندات.',
  'fiche.origine.DISPUTED': 'محلّ نزاع: هذا الإقرار قيد المراجعة.',
  'fiche.origine.DECLARED': 'أقرّ به البائع. لم تتحقّق منه تومّا.',
  'fiche.commander': 'اطلب على تومّا',
  'fiche.vendeurVerifie': 'بائع موثَّق: رُوجعت مستنداته. هذا التوثيق لا يضمن المعاملة.',
  'fiche.vendeurNonVerifie': 'هذا البائع لم يُوثَّق بعد.',
  'fiche.avis': 'التقييمات',
  'fiche.note': 'التقييم {note}/5 — {auteur}',
  'fiche.acheteur': 'مشترٍ',

  'corridors.titre': 'الممرات',
  'corridors.description': 'ممرات التجارة العابرة للحدود المفتوحة على تومّا، وما ينقص غير المفتوحة منها.',
  'corridors.lede':
    'لا يكون الممر عاملًا إلا إذا غطّته وسيلة دفع وناقل فعليًّا من الطرفين. الحالة التي يُعلنها المُشغِّل لا تكفي، والاثنتان تُعرضان منفصلتين.',
  'corridors.statutDeclare': 'الحالة المُعلَنة: {statut}',
  'corridors.operationnel': 'عامل',
  'corridors.pasOperationnel': 'غير عامل بعد',
  'corridors.ouverts': 'الممرات العاملة',
  'corridors.aucunOuvert': 'لا يوجد ممر عامل اليوم.',
  'corridors.autres': 'مُهيّأة، وغير عاملة بعد',
  'corridors.indisponible': 'حالة الممرات غير متاحة مؤقتًا. أعد المحاولة بعد قليل.',

  'corridor.titre': 'التجارة {depart} → {arrivee}',
  'corridor.generique': 'ممر',
  'corridor.introuvable': 'الممر غير موجود',
  'corridor.descriptionOuvert':
    'البيع والشراء على ممر {depart} → {arrivee} في تومّا: وسائل دفع متاحة من الطرفين، ناقلون يغطّون الممر، مستندات تجارية وتتبّع الطلب.',
  'corridor.descriptionFerme':
    'ممر {depart} → {arrivee} مُهيّأ على تومّا لكنه غير عامل بعد. هذه الصفحة تبيّن ما ينقصه ليصبح عاملًا.',
  'corridor.ledeOuvert':
    'يمكن تمرير الطلبات {depart} → {arrivee}: وسيلة دفع وناقل يغطّيان هذا الممر فعليًّا.',
  'corridor.ledeFerme':
    'هذا الممر مُهيّأ لكنه غير عامل اليوم. لا يمكن إتمام أي طلب {depart} → {arrivee} ما لم تُرفع النقاط أدناه.',
  'corridor.etat': 'حالة الممر',
  'corridor.statutDeclare': 'الحالة المُعلَنة',
  'corridor.fonctionne': 'يعمل فعليًّا',
  'corridor.oui': 'نعم',
  'corridor.non': 'لا',
  'corridor.ceQuiManque': 'ما ينقص',
  'corridor.disponible': 'ما هو متاح',
  'corridor.moyensPaiement': 'وسائل الدفع',
  'corridor.aucunMoyenPaiement': 'لا تتوفر وسيلة دفع على طرفَي هذا الممر.',
  'corridor.transporteurs': 'الناقلون',
  'corridor.aucunTransporteur': 'لا يوجد ناقل مسجَّل يغطي البلدين.',
  'corridor.devises': 'العملات',
  'corridor.aucuneDevise': 'لم تُعلَن أي عملة.',
  'corridor.delaiTransit': 'مدة العبور',
  'corridor.delaiAnnonce': 'من {min} إلى {max} يومًا، حسب إعلان الناقلين. هذا ليس التزامًا من تومّا.',
  'corridor.estimationIndisponible': 'التقدير غير متاح.',
  'corridor.documents': 'المستندات المطلوبة',
  'corridor.documentsMention':
    'هذه القائمة هي المُهيّأة لهذا الممر على تومّا. وهي لا تحلّ محلّ متطلبات إدارات الجمارك والضرائب في البلدين، وهي المرجع.',
  'corridor.itineraires': 'المسارات',
  'corridor.sourceLabel': '— المصدر:',
  'corridor.aucuneSource': '— لا مصدر مُعلَن',
  'corridor.produitsAuDepart': 'منتجات في الكتالوج انطلاقًا من — {pays}',
  'corridor.voirTout': 'عرض كامل الكتالوج — {pays}',
  'corridor.aucunProduit': 'لا يوجد حاليًا أي منتج في الكتالوج انطلاقًا من هذا البلد.',
  'corridor.typeService': 'سوق للتجارة العابرة للحدود',

  'doc.COMMERCIAL_INVOICE': 'فاتورة تجارية',
  'doc.PROFORMA_INVOICE': 'فاتورة مبدئية',
  'doc.PACKING_LIST': 'قائمة التعبئة',
  'doc.PURCHASE_ORDER': 'أمر شراء',
  'doc.CERTIFICATE_OF_ORIGIN': 'شهادة منشأ',
  'doc.SHIPPING_DOCUMENT': 'مستند نقل',
  'doc.OTHER': 'مستند آخر',

  'statutCorridor.ACTIVE': 'مفتوح',
  'statutCorridor.LIMITED': 'مفتوح بقيود',
  'statutCorridor.COMING_SOON': 'مُعلَن، ولم يُفتح بعد',
  'statutCorridor.SUSPENDED': 'مُعلَّق',
  'statutCorridor.CLOSED': 'مغلق',

  'blocage.CORRIDOR_NOT_CONFIGURED': 'لا يوجد ممر مُهيّأ من {origin} إلى {destination}.',
  'blocage.ORIGIN_TRADE_DISABLED': 'بلد {country} غير مفتوح للتجارة العابرة للحدود.',
  'blocage.DESTINATION_TRADE_DISABLED': 'بلد {country} غير مفتوح للتجارة العابرة للحدود.',
  'blocage.NO_SHARED_PAYMENT_METHOD': 'لا تتوفر وسيلة دفع على طرفَي هذا الممر.',
  'blocage.NO_CARRIER_COVERING_BOTH': 'لا يوجد ناقل مسجَّل يغطي بلدَي هذا الممر.',
  'blocage.ONLY_SIMULATED_CARRIER':
    'لا يوجد ناقل حقيقي يغطي بلدَي هذا الممر: المسجَّل هو محاكاة فقط ({providers})، والمحاكاة لا تنقل أي طرد.',
  'blocage.NO_DECLARED_CURRENCY': 'لم تُعلَن أي عملة لهذا الممر.',
  'blocage.CORRIDOR_SUSPENDED': 'الممر مُعلَّق من قِبل المُشغِّل.',
  'blocage.CORRIDOR_NOT_YET_OPEN': 'الممر لم يُفتَح بعد.',
};

export const DICTIONNAIRES: Record<Langue, Record<Cle, string>> = { fr: FR, ar: AR };

/**
 * Traduit une clé, en substituant `{nom}` par les paramètres fournis.
 *
 * Une clé absente ne peut pas arriver : `Cle` est vérifié à la compilation.
 * Un paramètre absent, si — et le `{nom}` resterait alors visible à l'écran,
 * ce qu'un test refuse.
 */
export function t(langue: Langue, cle: Cle, params: Record<string, string | number> = {}): string {
  return DICTIONNAIRES[langue][cle].replace(/\{(\w+)\}/g, (brut, nom: string) => {
    const valeur = params[nom];
    return valeur === undefined ? brut : String(valeur);
  });
}

/**
 * Adresse d'une page dans une langue donnée.
 *
 * Le français vit à la racine, l'arabe sous `/ar`. Tout lien de la vitrine
 * passe par ici : un `href` écrit en dur enverrait un lecteur arabe sur la
 * version française sans prévenir, et c'est le genre de fuite qui ne se voit
 * qu'en naviguant.
 */
export function chemin(langue: Langue, cheminFr: string): string {
  const normalise = cheminFr.startsWith('/') ? cheminFr : `/${cheminFr}`;
  if (langue === LANGUE_PAR_DEFAUT) return normalise;
  return normalise === '/' ? `/${langue}` : `/${langue}${normalise}`;
}

/**
 * Déclaration `hreflang` d'une page.
 *
 * Sans elle, les deux versions se ressemblent assez pour qu'un moteur les
 * traite comme du contenu dupliqué et n'en garde qu'une. `x-default` désigne le
 * français : c'est la version servie à qui n'exprime aucune préférence.
 */
export function alternatesLangues(siteUrl: string, cheminFr: string): Record<string, string> {
  return {
    fr: `${siteUrl}${chemin('fr', cheminFr)}`,
    ar: `${siteUrl}${chemin('ar', cheminFr)}`,
    'x-default': `${siteUrl}${chemin('fr', cheminFr)}`,
  };
}
