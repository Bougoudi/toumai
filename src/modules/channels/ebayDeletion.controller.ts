import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Notification eBay de « suppression / fermeture de compte » (RGPD).
 * Obligatoire pour activer un jeu de clés Production.
 *
 * URL à déclarer dans le portail développeur eBay :
 *   `${PUBLIC_URL}/api/ebay/account-deletion`
 * avec le même jeton de vérification que `EBAY_VERIFICATION_TOKEN`.
 */
function endpointUrl(): string {
  return `${env.publicUrl.replace(/\/$/, '')}/api/ebay/account-deletion`;
}

export const ebayDeletionController = {
  /**
   * GET — défi de validation. eBay envoie `?challenge_code=…` ; on renvoie
   * `{ challengeResponse: sha256(challengeCode + token + endpointUrl) }`.
   */
  challenge(req: Request, res: Response) {
    const challengeCode = (req.query.challenge_code as string | undefined) ?? '';
    const token = env.ebay.verificationToken;
    if (!token) {
      logger.warn('eBay account-deletion : EBAY_VERIFICATION_TOKEN non défini');
      return res.status(503).json({ error: 'EBAY_VERIFICATION_TOKEN non configuré.' });
    }
    if (!challengeCode) return res.status(400).json({ error: 'challenge_code manquant.' });

    const challengeResponse = createHash('sha256')
      .update(challengeCode)
      .update(token)
      .update(endpointUrl())
      .digest('hex');
    res.status(200).json({ challengeResponse });
  },

  /**
   * POST — notification réelle : eBay signale qu'un utilisateur a supprimé son
   * compte. On accuse réception (200) ; aucune donnée eBay personnelle n'est
   * conservée hors des commandes déjà traitées.
   */
  notify(req: Request, res: Response) {
    logger.info('Notification eBay de suppression de compte reçue', {
      body: JSON.stringify(req.body ?? {}).slice(0, 300),
    });
    res.status(200).send();
  },
};
