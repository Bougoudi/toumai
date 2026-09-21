# Déploiement

## Drapeaux de fonctionnalité (V25 §28-29)

### Deux mécanismes, à ne pas confondre

| | Interrupteur d'environnement | Drapeau |
|---|---|---|
| Où | `TOUMA_*_ENABLED` (29 existants) | table `touma_feature_flags` |
| Ce qu'il dit | ce que l'**instance peut** faire | parmi ce qui est possible, **qui le voit** |
| Changer | redéploiement | immédiat |

**Un drapeau ne rallume jamais ce que l'environnement a éteint.** Sans cette
règle, une ligne de base de données activerait en production une
fonctionnalité dont l'instance n'a pas les moyens — c'est-à-dire promettrait à
un acheteur ce que personne ne peut tenir. Un test la vérifie, et échoue quand
on retire le garde-fou.

Les drapeaux commandés par un interrupteur : `ai_chat`, `loyalty`,
`flash_sales`, `promotions`, `coupons`, `referrals`, `trade`. Les autres
répondent seuls.

### Ciblage

`countries`, `provinces`, `storeIds`, `userIds`, `environments`. Une liste
vide ne restreint rien sur sa dimension ; une liste remplie exige
l'appartenance — un contexte qui ne peut pas prouver la sienne est exclu.

Un compte **nommément** ciblé passe avant le pourcentage : c'est ce qui permet
d'ouvrir à l'équipe avant tout le monde sans dépendre du hasard.

### Déploiement progressif

L'attribution est **stable** : `sha256(clé:sujet) % 100`. Un tirage à chaque
requête ferait clignoter la fonctionnalité — la même personne la verrait, ne
la verrait plus —, et tout rapport de bogue deviendrait irreproductible.

Le nom du drapeau entre dans le hachage pour que deux déploiements à 10 % ne
touchent pas les mêmes personnes : sinon la même minorité essuierait les
plâtres de toutes les nouveautés.

Un visiteur **sans identité** reste dehors tant que le déploiement est
partiel : il n'a rien de stable à hacher. À 100 %, tout le monde entre.

### Exposition au navigateur

`GET /api/v1/features` ne rend que les drapeaux marqués `exposedToClient`, et
**sans le motif** de la décision — celui-ci décrirait le ciblage à qui n'y a
pas droit.

### Traçabilité

Modifier un drapeau demande `ADMIN_SYSTEM` et laisse une trace de l'avant et
de l'après. Un drapeau change ce que voient des milliers de personnes sans
qu'aucun code ne bouge : sans trace, un comportement inexplicable le reste.

## Stratégie de déploiement (§30)

Ce qui est réellement supporté aujourd'hui : un **remplacement simple** du
conteneur, avec les migrations jouées au démarrage par l'entrée
(`docker-entrypoint.sh`).

Ni bleu/vert, ni canari, ni zéro interruption : ils supposent une
infrastructure (répartiteur, deux environnements, bascule) qui n'existe pas
dans ce dépôt. Les décrire comme disponibles serait faux, et c'est le genre de
fausseté qu'on découvre au pire moment.

Les migrations étant additives (§32) et l'entrée s'arrêtant sur tout échec
autre que P3005, un déploiement raté laisse la base intacte et l'ancienne
version en place.
