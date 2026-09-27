# Frontières réglementaires de TOUMA Pay

Ce document existe pour répondre à une question qu'on se pose trop tard :
**qu'est-ce que TOUMA fait exactement avec l'argent des autres, et à partir de
quel moment cela devient une activité qui demande un agrément ?**

Il est écrit pour l'équipe produit et pour l'ingénierie. Il n'est pas un avis
juridique et ne peut pas en tenir lieu.

---

## En une phrase

> **TOUMA orchestre des paiements. TOUMA ne détient pas de fonds.**

Tout ce qui suit découle de cette phrase, et le code la respecte — parfois au
prix de fonctionnalités qui auraient été plus simples à écrire autrement.

---

## Ce que TOUMA fait

| | |
|---|---|
| **Place de marché** | Met en relation acheteurs et vendeurs, tient le catalogue, les commandes, la logistique, l'après-vente |
| **Orchestration de paiement** | Crée une intention de paiement chez un prestataire, suit son état, reçoit ses webhooks, réconcilie |
| **Calcul de ce qui est dû** | Commission, part de chaque vendeur, remboursements, contre-passations |
| **Registre interne** | Un journal comptable append-only de ses propres opérations |
| **Arbitrage** | Instruit les litiges et rend une décision motivée, sur pièces vérifiables |

---

## Ce que TOUMA ne fait pas, et ne doit pas faire

Ces interdictions ne sont pas des précautions rédactionnelles : chacune
correspond à une activité réglementée dans la zone CEMAC comme ailleurs, et
chacune est absente du code.

### Détenir des fonds pour le compte de tiers

Il n'existe **aucun portefeuille utilisateur**. Aucune table ne représente un
solde qu'un acheteur ou un vendeur pourrait alimenter, conserver ou retirer.

C'est la raison d'être d'une distinction qui revient partout dans le code : une
part de règlement (`ToumaSettlementAllocation`) dit ce qui est **dû** à une
boutique, pas ce qu'elle **possède** chez TOUMA. Le solde d'un vendeur est un
calcul sur des mouvements passés, jamais un avoir.

Détenir des fonds de tiers, c'est de la monnaie électronique ou des services de
paiement : cela demande un agrément, des fonds propres, une ségrégation des
comptes et un contrôle prudentiel.

### Transférer de l'argent

TOUMA n'exécute aucun virement. Quand l'administration « exécute » un versement,
elle **consigne** un mouvement réalisé ailleurs — par un prestataire agréé, une
banque, un opérateur de mobile money — avec sa référence et l'identité de qui
l'a décidé.

Le code le dit sans ambiguïté, parce que la tentation inverse est forte :
marquer un versement « payé » alors que rien n'est parti donnerait à un vendeur
la certitude d'avoir été réglé.

### Prêter, avancer, escompter

Aucun crédit TOUMA. Le §43 du cahier des charges V20 le dit et le code s'y
tient : des conditions de paiement B2B (`payment_due_at`, accord commercial
entre les parties) ne sont pas un crédit consenti par la plateforme. La
différence est nette — TOUMA n'avance jamais de fonds et ne porte jamais de
risque de contrepartie.

Le financement de campagne, l'affacturage et l'avance sur ventes sont des
activités de crédit. S'ils sont proposés un jour, ce sera par un partenaire
agréé, et le contrat sera entre le vendeur et ce partenaire.

### Émettre ou manipuler de la cryptomonnaie

Rien. Nulle part. Ce n'est pas un oubli.

### Stocker des données de paiement sensibles

Ne sont **jamais** écrits en base, ni journalisés :

- numéro de carte complet (PAN), date d'expiration, cryptogramme (CVV) ;
- code secret mobile money, mot de passe bancaire ;
- secret ou clé d'un prestataire ;
- jeton d'accès en clair.

Les cartes, si elles sont un jour acceptées, passeront par une page hébergée
chez le prestataire ou par tokenisation. TOUMA reste ainsi **hors du périmètre
PCI-DSS le plus lourd** — non par ruse, mais parce que manipuler des données de
carte sans en avoir besoin est une prise de risque gratuite.

Les secrets vivent dans des variables d'environnement, et en production dans un
gestionnaire de secrets. `.env.example` ne contient que des espaces réservés.

---

## Ce qui est délégué, et à qui

| Fonction | Qui l'assure | État |
|---|---|---|
| Encaissement (mobile money, carte, virement) | prestataire agréé | **non raccordé** |
| Détention des fonds entre l'encaissement et le versement | prestataire agréé | **non raccordé** |
| Virement aux vendeurs | prestataire agréé ou banque | **non raccordé** |
| KYC des particuliers | prestataire, ou TOUMA pour la seule vérification vendeur | partiel |
| KYB des entreprises | prestataire, ou TOUMA pour la seule vérification boutique | partiel |
| Lutte anti-blanchiment (LCB-FT), filtrage des sanctions | prestataire agréé | **non fait** |
| Conformité PCI-DSS | prestataire (page hébergée / tokenisation) | sans objet tant qu'aucune carte n'est acceptée |

**Aucun prestataire réel n'est configuré aujourd'hui.** Ce n'est pas une réserve
de style : tant que les variables d'environnement du prestataire sont vides,
celui-ci est *indisponible* — il n'est proposé à aucun checkout et n'est déclaré
actif nulle part.

### Ce que « Touma Verified » est, et n'est pas

La vérification vendeur contrôle des pièces d'identité et d'entreprise pour
décider si une boutique mérite un badge de confiance sur la place de marché.

**Ce n'est pas un KYC réglementaire.** Elle n'est pas conduite selon les
obligations d'un établissement financier, n'inclut aucun filtrage de listes de
sanctions, et ne saurait être présentée à un régulateur comme telle. Un
prestataire de paiement conduira sa propre vérification, selon ses propres
obligations.

---

## Le registre interne, et ce qu'il n'est pas

`ToumaLedgerEntry` est un journal append-only des opérations de la plateforme :
vente, commission, remboursement, contre-passation, retenue. Rien n'y est
modifié ni supprimé — une correction est une écriture de sens inverse.

**Ce n'est pas une comptabilité légale.** Il ne remplace ni un livre comptable,
ni un expert-comptable, ni les obligations fiscales d'un vendeur ou de la
plateforme. Il répond à une question d'exploitation — « où est passé cet
argent » — et à elle seule.

**Aucune conversion de devise n'y est faite.** Les soldes sont rendus par
devise. Sans taux officiel raccordé, additionner XAF et EUR produirait un
chiffre inventé, et un chiffre inventé dans un registre est pire qu'une absence
de chiffre.

---

## Trois règles pour l'ingénierie

Quand un arbitrage se présente, ces trois règles tranchent.

**1. Ne jamais afficher comme disponible ce qui ne l'est pas.** Un adaptateur
qui existe n'est pas un moyen de paiement ouvert. La disponibilité dépend du
prestataire configuré, du pays, de la devise, de l'environnement et d'un
interrupteur explicite — jamais de la seule présence de code.

**2. Ne jamais simuler une opération réglementée pour faire marcher une
démonstration.** Un paiement simulé présenté comme réel, un virement qui n'a pas
lieu, un taux de change inventé : chacun donne à quelqu'un une certitude fausse
sur son argent. Mieux vaut une fonction absente qu'une fonction qui ment.

**3. Quand le système ne sait pas, il le dit.** « Estimation indisponible » vaut
mieux qu'un délai inventé ; une absence de tarif vaut mieux qu'un tarif par
défaut ; un solde par devise vaut mieux qu'un total qui mélange.

---

## Avant d'accepter un premier franc réel

À trancher avec un conseil juridique compétent pour le Tchad et la zone CEMAC,
**avant** toute mise en service :

- [ ] Statut de l'exploitant, et si un agrément d'agent ou de distributeur est
      requis pour l'activité envisagée.
- [ ] Contrat avec le prestataire agréé : qui détient les fonds, pendant combien
      de temps, sur quel compte, et ce qui se passe si le prestataire fait
      défaut.
- [ ] Qui porte l'obligation LCB-FT sur les flux, et selon quel seuil de
      déclaration.
- [ ] Régime de TVA applicable. **Aucun n'est configuré aujourd'hui**, et les
      documents commerciaux l'annoncent explicitement.
- [ ] Durée de conservation des données financières et des pièces de litige, et
      les droits des personnes concernées.
- [ ] Traitement des réclamations, et l'autorité compétente en cas de litige non
      résolu.
- [ ] Formulation exacte, dans les conditions générales, de ce que TOUMA fait et
      ne fait pas de l'argent — conforme à ce document, et vérifiée.

`TOUMA-CHAD-GO-LIVE-CHECKLIST.md` reprend ces points parmi les bloquants.
