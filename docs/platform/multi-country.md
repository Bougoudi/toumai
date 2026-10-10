# Passer d'un pays à plusieurs

TOUMA doit pouvoir passer du Tchad au Cameroun puis à d'autres marchés
africains **sans réécrire le backend et sans code spécifique par pays**. Ce
document dit où en est cette promesse.

## L'état réel des marchés

| Marché | Statut | Commandes | Vendeurs | Géographie | Prestataire réel |
|---|---|---|---|---|---|
| Tchad 🇹🇩 | `ACTIVE` | oui | oui | 23 provinces, 133 départements, 12 268 localités | **aucun** |
| Cameroun 🇨🇲 | `CONFIGURING` | non | oui | **aucune** | **aucun** |
| NG · CI · SN · GH · KE | `PLANNED` | non | non | aucune | aucun |

Les cinq derniers sont référencés pour une seule raison : que leur devise,
leur indicatif et leur fuseau soient connus le jour où quelqu'un saisit une
adresse ou un numéro de ce pays. Rien d'autre n'est déclaré — et surtout
aucun nom de niveau administratif, parce qu'écrire que le Kenya a des
« provinces » sans l'avoir vérifié produirait une donnée officielle fausse,
affichée à un utilisateur kényan le jour de l'ouverture.

## Ce qui est par marché aujourd'hui

- **Statut et cycle de vie** — `PLANNED → CONFIGURING → TESTING → PILOT →
  ACTIVE`, sans saut d'étape, toujours motivé et tracé.
- **Contrôle de préparation** — quatorze domaines interrogés réellement.
- **Niveaux administratifs** — le Cameroun a des régions et des
  arrondissements, pas des provinces et des sous-préfectures.
- **Prestataires** — paiement, transport, SMS, FX… par pays, avec priorité,
  relais et santé.
- **Moyens de paiement** — filtrés par ce que le pays déclare, et fermés
  quand le marché n'accepte pas de commandes.
- **Fuseau et langue** — portés par le contexte de requête jusqu'au rendu.
- **Devise** — décimales par devise, aucune conversion sans taux officiel.
- **Corridors** — capacité recalculée à chaque lecture (V24).

## Ce qui ne l'est pas encore

- Assortiment, prix et règles produit par marché (§22, §27, §28).
- Marchés d'une boutique — un vendeur ne peut pas encore déclarer où il vend
  (§25, §26).
- Emplacements de stock et choix du stock à servir (§29, §30).
- Lignes de transport origine → destination (§31).
- Conformité, fiscalité et facturation par pays (§34 à §37).
- Assistance et notifications par pays (§40, §41).
- Analytique et comparaison par marché (§50, §51).
- Console d'administration des marchés (§42 à §44), simulateur (§53),
  assistant d'ouverture (§54).

## Ouvrir un marché, aujourd'hui

1. `prisma/seeds/countries/XX.ts` — un descripteur déclaratif, validé avant
   écriture.
2. Charger une géographie depuis une **source citable**.
3. Enregistrer les prestataires réels : `POST /admin/countries/XX/providers`.
4. `POST /admin/countries/XX/readiness` — voir ce qui manque.
5. Avancer d'un statut à la fois.

Il n'y a pas d'étape « écrire du code spécifique au pays ».

## Ce qu'il faut savoir avant d'y croire

Le Tchad est `ACTIVE` et son propre contrôle de préparation répond que
`ACTIVE` n'est **pas** atteignable : aucun prestataire de paiement agréé,
aucun transporteur réel. C'est le même constat que celui de V25, et il ne se
lève pas en écrivant du code. Il se lève en signant des contrats.

L'architecture multi-pays de V26 ne rapproche donc pas TOUMA d'une ouverture
commerciale. Elle fait autre chose, qui compte aussi : elle empêche qu'un
marché soit annoncé ouvert sans l'être. C'était déjà arrivé — le Cameroun
l'était depuis le premier seed.
