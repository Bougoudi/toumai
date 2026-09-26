# Maîtrise des coûts

## Le danger réel

Ce n'est pas qu'un utilisateur pose trop de questions. C'est qu'une boucle —
un agent qui s'appelle lui-même, un travail périodique qui repart en erreur —
consomme sans limite pendant une nuit. Les plafonds existent pour qu'un tel
emballement s'arrête tout seul.

## Plafonds

```
AI_LIMIT_USER_DAY=200            # appels par utilisateur et par jour
AI_LIMIT_USER_MONTH=3000
AI_LIMIT_SCOPE_DAY=1000          # par boutique ou organisation
AI_LIMIT_PLATFORM_DAY=20000
AI_LIMIT_PLATFORM_COST_DAY=25    # dépense estimée maximale, en dollars
```

Exprimés en **appels** autant qu'en dollars : un compte d'appels borne l'abus
même avec un fournisseur gratuit, où un plafond en dollars ne borne rien.

## Ce que ces plafonds garantissent, et ce qu'ils ne garantissent pas

Le compte est lu puis comparé. Deux requêtes simultanées peuvent donc toutes
deux passer le dernier appel autorisé. Le dépassement est borné par le nombre
d'appels concurrents — quelques unités.

C'est acceptable pour un frein d'usage, et ce serait inacceptable pour un
budget de promotion, qui est pour cette raison écrit autrement
(`UPDATE … WHERE spent + n <= total`). Le dire vaut mieux que laisser croire à
une exactitude qui n'existe pas.

## Coût estimé, jamais facturé

`TARIFS` est une grille locale en dollars par million de jetons. Elle
vieillit : les tarifs changent sans prévenir. C'est assumé — son rôle est de
détecter un emballement, pas de tenir une comptabilité.

Un modèle inconnu tombe sur un tarif prudent plutôt que sur zéro : un coût
inconnu compté comme nul rendrait le plafond de budget inopérant précisément
le jour où l'on change de modèle.

`RULE_BASED` inscrit **zéro jeton et zéro coût**. Compter des jetons pour un
fournisseur local laisserait le tableau de bord afficher une consommation
gratuite, ce qui ne veut rien dire : il n'y a ni tokeniseur ni unité de
facturation.

Chaque lecture du tableau de bord rappelle que ces montants sont des
estimations et que la facture du fournisseur fait foi.

## Bornes de boucle

Voir `tools.md`. Trois bornes, parce que les emballements ne se ressemblent
pas : vingt outils différents, le même outil en boucle, un outil lent.
