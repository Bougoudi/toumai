# Architecture multi-pays

> État au 22 septembre 2026. Ce document décrit ce que le dépôt fait,
> pas ce qu'on aimerait qu'il fasse.

## Ce qui existait déjà

L'audit V1 → V25 a trouvé beaucoup moins de code « tchadien » que prévu.
Ce qui suit est déjà multi-pays, et n'a pas été réécrit :

| Domaine | État | Où |
|---|---|---|
| Devises | Décimales par devise (XAF/XOF à 0, NGN/GHS/KES à 2), refus explicite de toute conversion sans taux officiel | `src/touma/lib/money.ts` |
| Téléphone | Longueur nationale par indicatif, normalisation E.164, indicatif du **compte** et non du serveur | `src/touma/lib/phone.ts` |
| Géographie | Hiérarchie par pays, rattachements **tous facultatifs**, repli texte libre | `prisma/schema.prisma` |
| Commerce | Langues, devises, moyens de paiement et transporteurs par pays | `ToumaTradeCountryConfig` |
| Corridors | Capacité réelle recalculée à chaque lecture, jamais déduite du statut déclaré | `src/touma/trade/corridor.service.ts` |
| Langues | Français et arabe, application et vitrine | `public/touma/i18n.js`, `apps/web/lib/i18n.ts` |

Dix occurrences de `'TD'` subsistent comme valeur par défaut de paramètres de
requête (routes géographiques, outils d'IA). Elles sont défendables — il faut
bien un défaut — mais elles font du Tchad le pays implicite ; elles sont
recensées et non supprimées, parce qu'aucune ne produit de donnée fausse.

## Les trois défauts trouvés

**1. Le Cameroun était déclaré ouvert sans l'être.** `active: true`,
achat et vente ouverts, pour un pays sans une seule division administrative
chargée et qu'aucun transporteur réel ne dessert. Un marché annoncé ouvert
par lequel rien ne peut passer : exactement le faux pays que §79 interdit,
et il était dans le seed depuis l'origine. Il est en `CONFIGURING`, achat
fermé, vente ouverte — des boutiques camerounaises existent réellement.

**2. `Country.timezone` était mort.** Le champ existait, le seed le
renseignait (`Africa/Ndjamena`, `Africa/Douala`), et aucun des 311 fichiers du
serveur ne le lisait. Les dates partaient en `toLocaleDateString('fr-FR')`
sans fuseau, donc dans celui du processus — UTC. Conséquence mesurée : une
commande passée à 00h30 à N'Djamena est stockée à 23h30 UTC la veille, et
l'assistant répondait « commande du 22 » à quelqu'un qui l'avait passée le 23.

**3. Le corridor pilote n'était dans aucun seed.** L'en-tête de
`prisma/seed.touma.ts` annonce « corridor pilote TD ↔ CM » depuis le début ;
le corridor n'existait que dans les tests. Une installation neuve n'avait
aucun corridor, et la page publique `/trade` était vide.

## Le cycle de vie d'un marché

```
PLANNED → CONFIGURING → TESTING → PILOT → ACTIVE ⇄ LIMITED
              ↓            ↓        ↓        ↓        ↓
                        SUSPENDED (depuis n'importe où)
                              ↓
                          DEPRECATED
```

On ne saute pas d'étape vers le haut. Vers le bas, tout est ouvert :
suspendre un marché qui va mal ne doit jamais demander de passer par un état
intermédiaire, parce que c'est en général au pire moment qu'on le fait.

Un marché suspendu ne rouvre pas directement en `ACTIVE` : ce qui l'a fait
suspendre doit être revérifié.

`status` et les interrupteurs `buyingEnabled` / `sellingEnabled` ne font pas
double emploi. Le premier dit **où en est le marché**, les seconds **ce qui
est ouvert aujourd'hui** — un marché peut être `ACTIVE` avec les paiements
suspendus (§46).

## Le contrôle de préparation

Quatorze domaines, chacun interrogeant réellement le système. Aucun ne répond
« OK » : le détail dit ce qui a été constaté, pour qu'un administrateur qui
lit `BLOCKED` sache quoi faire sans ouvrir le code.

**Quatre états, pas trois.** §4 prévoit `READY | WARNING | BLOCKED`. Il en
manque un, et son absence est un piège : que répondre pour la supervision d'un
pays, quand rien ne la mesure ? `READY` mentirait ; `WARNING` sous-entend
qu'on a regardé et qu'on a un doute, alors qu'on n'a pas regardé du tout.
`NOT_MEASURED` dit la seule chose vraie, et c'est ce que V25 §89 exige.

Aujourd'hui, `support`, `legal` et `analytics` sont `NOT_MEASURED` pour tous
les marchés. Ce n'est pas un aveu gênant : c'est la carte des angles morts.

Un contrôle bloquant ne bloque pas tous les statuts. L'expédition empêche le
pilote ; le prestataire de paiement n'empêche que l'ouverture pleine.

## Ce que le contrôle dit aujourd'hui

Le Tchad est `ACTIVE` et son contrôle répond que `ACTIVE` n'est **pas**
atteignable : aucun prestataire de paiement agréé, aucun transporteur réel.
C'est exact, et c'est le même constat que celui de V25. Le système ne
rétrograde pas de lui-même — fermer un marché est une décision, pas l'effet de
bord d'une sonde — mais il signale l'écart par `statutJustifie: false`.

## Les niveaux administratifs

La hiérarchie stockée (province → département → sous-préfecture → localité)
est celle des découpages ADM1/ADM2/ADM3 des Nations unies. Elle convient à la
quasi-totalité des pays africains. Ce qui ne convient pas, ce sont les
**noms** : « province » se dit « région » au Cameroun, et « sous-préfecture »
y est un « arrondissement ».

`ToumaCountryDivisionLevel` nomme donc les niveaux par pays au lieu de
renommer les tables. **C'est un choix délibéré contre la lettre de §7** :
remplacer la hiérarchie par un modèle générique `AdministrativeDivision`
aurait touché dix tables et toutes les adresses du Tchad, pour un gain nul —
les rattachements sont déjà tous facultatifs, et un pays qui n'a que deux
niveaux en laisse simplement deux vides.

## Ajouter un marché

1. Écrire `prisma/seeds/countries/XX.ts` — un descripteur déclaratif.
2. Le seed le valide avant d'écrire : code ISO, devise, indicatif, fuseau
   (jamais `UTC`), niveaux administratifs sans doublon de rang.
3. Charger une géographie depuis une **source citable**. Aucune donnée
   administrative n'est écrite de mémoire.
4. `POST /api/v1/admin/countries/XX/readiness` pour voir ce qui manque.
5. Avancer d'un statut à la fois, chaque fois motivé et tracé.

Il n'y a pas d'étape « écrire du code spécifique au pays », et c'est le but.
