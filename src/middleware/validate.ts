import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, infer as zInfer } from 'zod';

/**
 * Enveloppe un handler asynchrone pour propager les rejets vers le
 * gestionnaire d'erreurs Express (évite les try/catch répétitifs).
 */
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/** Valide et type le corps de la requête à partir d'un schéma Zod. */
export function parseBody<S extends ZodTypeAny>(schema: S, req: Request): zInfer<S> {
  return schema.parse(req.body);
}

/** Valide et type les query params à partir d'un schéma Zod. */
export function parseQuery<S extends ZodTypeAny>(schema: S, req: Request): zInfer<S> {
  return schema.parse(req.query);
}
