# Fiches d'incident

Une fiche par panne **réellement possible sur cette installation**. Les
scénarios qui supposent un composant absent ne sont pas écrits : une fiche
« panne Redis » alors qu'aucun Redis n'est installé ferait perdre du temps au
pire moment, et donnerait à penser que l'inventaire est à jour alors qu'il ne
l'est pas.

| Fiche | Quand |
|---|---|
| `base-de-donnees.md` | PostgreSQL injoignable ou lent |
| `paiement.md` | le prestataire de paiement ne répond plus |
| `webhooks.md` | les notifications de paiement n'arrivent plus |
| `transport.md` | le transporteur ne répond plus |
| `ia.md` | l'assistance ne répond plus |
| `retour-arriere.md` | un déploiement a cassé quelque chose |
| `incident-securite.md` | secret fuité, accès suspect |
| `integrite-donnees.md` | un contrôle d'intégrité passe au rouge |

**Non écrites, et pourquoi** : `redis.md` et `recherche.md` — ni Redis ni
OpenSearch ne sont installés, la recherche s'exécute en SQL. Elles seront à
écrire le jour où ces composants existeront.

## Règle commune à toutes

Dégrader proprement, et **ne jamais simuler une réussite**. Un paiement dont
on ignore l'issue reste en attente ; il ne devient pas « réussi » parce que le
prestataire ne répond pas.
