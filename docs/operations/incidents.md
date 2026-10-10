# Incidents d'exploitation

## Tenus à la main, et c'est délibéré

Rien n'ouvre un incident automatiquement. Aucune alerte n'existe sur cette
installation (§50 suppose un collecteur de métriques, absent), et un incident
ouvert par une machine que personne ne lit ne sert à rien. Le jour où il y aura
des alertes, l'ouverture automatique aura un sens ; l'écrire avant donnerait
l'illusion d'une détection qui n'existe pas.

Conséquence à garder en tête : **zéro incident ne veut pas dire zéro
problème.** La liste et le centre d'opérations le rappellent tous les deux.

## Ce que ce module sert vraiment

Qu'une personne d'astreinte écrive ce qu'elle constate **pendant** qu'elle le
constate. C'est l'exercice que personne ne refait après coup, et pourtant le
seul moment où l'on sait ce qu'on ne savait pas encore.

## La chronologie ne se réécrit pas

Aucune route ne modifie ni ne supprime une ligne. Un compte rendu rédigé une
fois qu'on connaît la fin de l'histoire est toujours plus net que la réalité,
et c'est précisément ce qui le rend inutile.

Un incident clos n'accepte plus de ligne : rouvrir est une décision, pas un
effet de bord d'une note écrite trois semaines plus tard.

## États

```
OPEN → INVESTIGATING → MITIGATED → RESOLVED → CLOSED
         ↑                 ↓            ↓
         └─────────────────┴────────────┘   (rechute)
```

La rechute est permise parce qu'elle arrive : la nier ferait mentir la frise.

Les horodatages ne sont posés **qu'une fois**. Un incident atténué deux fois
garde la date de la première atténuation — celle où les gens ont cessé d'être
gênés. L'écraser embellirait le délai de rétablissement.

## Clore demande une cause

Clore exige une cause établie **et** ce qui a rétabli le service. Un incident
clos sans cause est un incident qu'on reverra, et le seul moment où l'on peut
encore l'écrire est celui-là. « Probablement » n'est pas une cause : dans ce
cas, l'incident reste ouvert.

## Gravité

| | |
|---|---|
| `P0` | service inutilisable, ou argent en jeu |
| `P1` | fonction majeure cassée, contournement pénible |
| `P2` | gêne réelle, contournement acceptable |
| `P3` | à traiter, sans urgence |

## API

Sous `ADMIN_SYSTEM`. Ouverture et changement d'état sont tracés dans le
journal d'audit, en plus de la chronologie de l'incident.

| Route | |
|---|---|
| `GET /admin/incidents` | liste, filtrable par état et gravité |
| `POST /admin/incidents` | ouvrir |
| `GET /admin/incidents/:id` | détail et chronologie complète |
| `POST /admin/incidents/:id/events` | ajouter une observation, une action, une communication |
| `POST /admin/incidents/:id/status` | changer d'état, avec sa note |

Les fiches de `playbooks/` disent quoi faire ; ce module dit ce qui a été fait.
