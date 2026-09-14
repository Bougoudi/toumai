# TOUMA V17 — infrastructure nationale tchadienne

Ce que cette version construit, et **pourquoi**. L'audit préalable —
`TOUMA-V17-TCHAD-AUDIT.md` — dit ce qui existait déjà, et c'était beaucoup :
le Tchad était déjà un pays configuré, les adresses portaient déjà quartier,
point de repère et instructions livreur, le retrait en point relais existait, et
les abstractions transporteur et paiement étaient écrites depuis longtemps.

Le problème était ailleurs, et il était unique :

> La plateforme savait vendre, encaisser, expédier, arbitrer — mais elle **ne
> savait pas où se trouvent les gens**.

---

## 1. La géographie cesse d'être du texte libre

**Le défaut.** Une localisation était une chaîne saisie à la main :

```prisma
city        String      // saisi librement
region      String?     // saisi librement, et quasiment inutilisé
district    String?     // saisi librement
```

« N'Djamena », « Ndjamena » et « N’Djaména » étaient **trois villes différentes**
pour la base. Aucun regroupement, aucun filtre par province, aucune statistique
nationale n'était possible, et le champ `region` — accepté à l'inscription,
recopié dans l'instantané de commande — n'alimentait strictement rien. Le mot
« province » n'apparaissait nulle part dans le code.

**La correction.** Quatre niveaux : province, département, sous-préfecture,
localité. En base aujourd'hui : **23 provinces, 133 départements, 12 268
localités** avec leurs coordonnées, toutes rattachées. Les adresses, les
boutiques et les points relais s'y accrochent.

« Vendeurs au Ouaddaï » devient une requête — par identifiant comme par code
officiel, parce qu'une page publique connaît le code, pas l'identifiant interne.
Et **personne n'est exclu** : sans filtre demandé, un vendeur de Sarh reste
visible pour un acheteur d'Abéché. La proximité est un ordre de présentation,
jamais un mur.

### La source, et les trois trous qu'on n'a pas bouchés

Source : **GeoNames**, CC BY 4.0. Date, structure et limites dans
`docs/chad-geography-sources.md`. Un script versionné
(`scripts/build-chad-geography.mjs`) fabrique le jeu de données : personne n'a à
croire un fichier de douze mille lignes tombé du ciel — il se régénère et se
relit en diff.

Trois limites sont **laissées ouvertes plutôt que comblées**, et c'est le point
le plus important de cette version :

| Limite | Ce qui a été fait | Pourquoi |
|---|---|---|
| Aucune sous-préfecture dans la source | table créée, **vide** | Remplir de mémoire les subdivisions d'un État, c'est inscrire en base une organisation imaginaire que des acheteurs, des vendeurs et un jour une administration prendraient pour argent comptant |
| Localités non rattachées à leur département (1 sur 12 268) | `departmentId` **nullable** | L'alternative était de fabriquer 12 267 rattachements « au plus proche » et de les présenter comme officiels |
| 9 localités sans province identifiable | **écartées**, et le seed le dit | Les ranger chez la province voisine serait une invention silencieuse |

Conséquence concrète et assumée : **le filtre par département ne donnera presque
rien** tant que cette limite n'est pas levée. Le filtre par province, lui,
fonctionne sur tout le territoire.

Une population nulle veut dire **inconnue**, jamais « personne n'y habite » :
75 localités sur 12 268 sont chiffrées, et un `0` de la source n'est jamais
stocké comme une population nulle.

---

## 2. Un numéro, une écriture

**Le défaut.** La seule validation était `^\+?[0-9\s-]{6,20}$`. Étaient donc
acceptés **et stockés tels quels** : `66 12 34 56`, `+235 66123456`,
`00235 66123456`, `235-66-12-34-56`. Quatre écritures du même numéro, que la base
tenait pour quatre numéros différents.

Ce que cela coûtait : aucun compte reconnaissable par son numéro, aucun SMS
envoyable de façon fiable, aucune détection de fraude par numéro — et, pour
l'acheteur qui écrit son numéro comme il le dit, un livreur qui ne peut pas le
joindre.

**La correction.** E.164 partout, avec l'indicatif du pays du compte, appliqué à
l'inscription, à la mise à jour du profil et à chaque adresse. Le plan de
numérotation est respecté : huit chiffres au Tchad, neuf au Cameroun. Un
indicatif inconnu est **refusé** plutôt que rangé au hasard.

Ce que la fonction ne prétend pas faire : vérifier qu'un numéro existe. Personne
ne peut le savoir sans appeler.

---

## 3. Une commande payée à la livraison n'est plus « payée » d'avance

**Le défaut, et c'était le plus grave.** `CASH_ON_DELIVERY` était proposé comme
n'importe quelle autre méthode, et l'adaptateur de démonstration le confirmait
`SUCCEEDED`. Dans l'ordre où cela se produisait :

1. la commande passait à **« payée »** ;
2. la facture et le reçu étaient émis ;
3. le vendeur recevait « commande payée : préparez l'expédition » ;
4. la vente entrait au **registre comptable**.

Tout cela **avant qu'un seul franc ait été collecté**. Au Tchad, où le paiement à
la livraison est un mode courant, c'était mentir sur l'argent à grande échelle.

**La correction.** La commande avance — acceptée, préparée, expédiée — mais elle
n'est jamais dite payée. Le **montant à collecter est suivi**, ce qui est
l'exigence même du §28 : sans lui, personne ne sait combien le livreur doit
rapporter. L'argent n'entre au registre qu'au moment où un vendeur **constate**
la remise, et il est nommé.

Quatre règles tenues :

- **L'acheteur ne confirme jamais lui-même.** Déclarer soi-même avoir payé n'est
  pas une preuve de paiement.
- **Un encaissement supérieur au montant dû est refusé.** Ce n'est pas une bonne
  nouvelle : c'est une erreur de saisie, ou pire.
- **Le mode est fermé par défaut**, et s'ouvre par règle — pays, province,
  boutique, catégorie, avec plafond. Encaisser du liquide engage un vendeur et un
  livreur : cela ne s'active pas par oubli de configuration.
- **Une interdiction ferme une province** sans qu'il faille défaire le reste.

**Déviation assumée.** Les trois états demandés (`COD_PENDING`, `COD_CONFIRMED`,
`COD_COLLECTED`) sont portés par l'**encaissement**, pas par la commande. Les
ajouter à `ToumaOrderStatus` aurait traversé la machine d'état, le calcul du
statut de groupe, la réputation et chaque liste de « statuts payés » — pour dire
une chose qui ne concerne que l'argent. Le vocabulaire est conservé là où il a un
sens ; ce qui compte — une commande jamais dite payée à tort — est tenu.

---

## 4. Un colis ne se remet plus à qui connaît le numéro de commande

**Le défaut.** Le parcours allait jusqu'à l'arrivée du colis au point relais et
s'arrêtait là. **Rien ne prouvait que celui qui se présentait était le
destinataire** : il suffisait de connaître le numéro de commande — qui figure sur
tous les écrans, dans tous les e-mails et sur l'étiquette du colis.

**La correction.** Un code à six chiffres, tiré au checkout, rendu **une seule
fois**.

Trois décisions, chacune pour une raison :

- **Six chiffres, pas une chaîne alphanumérique.** Un code se dicte au
  téléphone, se lit sur un écran fissuré, se tape sur un clavier numérique. Un
  code qu'on n'arrive pas à transmettre finit remplacé par « je le connais, c'est
  bon ».
- **La base ne garde que l'empreinte, et c'est un HMAC.** Une base lue par un
  tiers — sauvegarde égarée, accès mal réglé — ne doit pas lui permettre de
  retirer les colis des autres. Sans le secret du serveur, un dictionnaire des
  six chiffres ne sert à rien, ce qui ne serait pas vrai d'un simple hachage.
  L'identifiant de commande entre dans l'empreinte : un code juste ailleurs ne
  vaut rien ici.
- **La comparaison est à temps constant.** Sinon le délai de réponse dit, chiffre
  par chiffre, si l'on approche.

**Une fuite trouvée par le test qui la cherchait** : l'empreinte sortait dans
`GET /orders/:id`. Ce n'est pas le code, mais une valeur dérivée d'un secret qui
n'a aucun usage côté client n'a rien à faire dans une réponse. Elle est retirée.

---

## 5. La livraison nationale cesse d'être devinée

**Le défaut.** L'unique transporteur branché facturait et datait **toutes** les
livraisons nationales à l'identique :

> prise en charge nationale 1 500 · + 1 200 par kilogramme entamé · délai 1 à
> 3 jours

Autrement dit : **N'Djamena → N'Djamena** et **N'Djamena → Faya-Largeau** — un
millier de kilomètres de piste saharienne — au même prix et au même délai. Le
fichier était honnêtement nommé « mock » et sa grille documentée, mais c'était le
**seul** : l'acheteur voyait donc toujours une estimation, et cette estimation
n'avait aucun fondement.

Et, plus grave : comme il répondait toujours, le système **ne savait jamais dire
« je ne sais pas »**.

**La correction.** Un transporteur piloté par des **zones déclarées**. Une zone
est une phrase d'exploitant : « ce transporteur dessert cette province, à ce
prix, en tant de jours ». Rien n'est calculé par le code. La zone la plus précise
l'emporte — localité, département, province, pays — pour qu'une exception locale
corrige une règle nationale sans qu'il faille défaire celle-ci.

**Et quand aucune zone ne couvre la destination, il ne répond rien.** C'est sa
vertu, pas son défaut. Un silence honnête vaut mieux qu'un chiffre rassurant et
faux, parce que le chiffre faux, quelqu'un organise sa semaine dessus.

- Une zone **non desservie** est une absence de tarif, jamais la gratuité.
- Un tarif en XAF **ne devient pas** un tarif en EUR faute de taux officiel.
- Il n'est **pas le transporteur par défaut**, délibérément : une base neuve n'a
  aucune zone, donc il ne répondrait rien — comportement voulu en production,
  impraticable en développement. Le mock reste le défaut local ; la mise en
  production passe par `TOUMA_LOGISTICS_PROVIDER=zones`.

---

## 6. Administration de la géographie

Provinces, localités, zones et points relais se gèrent par
`/api/v1/admin/geo`, avec deux règles :

**On désactive, on ne supprime pas.** Des commandes, des adresses et des
boutiques référencent ces objets. Supprimer une province rendrait illisible
l'histoire de quelqu'un qui y a acheté l'an dernier ; la désactiver la retire de
la saisie sans toucher au passé.

**Une zone qui a servi ne se supprime qu'une fois désactivée**, parce qu'un devis
figé dans une commande doit rester explicable.

---

## Ce qui est garanti par les tests

**426 tests** (`npm test`) contre une vraie base PostgreSQL.

Géographie :

- les **23 provinces** sont chargées, rattachées au pays, avec un code officiel
  unique — et **toutes portent leur nom arabe** ;
- les 133 départements sont accessibles depuis leur province ;
- une localité se cherche par nom dans tout le pays, sans en connaître la
  province ; une recherche trop courte ne répond rien plutôt que d'envoyer douze
  mille lignes sur un réseau lent ;
- **aucune sous-préfecture n'est inventée**, le trou du rattachement au
  département est **visible et non comblé**, et une population de `0` n'est
  jamais stockée comme une population nulle ;
- **rejouer le chargement ne duplique rien** ;
- un vendeur se trouve par province, par identifiant comme par code — **et
  reste visible sans filtre**.

Adresses et téléphones :

- `66 12 34 56` et `+235 66123456` deviennent **le même numéro** ; sept chiffres
  au Tchad sont refusés ;
- une province inconnue, ou une localité qui n'est pas dans la province
  indiquée, est **refusée** — sinon on n'aurait fait que déguiser du texte libre
  en clé étrangère ;
- la province est **déduite de la localité** quand elle n'est pas donnée.

Paiement à la livraison :

- **fermé tant qu'aucune règle ne l'ouvre** ;
- la commande n'est **jamais dite payée** avant l'encaissement, et **aucune ligne
  n'entre au registre** ;
- l'acheteur ne peut **ni confirmer ni constater** son propre paiement ;
- la vente entre au registre **au moment où le vendeur constate**, pas avant ;
- un encaissement supérieur au montant dû est refusé ; un plafond et une
  interdiction de province sont respectés.

Retrait :

- un code à six chiffres est rendu **une fois**, et seule son empreinte est en
  base ;
- **connaître le numéro de commande ne suffit plus** ; un code juste ailleurs ne
  vaut rien ici ; un colis ne se remet pas deux fois ; un vendeur étranger au
  dossier trouve « introuvable », jamais « interdit ».

Zones :

- **aucun tarif rendu quand aucune zone ne couvre** la destination ;
- « non desservi » n'est pas « gratuit » ; une devise ne se convertit pas sans
  taux ;
- la zone la plus précise gagne sur la plus large — une destination lointaine
  n'a plus le délai de la capitale ;
- l'administration refuse un délai maximal inférieur au minimal, n'est ouverte
  qu'aux administrateurs, et **désactive avant de supprimer**.

---

## Ce qui n'est PAS fait

Par ordre de ce qui manquerait le plus. Rien ici n'est un oubli : chaque poste
attend soit une source, soit une décision d'exploitation.

- **Sous-préfectures** : aucune source exploitable. La table attend.
- **Rattachement des localités aux départements** : idem. Le filtre par
  département restera pauvre tant que la source ne le dira pas.
- **Internationalisation (§32)** : tous les textes de l'interface sont en
  français dans le code. Les **données** sont prêtes — les noms arabes sont en
  base — mais l'interface ne bascule pas encore. C'est un chantier d'interface à
  mener d'un bloc, pas un ajout de fichiers de traduction à moitié.
- **Exceptions de livraison (§21)** : ni modèle, ni traitement par l'assistance.
- **Pages publiques par province (§45, §46)** et **tableau de bord national par
  province (§34, §36)** : la donnée est là et calculable, les écrans restent à
  construire.
- **Zones de service des vendeurs (§42, §43)** et **disponibilité régionale d'un
  produit (§13)** : le modèle géographique les rend possibles ; ils ne sont pas
  construits.
- **Tableau de santé (§76)** et **drapeaux de fonctionnalité (§77)** : les
  variables existent dans `.env.example`, le tableau et leur lecture par le code
  restent à écrire.
- **Aucun prestataire de paiement, de transport ou de SMS réel.** Inchangé
  depuis les versions précédentes, et pour la même raison : inventer des points
  d'entrée plausibles donnerait du code qui compile, passe les tests et échoue à
  la première vraie transaction.
- **Aucune zone de livraison n'est livrée avec le produit.** Les tarifs sont des
  décisions d'exploitant, pas des valeurs par défaut. Tant qu'aucune zone n'est
  configurée, le transporteur `zones` répond « je ne sais pas » — et c'est
  exactement ce qu'il doit faire.

Le §80 reste la règle : **ne jamais déclarer disponible ce qui ne l'est pas.**
