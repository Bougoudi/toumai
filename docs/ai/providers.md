# Fournisseurs d'IA

## Ce qui est réellement implémenté

| Code | Format de fil | État |
|---|---|---|
| `RULE_BASED` | aucun (local) | **actif par défaut** |
| `OPENAI` | `/chat/completions` | implémenté, vérifié en test |
| `LOCAL` | `/chat/completions` | implémenté (vLLM, Ollama, llama.cpp) |
| `ANTHROPIC` | `/v1/messages` | implémenté, vérifié en test |
| `GOOGLE` | — | **non implémenté** |

`GOOGLE` figure dans le cahier des charges et pas dans le code. L'enregistrer
vide ferait croire qu'il suffit d'une clé pour l'activer.

Les deux fournisseurs HTTP sont vérifiés en test contre un serveur factice :
ce qui est écrit est ce qui part sur le réseau — la consigne système dans son
propre champ pour Anthropic, dans un message `system` pour OpenAI.

## Configuration

```
AI_PROVIDER=       # RULE_BASED (défaut) | OPENAI | ANTHROPIC | LOCAL
AI_MODEL=          # identifiant du modèle chez le fournisseur
AI_API_KEY=        # jamais dans le code, jamais en base, jamais en Git
AI_BASE_URL=       # obligatoire pour LOCAL ; par défaut pour les autres
AI_FAST_MODEL=     # tâches courtes (classement, modération)
AI_REASONING_MODEL=# analyses et sorties structurées
AI_TIMEOUT_MS=20000
```

Sans les trois premières, aucun fournisseur externe n'est construit. Ce n'est
pas un demi-état : un fournisseur à moitié configuré serait enregistré, choisi
par le routage, puis échouerait à chaque appel.

**Aucune table `AiProviderConfig` n'a été créée**, bien que §58 la nomme. Une
table de configuration de fournisseur invite à y ranger une clé, ce que V20
§21 interdit. Les secrets restent dans l'environnement.

## Le repli

`RULE_BASED` est enregistré au chargement du module et ne peut pas être
retiré. C'est ce qui permet d'affirmer §47 — l'application fonctionne sans IA
externe — sans le vérifier fonctionnalité par fonctionnalité.

Il s'appelait `mock`. Le nom était faux : il ne simule rien, il calcule sur le
catalogue réel. Un nom qui laisse croire à de la donnée fictive sur une brique
qui produit de la donnée réelle est un mensonge dans l'autre sens, et il coûte
autant.

Ce qu'il sait faire : générer du texte à partir de faits reçus, analyser une
intention d'achat en français, modérer par lexique, classer par recouvrement
de mots. Ce qu'il refuse : produire un embedding. Un vecteur produit par
hachage local passerait le typage et porterait le nom « sémantique » sans
l'être. La recherche se replie alors sur PostgreSQL, qui est moins fin mais
dit la vérité sur ce qu'il fait.

## Le repli est annoncé

`fallback` et `fallbackReason` remontent jusqu'à l'écran. Un utilisateur a le
droit de savoir qu'il lit une réponse produite par des règles locales plutôt
que par le modèle annoncé — c'est la même exigence que pour un paiement dont
le prestataire n'est pas branché.
