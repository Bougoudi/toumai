import { contexteCourant } from '../middleware/request-context.js';

/**
 * Journal minimaliste, structuré, sans dépendance (V25 §18).
 *
 * Chaque ligne porte l'identifiant de la requête en cours quand il y en a une,
 * sans qu'aucun appelant n'ait à le transmettre : il est lu dans le contexte
 * asynchrone. C'est ce qui rend une trace lisible de bout en bout —
 * checkout → paiement → webhook → commande → expédition — au lieu d'obliger à
 * recouper des horodatages sur un serveur qui sert d'autres acheteurs à la
 * même seconde.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/** Seuil courant, lu dynamiquement depuis LOG_LEVEL (permet à la CLI de le baisser). */
function threshold(): number {
  const lvl = (process.env.LOG_LEVEL ?? 'info') as Level | 'silent';
  return ORDER[lvl] ?? ORDER.info;
}

function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const contexte = contexteCourant();
  const line = {
    ts: new Date().toISOString(),
    level,
    service: 'touma',
    msg,
    // Le contexte vient avant `meta` : un appelant qui passe explicitement un
    // `requestId` sait ce qu'il fait (il retrace un travail d'arrière-plan)
    // et doit pouvoir l'emporter.
    ...(contexte ? { requestId: contexte.requestId, ...(contexte.userId ? { userId: contexte.userId } : {}), ...(contexte.route ? { route: contexte.route } : {}) } : {}),
    ...(meta ?? {}),
  };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
