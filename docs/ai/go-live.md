# Mise en service de Touma Intelligence

## Ce qui fonctionne aujourd'hui, sans rien configurer

L'assistant répond. Recherche de produits en français avec budget et
destination, comparaison, commandes, suivi, dépenses par devise, réachat,
confiance d'un vendeur, analyse de ventes et de stock, recherche de
fournisseurs, comparaison de devis, brouillons de fiche et de demande de
devis, agent d'administration en lecture.

Aucune clé n'est requise. C'est le repli `RULE_BASED` qui répond, et l'écran
le dit à chaque tour.

## Pour brancher un modèle réel

1. Choisir un fournisseur — `OPENAI`, `ANTHROPIC` ou `LOCAL`.
2. Poser `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` dans l'environnement, jamais
   dans Git. Pour `LOCAL`, poser aussi `AI_BASE_URL`.
3. Vérifier `GET /api/v1/ai/provider` : `realProviderConfigured` doit passer à
   `true`.
4. Surveiller `GET /api/v1/admin/ai/usage` les premiers jours, et ajuster
   `AI_LIMIT_PLATFORM_COST_DAY`.

Rien d'autre ne change. Les outils, les permissions, la confirmation humaine
et l'audit sont identiques avec ou sans modèle.

## Coupe-circuits

```
TOUMA_AI_ENABLED=false              # tout /ai répond 503
TOUMA_AI_CHAT_ENABLED=false
TOUMA_AI_SELLER_COPILOT_ENABLED=false
TOUMA_AI_BUSINESS_ENABLED=false
TOUMA_AI_ADMIN_ENABLED=false
TOUMA_AI_RECOMMENDATIONS_ENABLED=false
TOUMA_AI_EMBEDDINGS_ENABLED=true    # fermé par défaut
TOUMA_AI_AUTOMATION_ENABLED=true    # fermé par défaut
```

Embeddings et automatisation sont fermés par défaut : les premiers coûtent à
chaque écriture de produit et n'ont d'intérêt qu'avec un fournisseur réel ; la
seconde laisserait l'IA déclencher des actions sans qu'on la regarde.

## Ce qui n'est pas fait, et qui reste à décider

**Recherche sémantique.** §32 et §55 demandent des embeddings et un index
vectoriel. `RULE_BASED` refuse de produire un vecteur, et aucun pgvector n'est
installé. La recherche passe par PostgreSQL, ce que §32 autorise
explicitement (« PostgreSQL fallback obligatoire »). Un fournisseur réel plus
pgvector ouvrirait cette voie ; c'est une décision d'infrastructure.

**Traduction (§16).** `LanguageService` n'est pas écrit. Les réponses de
l'assistant sont composées en français, et l'écran le dit plutôt que de le
taire. Traduire suppose un modèle réel : une traduction par règles locales
serait pire que pas de traduction.

**Intelligence d'image (§15).** `ImageAIProvider` n'est pas écrit.

**Prix, demande, anomalies (§20, §21).** `PriceIntelligenceService` et
`DemandSignal` ne sont pas écrits comme services dédiés. Ce qui existe :
`growth/price-history.ts` (V22) porte déjà l'historique de prix et le prix de
référence vérifié, et `admin/intelligence.service.ts` (antérieur) porte la
demande non satisfaite et la tension de stock. Les outils IA s'y adossent.
Un service d'anomalie de prix reste à écrire.

**Tests A/B, automatisation marketing, lots (V22).** Toujours ouverts.

## Décisions qui n'appartiennent pas au code

Elles sont inchangées depuis V17 et V20, et aucune n'a été tranchée :
prestataire de paiement, transporteur, canal SMS ou WhatsApp, régime de TVA
réel, identifiants S3, les sept questions juridiques de
`docs/payments/compliance-boundaries.md`, fournisseur de vérification
d'entreprise, barème de parrainage, conseil juridique sur la règle des
trente jours du prix de référence.

S'y ajoute, propre à V23 : **quel fournisseur d'IA, et sous quel contrat de
traitement des données**. Un modèle hébergé hors du continent reçoit des
extraits de descriptions de produits et de questions d'acheteurs, minimisés
mais réels. C'est une décision de conformité autant que de coût.
