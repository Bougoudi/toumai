# TOUMA — la marque

## Le signe

Un soleil qui se lève sur un horizon, et une route qui s'éloigne.

**Pourquoi celui-ci.** Le dépôt s'appelle `toumai`. Toumaï est le fossile
découvert au Tchad en 2001 — et le mot signifie « espoir de vie ». Si le nom de
la place de marché vient de là, c'est cette idée qu'une marque doit porter :
une aube, pas une flèche de logistique.

Le soleil **touche** l'horizon : il se lève, il ne flotte pas. L'horizon déborde
de chaque côté — la ligne continue au-delà de ce qu'on voit. La route s'efface à
petite taille, et c'est voulu : au favicon il ne doit rester que le soleil et
l'horizon.

## Ce qui a été écarté, et pourquoi

Trois pistes ont précédé celle-ci, toutes abandonnées après rendu :

- **deux flèches en boucle** — c'était le pictogramme « actualiser » de
  n'importe quelle application ; il ne disait pas TOUMA ;
- **un T aux pointes fléchées** — lu comme un marteau, et le retailler en
  pointe franche a aggravé le défaut au lieu de le corriger ;
- **une arche de marché** — évoquait une pierre tombale autant qu'une porte.

Aucune forme ne reprend de symbole religieux, national ni ethnique : la marque
doit pouvoir être portée par un vendeur de N'Djamena comme par un acheteur de
Douala. Le signe est **symétrique** : il ne se retourne pas en écriture de
droite à gauche, et l'en-tête arabe le montre.

## Les fichiers

| Fichier | Emploi |
|---|---|
| `img/logo.svg` | en-tête, favicon, source de tout le reste |
| `img/logo-mono.svg` | une seule encre — facture imprimée, tampon |
| `img/logo-lockup.svg` | signe + nom + baseline, pour un document |
| `img/icon-192.png`, `icon-512.png` | icônes d'application |
| `img/icon-maskable-512.png` | masque Android, 10 % de marge de sûreté |
| `img/favicon-32.png` | repli pour les navigateurs sans favicon vectoriel |

**Les PNG sont rendus depuis le SVG**, jamais redessinés. Les redessiner à la
main les ferait diverger du logo à la première retouche — et personne ne s'en
apercevrait avant de voir l'application installée sur un téléphone. Le script de
rendu est dans l'historique de ce commit ; le relancer suffit à les refaire.

## Le dessin n'est pas dans la feuille de style

`.brand-mark` ne porte plus qu'une taille. Le carré arrondi et le dégradé font
partie du logo lui-même : les reproduire en CSS les ferait diverger.

## Couleurs

Aucune couleur nouvelle. Le signe emploie les jetons existants :
`--green-600` → `--green-900` pour le fond, `--touma-orange` pour le soleil,
`--touma-cream` pour l'horizon.

## Changer d'avis

Le signe vit dans un seul fichier. Remplacer `img/logo.svg` et relancer le rendu
des PNG suffit à changer la marque partout — en-tête, favicon, application
installée, facture.
