import type { Router } from 'express';

/**
 * Inventaire des routes réellement montées.
 *
 * **À quoi cela sert.** `openapi.ts` affirme décrire « les points d'entrée
 * réellement implémentés, jamais des routes imaginaires ». La première moitié
 * de cette phrase ne tenait que par la vigilance de celui qui ajoute une route :
 * onze points d'entrée ajoutés en V17 et V20 n'y figuraient pas, et rien ne le
 * signalait. Un document qui prétend décrire l'API et en omet la moitié est une
 * forme de mensonge plus coûteuse que l'absence de document — on s'y fie.
 *
 * Cet inventaire est lu par un test qui refuse toute route non documentée. La
 * dérive devient donc impossible à réintroduire en silence : elle casse la
 * construction.
 *
 * Express n'expose pas d'API publique pour cela ; on descend dans sa pile de
 * couches. C'est une dépendance à un détail interne, et c'est assumé : le seul
 * autre moyen d'obtenir la vérité serait de la recopier à la main, c'est-à-dire
 * exactement ce qu'on cherche à éviter.
 */

export interface MountedRoute {
  method: string;
  /** Chemin complet, au format OpenAPI : `/products/{id}`. */
  path: string;
}

/**
 * `/:id` → `/{id}`, la convention OpenAPI.
 *
 * La barre oblique finale est retirée : `router.get('/')` monté sur `/cart`
 * donne `/cart/`, qui est la **même** route que `/cart` et créerait un faux
 * doublon dans l'inventaire. La racine `/` est préservée : elle désigne l'index
 * de l'API et n'est pas vide.
 */
function toOpenApiPath(path: string): string {
  const avecAccolades = path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  return avecAccolades.length > 1 && avecAccolades.endsWith('/') ? avecAccolades.slice(0, -1) : avecAccolades;
}

/**
 * Reconstruit le motif d'une couche de montage (`router.use('/x', sub)`).
 *
 * Express ne conserve que l'expression régulière compilée ; `layer.regexp`
 * n'est pas lisible, mais `layer.path` l'est dans les versions récentes et
 * `keys` donne les paramètres. On retombe sur l'expression quand il le faut.
 */
function mountPath(layer: any): string {
  if (typeof layer.path === 'string') return layer.path;

  const source: string = layer.regexp?.source ?? '';
  if (!source || source === '^\\/?(?=\\/|$)') return '';

  // Motif d'un `use('/prefixe')` : ^\/prefixe\/?(?=\/|$)
  const nettoye = source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/');

  // Les paramètres compilés redeviennent leurs noms d'origine.
  const noms: string[] = (layer.keys ?? []).map((k: any) => String(k.name));
  let i = 0;
  return nettoye.replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => `:${noms[i++] ?? 'param'}`);
}

/** Toutes les routes d'un routeur, chemins parents compris. */
export function inventoryRoutes(router: Router, prefix = ''): MountedRoute[] {
  const routes: MountedRoute[] = [];
  const stack: any[] = (router as any).stack ?? [];

  for (const layer of stack) {
    if (layer.route) {
      const chemin = `${prefix}${layer.route.path}`;
      for (const [method, actif] of Object.entries(layer.route.methods as Record<string, boolean>)) {
        // `_all` n'est pas un verbe HTTP : c'est le fourre-tout d'Express.
        if (!actif || method === '_all') continue;
        routes.push({ method: method.toUpperCase(), path: toOpenApiPath(chemin) });
      }
      continue;
    }

    if (layer.name === 'router' && layer.handle?.stack) {
      routes.push(...inventoryRoutes(layer.handle as Router, `${prefix}${mountPath(layer)}`));
    }
  }

  // Une même route peut être déclarée plusieurs fois (middleware par méthode) :
  // on la compte une fois.
  const vues = new Set<string>();
  return routes.filter((r) => {
    const cle = `${r.method} ${r.path}`;
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });
}
