-- TOUMA V20 — la contrainte de fidélité retrouve son intention
--
-- L'unicité (orderId, type) avait été posée pour empêcher qu'une livraison
-- rejouée crédite deux fois les points. C'est juste — pour le GAIN. Mais elle
-- s'appliquait à tous les types, et interdisait donc une seconde reprise de
-- points sur la même commande : un deuxième remboursement partiel violait la
-- contrainte et le serveur répondait 500.
--
-- On la remplace par un index unique PARTIEL, qui dit exactement ce qu'on
-- voulait dire : un seul gain par commande, et autant de reprises que de
-- remboursements.

-- DropIndex
DROP INDEX "touma_loyalty_events_orderId_type_key";

-- CreateIndex
CREATE INDEX "touma_loyalty_events_orderId_type_idx" ON "touma_loyalty_events"("orderId", "type");

-- Un seul gain par commande. Les reprises ne sont pas contraintes.
CREATE UNIQUE INDEX "touma_loyalty_events_order_earned_key"
  ON "touma_loyalty_events"("orderId")
  WHERE "type" = 'EARNED' AND "orderId" IS NOT NULL;
