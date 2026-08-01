# 🔎 Brancher la recherche intelligente (photo + code-barres)

Ce guide explique, **pas à pas**, comment activer en production :
- 📷 **la recherche par photo** (reconnaissance d'image) ;
- 🔳 **le scan de code-barres** (retrouver le vrai produit).

> **Déjà gratuit, rien à faire :** *lire* un code-barres ou *prendre* une photo
> avec la caméra fonctionne nativement sur le téléphone (Chrome/Android), sans
> service ni clé. Ce guide concerne uniquement la partie **« reconnaître »** :
> transformer l'image / le code en produit réel.

Toutes ces valeurs se collent dans les **variables d'environnement** de ton
hébergeur (Render → *Environment*). Après les avoir ajoutées, redéploie.

---

## 📷 1. Recherche par photo — Google Cloud Vision (recommandé)

Google Cloud Vision reconnaît des milliers d'objets et coûte ~1,50 $ / 1000 images
(les 1000 premières chaque mois sont gratuites).

1. Va sur **https://console.cloud.google.com** → crée un projet (ex. « toumai »).
2. Menu **APIs & Services → Library** → cherche **Cloud Vision API** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**. Copie la clé (`AIza...`).
   - (Recommandé) **Restrict key** → limite-la à l'API *Cloud Vision*.
4. Dans Render, ajoute **deux** variables :
   ```
   VISION_PROVIDER = google
   VISION_API_KEY  = AIza...
   ```
5. Redéploie. C'est tout : Toumai envoie la photo à Google, récupère les objets
   détectés et cherche les produits correspondants.

> **Facturation** : Google demande d'activer la facturation sur le projet, mais
> l'usage reste gratuit jusqu'à 1000 images/mois. Tu peux fixer un **quota** pour
> éviter tout dépassement (APIs & Services → Cloud Vision → Quotas).

### Autre service de vision (générique)
Si tu utilises un autre fournisseur qui accepte `POST {url}` avec l'en-tête
`Authorization: Bearer {clé}` et un corps `{ "image": "<base64>" }` renvoyant
`{ "labels": [{ "label": "...", "confidence": 0.9 }] }` :
```
VISION_API_URL = https://ton-service/detect
VISION_API_KEY = ta_cle
```
(Les formats AWS Rekognition et Google « à plat » sont aussi reconnus.)

---

## 🔳 2. Scan de code-barres

### Option A — Open Food Facts (gratuit, sans clé) — idéal pour tester
Parfait pour l'**alimentaire / produits de grande conso**. Aucune inscription.
```
BARCODE_API_URL = https://world.openfoodfacts.org/api/v2/product/{code}.json
```
Le `{code}` est remplacé par le code scanné. Redéploie → le scan renvoie le vrai
produit (nom, marque, image).

### Option B — Barcode Lookup / UPCitemdb (catalogue plus large, avec clé)
Pour couvrir tous types de produits (pas seulement l'alimentaire) :
1. Crée un compte sur **https://www.barcodelookup.com/api** (ou **https://www.upcitemdb.com**).
2. Récupère ta **clé API**.
3. Dans Render :
   ```
   BARCODE_API_URL = https://api.barcodelookup.com/v3/products?barcode={code}
   BARCODE_API_KEY = ta_cle
   ```

> **Formats reconnus automatiquement** : générique `{ title, brand, category,
> image, price }`, **UPCitemdb** (`items[]`), **Barcode Lookup** (`products[]`),
> **Open Food Facts** (`product{}`). Si ton fournisseur diffère, adapte
> `src/automation/connectors/barcode/http.barcode.connector.ts` (méthode `mapProduct`).

---

## ✅ 3. Vérifier que ça marche

Après redéploiement :

1. **Photo** : onglet **Recherche → 📷 Caméra**, mode *Prendre une photo*, capture
   un objet → tu dois voir un toast **« Détecté : … »** et des résultats.
2. **Scanner** : mode *Scanner code-barres*, vise un code (sur Android Chrome) →
   le produit réel s'affiche. En test rapide, un produit alimentaire courant avec
   Open Food Facts (ex. un pot de Nutella) fonctionne bien.

Si rien n'est configuré, les deux fonctions continuent de marcher en **mode
démonstration** (photo → mot-clé ; scan → produit d'exemple) : aucune panne.

---

## 🧭 Récapitulatif des variables

| Variable | Rôle | Exemple |
|---|---|---|
| `VISION_PROVIDER` | `google` pour Google Cloud Vision | `google` |
| `VISION_API_KEY` | clé de vision | `AIza...` |
| `VISION_API_URL` | (service générique uniquement) | `https://.../detect` |
| `BARCODE_API_URL` | base codes-barres (`{code}` = code scanné) | `https://world.openfoodfacts.org/api/v2/product/{code}.json` |
| `BARCODE_API_KEY` | clé code-barres (optionnelle) | `abc123` |

> 💡 Commence **gratuitement** : Open Food Facts (scan) + le palier gratuit de
> Google Vision (photo). Tu passes à un service payant seulement quand le volume
> le justifie.
