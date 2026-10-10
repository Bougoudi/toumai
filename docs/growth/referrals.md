# Parrainage

**Fermé par défaut** (`TOUMA_GROWTH_REFERRALS_ENABLED=false`).

## Pourquoi fermé

Un programme de parrainage est une machine à fabriquer de la fraude s'il
récompense la simple inscription : il suffit alors de créer des comptes. Ce
levier s'ouvre quand quelqu'un a décidé de l'exploiter et de le surveiller.

## Les trois choix qui structurent le module

1. **La récompense suit une commande terminée**, pas une inscription. Un faux
   compte ne rapporte rien tant qu'il n'a pas acheté, reçu et payé. Une commande
   payée puis annulée ne qualifie personne.
2. **Un compte n'est parrainé qu'une fois**, et la contrainte est **en base**
   (`refereeId @unique`). Dans le service seul, elle ne tiendrait pas sous deux
   inscriptions simultanées.
3. **Les liens évidents sont refusés** — soi-même, un téléphone partagé — et un
   signal est consigné pour le moteur de risque V21, qui décide. Le parrainage
   ne prononce aucune sanction : il signale.

## Ce qui n'est pas regardé

Ni adresse IP, ni empreinte d'appareil. TOUMA ne les collecte pas, et la
minimisation des données tranche dans ce sens tant que personne n'a examiné la
question au Tchad.

## Ce que le parrain voit

Un code, et des décomptes : invités, qualifiés, récompensés, écartés.

**Aucune donnée personnelle du filleul** : ni nom, ni adresse électronique, ni
ce qu'il a acheté. Quelqu'un qui a accepté une invitation n'a pas accepté d'être
suivi.

Le **motif** d'un écartement n'est pas rendu non plus : il dirait au parrain
quelle tentative a été repérée, donc comment la déguiser la prochaine fois.

## Le code

Huit caractères, tirés d'un alphabet sans confusions : ni `O`/`0`, ni `I`/`1`/`L`.
Un code se dicte au téléphone, il doit pouvoir être retapé.

## Ce qui n'existe pas encore

**Le barème.** Un parrainage qualifié passe à `QUALIFIED` et attend une décision
d'administration. Verser automatiquement des points supposerait un barème que
personne n'a arrêté — et un barème inventé coûte de l'argent réel.

Un code de parrainage erroné **ne refuse jamais une inscription** : le
parrainage est perdu, le compte est créé.
