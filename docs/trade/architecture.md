# Touma Trade — architecture

## Ce que V24 est, et ce qu'il n'est pas

Le transfrontalier n'est **pas une seconde application** posée à côté de la
place de marché. C'est une couche de **configuration et de vérification**
au-dessus de ce qui existait déjà.

```
Corridor + configuration pays   →  ce qui est possible
          ↓
Moteur d'éligibilité            →  cette vente-là est-elle possible ?
          ↓
Documents · coûts · chronologie →  accrochés à la commande existante
          ↓
Paiement · logistique · grand livre · règlement
                                →  inchangés, seuls maîtres de leur domaine
```

V24 **lit** le paiement, l'expédition et le grand livre. Il ne les pilote
jamais. Le module de paiement reste la source de vérité du paiement (§26) ;
aucun transfert financier n'est créé ici (§27).

## Ce que l'audit a montré

Une bonne part du transfrontalier existait déjà, dispersée : `crossBorder`,
`buyerCountry` et `sellerCountry` sur la commande, `originCountry` et
`destinationCountry` sur l'expédition, un modèle d'adresse africain complet,
et un checkout qui **découpe déjà par boutique** — donc des expéditions
séparées par vendeur (§30). Rien de tout cela n'est refait.

Ce qui manquait entièrement : corridor, configuration commerciale de pays,
**taux de change**, document commercial, éligibilité, versionnage de règle,
coût rendu, chronologie.

## Les trois refus qui structurent le module

**1. Un corridor n'est pas actif parce qu'il est déclaré actif.**
`corridorService.capability()` recalcule la capacité réelle à chaque lecture,
en croisant le corridor, la configuration des deux pays et les transporteurs
enregistrés. Un moyen de paiement doit exister **des deux côtés** —
l'intersection, jamais l'union. L'API rend le statut déclaré *et* la capacité
réelle, sans les fondre. Activer un corridor sans prestataire est refusé.

**2. Aucune réglementation n'est inventée.**
Touma ne livre **aucune** liste de produits interdits, aucun barème douanier.
Chaque règle est saisie, porte une `sourceName` obligatoire, est versionnée, et
n'est jamais modifiée : elle est remplacée, l'ancienne passant à `SUPERSEDED`.
Une commande passée sous une règle garde la règle de ce jour-là.

**3. L'inconnu ne vaut pas zéro.**
Chaque ligne de coût porte sa fiabilité — `CONFIRMED`, `ESTIMATED`, `UNKNOWN`.
Les sous-totaux ne se mélangent pas, et tant qu'une ligne est inconnue il n'y a
**pas de total**. Un total qui paraît complet sans l'être est plus trompeur
qu'une absence de total, parce qu'il ne se voit pas.

## Fichiers

| Fichier | Rôle |
|---|---|
| `corridor.service.ts` | corridors, configuration pays, capacité réelle |
| `eligibility.service.ts` | verdict motivé, critère par critère |
| `fx.service.ts` | abstraction de taux ; aucune source branchée |
| `cost.service.ts` | coût rendu, fiabilité par ligne |
| `document.service.ts` | ce que Touma émet / ce qu'elle ne fait que recevoir |
| `timeline.service.ts` | chronologie réelle, machine d'état, liste de contrôle |
| `trade.routes.ts` | API publique, vendeur, professionnel, administration |
