# TOUMA V16 — confiance après-vente

Ce que cette version construit, et **pourquoi**. L'audit préalable —
`TOUMA-V16-AUDIT.md` — dit ce qui existait déjà, et c'était beaucoup.

Le principe posé par le §64 gouverne tout le reste :

> L'acheteur doit pouvoir acheter sans avoir peur. Le vendeur doit pouvoir
> vendre sans être arbitrairement pénalisé. Et chaque transaction doit posséder
> un historique vérifiable.

Trois exigences, dont la troisième rend les deux premières tenables : sans
historique, « sans peur » et « sans arbitraire » ne sont que des promesses.

---

## 1. Une preuve est maintenant une preuve

**Le défaut.** Une preuve de litige était une **URL déclarée par un
navigateur** :

```prisma
kind String
url  String   // ← ça
note String?
```

Rien n'était vérifié : ni que le fichier existait, ni ce qu'il contenait, ni son
type réel. Le fichier vivait chez un tiers, que son déposant pouvait modifier ou
supprimer **après** la décision. Personne ne savait qui l'avait versé. Et l'URL
était publique : la facture d'un acheteur ou la photo de son domicile étaient
lisibles par quiconque avait le lien.

Or c'est la pièce sur laquelle un arbitre décide qui garde l'argent.

**La correction.** Le contenu est reçu en corps brut, reconnu **à ses octets**,
empreinté (SHA-256), rangé sous une clé non devinable dans le stockage privé, et
servi par URL signée à durée courte aux seules parties du dossier. C'est
exactement le mécanisme écrit en V14 pour les pièces jointes de la messagerie,
**réutilisé tel quel** : il n'y avait rien à inventer, il y avait à ne pas le
refaire une seconde fois. Un exécutable renommé en photo est refusé ici comme
là-bas.

Deux règles propres au dossier :

- **Une preuve ne se modifie jamais.** Aucune fonction de mise à jour n'existe
  dans le service ; c'est une contrainte de conception, pas un oubli.
- **Un retrait ne supprime rien.** Écarter une pièce est un acte
  d'administration, avec motif obligatoire, qui la **marque** écartée : elle
  reste au dossier, son contenu n'est plus servi, et le motif est visible. Ni
  l'acheteur ni le vendeur ne peuvent écarter une pièce — **y compris la leur**.
  On ne retire pas une pièce d'un dossier après qu'une décision a été prise
  dessus.

**Changement destructif assumé.** Les anciennes preuves — de simples URL — sont
supprimées par la migration. Il n'existe aucun fichier à empreindre, donc aucun
moyen de garantir qu'elles n'ont pas changé : les convertir en « preuves
vérifiées » aurait été un mensonge inscrit en base. Les parties redéposent leurs
pièces. Sur un dossier en cours c'est une gêne ; sur une décision d'argent,
c'est la seule réponse honnête.

## 2. Un registre, parce qu'un solde se calcule

`ToumaLedgerEntry` est **append-only**. Chaque mouvement laisse une ligne : la
vente, la commission prélevée, le remboursement, la contre-passation. Le service
n'expose **aucune fonction de mise à jour ou de suppression** — une correction
est une nouvelle ligne de sens inverse, comme en comptabilité.

Deux décisions méritent d'être dites :

- **Le solde est calculé, jamais stocké.** Un solde stocké finit toujours par
  diverger de ses mouvements, et le jour où ça arrive, personne ne sait lequel
  des deux a raison.
- **Les devises ne sont jamais additionnées.** Sans taux officiel, une somme
  XAF + EUR serait un chiffre inventé. Le solde est rendu par devise.

L'écriture est idempotente par construction : la clé
`(referenceType, referenceId, type)` est unique, donc rejouer une opération —
un webhook, une reprise après incident — n'écrit pas deux fois le même
mouvement. Et un doublon n'annule jamais l'opération métier : une vente ne doit
pas échouer parce que sa ligne comptable existait déjà.

**Ce n'est pas une comptabilité légale.** Il ne remplace ni un livre comptable,
ni un expert-comptable, ni les obligations fiscales d'un vendeur.

## 3. Des fonds retenus, plutôt qu'un verrou sur une porte qui n'existe pas

Le §35 demande un `PayoutHold`. L'audit a montré que `ToumaSellerPayout` est
déclaré dans le schéma et **n'est lu ni écrit nulle part** : aucun versement
n'est jamais créé, aucun prestataire n'étant raccordé.

Poser un verrou sur une ligne de versement fantôme aurait été une façade. Le
besoin réel derrière le §35 est autre chose : **savoir combien d'argent d'un
vendeur ne doit pas partir**. C'est un solde, et il se marque sur les mouvements
eux-mêmes. À l'ouverture d'un litige, les lignes de la commande sont retenues ;
à la décision, la retenue est **datée**, pas effacée — l'historique doit pouvoir
dire « ces fonds ont été retenus du 3 au 17 ».

Ce n'est pas une sanction : c'est l'argent qui reste en place le temps qu'un
humain regarde.

## 4. Le silence devient une réponse — mais ne tranche rien

**Le défaut.** Un litige attendait indéfiniment. Un vendeur qui ne répondait
jamais bloquait l'acheteur aussi sûrement qu'un refus, sans jamais refuser, donc
sans que rien ne le signale. Réciproquement, un acheteur qui ouvre un litige puis
disparaît laissait le vendeur avec une commande gelée.

À l'ouverture, la balle est explicitement dans le camp de l'autre partie
(`SELLER_RESPONSE_REQUIRED` ou `BUYER_RESPONSE_REQUIRED`), avec un délai. Passé
ce terme, un balayage **serveur** porte le dossier devant l'assistance. Jamais le
navigateur : une escalade qui dépend d'un onglet ouvert n'arrive pas pour celui
qui a fermé le sien.

**Ce que l'escalade ne fait pas** — et c'est le point important : elle ne tranche
rien. Personne n'est débité, personne n'est remboursé, personne n'est sanctionné
parce qu'un compteur est arrivé à zéro. Elle met le dossier devant un humain.

La priorité (`LOW` → `CRITICAL`) est calculée depuis le montant, la catégorie et
la récidive de la boutique. C'est un **ordre de passage**, pas une décision : le
§18 le demande explicitement, et le mot compte.

## 5. Une résolution figée

Une décision conserve un instantané : qui a décidé, quand, quoi, sur quel
montant et dans quelle devise, et **sur quelles pièces** — leurs empreintes, pas
les fichiers. C'est l'empreinte qui permettra plus tard de prouver que la pièce
consultée est bien celle sur laquelle on a décidé.

Une résolution ne se rejoue pas : une seconde tentative reçoit un 409. Ni
l'acheteur ni le vendeur ne peuvent trancher leur propre litige.

## 6. Un défaut trouvé par l'intégration continue

Les trois statuts de retour ajoutés (`UNDER_REVIEW`, `REFUND_PENDING`, `CLOSED`)
n'avaient pas été déclarés dans la table des transitions. Le typage l'attrape —
`Record<ReturnStatus, ReturnStatus[]>` exige une entrée par statut — mais
**seulement contre un client Prisma à jour** : mon contrôle local passait contre
un client régénéré avant cette modification. La CI, qui régénère toujours depuis
zéro, l'a vu.

La correction n'est pas seulement d'ajouter trois lignes. `REFUND_PENDING` est
l'état où se trouve un retour reçu et accepté pendant qu'un humain exécute le
remboursement : jusqu'ici il n'existait pas, et l'acheteur ne voyait rien entre
« reçu » et « remboursé ». Un test verrouille désormais la table — chaque statut
y figure, et aucune issue ne revient en arrière.

## 7. Les écrans — et trois défauts que seul le fait de les écrire a révélés

Le moteur était complet et **personne ne pouvait le regarder**. Un acheteur
ouvrait un litige, recevait un message de confirmation, et n'avait plus aucun
écran : ni l'avancement, ni le moyen de verser une pièce, ni la réponse du
vendeur. Le vendeur était prévenu sans qu'on lui dise où répondre.
L'administration tranchait depuis une ligne de liste, avec deux boutons et une
invite du navigateur — **sans voir une seule preuve**.

Il y a désormais un dossier, le même pour les deux parties : ce qui est
reproché, les échanges, les pièces avec leur empreinte, les mouvements d'argent,
le délai en cours et à qui il s'adresse, et la décision une fois rendue. Côté
administration, s'y ajoute le formulaire de décision — motivation obligatoire,
car c'est elle que les deux parties liront.

Écrire ces écrans a mis au jour trois défauts du moteur, qu'aucun test ne voyait
parce qu'aucun appelant ne parcourait ces chemins.

**La note interne de l'assistance était lisible par les parties.** Le filtre
était posé à l'écriture — un non-administrateur ne peut pas en créer — et nulle
part à la lecture. La note existe précisément pour qu'un dossier puisse être
annoté sans que l'acheteur et le vendeur lisent par-dessus l'épaule de celui qui
l'instruit.

**La clé de stockage d'une preuve sortait dans le dossier complet.** C'est le
nom de l'objet dans le stockage privé : non devinable par construction, et c'est
cette imprévisibilité qui protège le fichier. Le service de preuves la retirait
déjà de ses réponses ; le dossier la laissait passer, ce qui revenait à annuler
la précaution par une autre porte. Dans un litige, l'autre partie est un
adversaire.

**Le contenu d'une preuve n'était servi par aucune route.** Le lien signé rendu
à la liste pointait vers le chemin des pièces jointes de la messagerie — deux
tables différentes, donc un identifiant qui ne s'y trouvait jamais. Une preuve
pouvait être versée, listée, et **jamais ouverte** : l'arbitre décidait sur une
pièce qu'il ne pouvait pas regarder. C'est le plus grave des trois, et c'est
celui qu'aucune relecture n'avait attrapé — il fallait essayer de cliquer.

Les trois sont verrouillés par des tests qui échouaient avant correction.

---

---

## Ce qui est garanti par les tests

**382 tests** au total (89 unitaires, 260 d'intégration, 33 de bout en bout), 23
ajoutés par cette version.

- une preuve déclarée par URL est **refusée** (400) ;
- le type est reconnu aux octets, l'empreinte est un SHA-256, l'URL est signée ;
- un exécutable renommé en photo est refusé ;
- le dossier d'un tiers est « introuvable », jamais « interdit » — pour un autre
  acheteur comme pour un autre vendeur ;
- **ni l'acheteur ni le vendeur ne peuvent écarter une pièce**, y compris la
  leur ; l'administration le peut, avec un motif obligatoire, et la pièce reste
  au dossier ;
- la vente et la commission laissent chacune leur ligne au registre, et le solde
  varie exactement de leur différence ;
- l'ouverture d'un litige retient les fonds, la décision les libère **en datant**
  la ligne ;
- les deux parties — et personne d'autre — peuvent lire l'histoire de l'argent ;
- l'escalade après délai **ne décide rien** : ni résolution, ni remboursement ;
- rejouer le balayage n'escalade pas deux fois ;
- l'instantané de résolution contient l'empreinte des pièces retenues ;
- une résolution ne se réécrit pas (409), et personne ne tranche son propre
  litige (403) ;
- la machine d'état des retours déclare une transition pour **chaque** statut, et
  aucune issue ne repart en arrière.
- **la note interne de l'assistance ne sort jamais** vers l'acheteur ni vers le
  vendeur, et le message public, lui, arrive bien ;
- **aucune clé de stockage** ne figure dans le dossier rendu à une partie ;
- **le contenu d'une preuve est réellement servi** — par lien signé comme par
  appartenance au dossier — et reste introuvable pour un tiers.

Et par le parcours navigateur : un acheteur ouvre un litige et **arrive dans son
dossier**, y verse une pièce qui s'affiche avec son empreinte ; le vendeur la
retrouve depuis son espace et répond ; l'administration ouvre le dossier, y voit
les pièces **et** les mouvements d'argent avant de trancher, et le dossier est
figé après la décision — plus de formulaire, plus de message.

---

## Ce qui n'est PAS fait

Par ordre de ce qui manquerait le plus.

- **Webhook de remboursement** (§14) : le remboursement est synchrone via
  l'adaptateur de démonstration. Le webhook n'a de sens qu'avec un prestataire
  asynchrone réel, et sa signature dépend de celui qu'on raccorde.
- **RBAC à quatre rôles d'administration** (§49) : le dépôt distingue
  aujourd'hui BUYER / SELLER / ADMIN. Séparer SUPPORT, MODERATOR, FINANCE_ADMIN
  et SUPER_ADMIN est une refonte des autorisations à mener d'un bloc, pas un
  ajout de valeurs d'énumération.
- **Médiation comme objet distinct** (§26) : le statut `MEDIATION` existe ; le
  dossier de médiation séparé n'a pas été créé, faute d'un flux de travail réel
  à modéliser.
- **Score de confiance élargi** (§40) : la réputation calculée existe depuis la
  V13 et respecte déjà « pas d'indicateur sans volume ». Y verser le taux de
  litige demande d'abord d'avoir des litiges réels à mesurer.
- **Aucun versement, aucun transfert d'argent réel** — le §65 le demande, et il a
  raison : simuler un virement donnerait un faux sentiment de sécurité à celui
  qui attend son argent.

Rien de tout cela ne bloque la protection des deux côtés du marché aujourd'hui.
