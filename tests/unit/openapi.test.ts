import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toumaV1Router } from '../../src/touma/touma.routes.js';
import { paymentWebhookRouter } from '../../src/touma/payments/payment.routes.js';
import { inventoryRoutes } from '../../src/touma/lib/routes-inventory.js';
import { toumaOpenApiDocument } from '../../src/touma/openapi.js';

/**
 * Le document OpenAPI dit de lui-même qu'il décrit « les points d'entrée
 * réellement implémentés, jamais des routes imaginaires ».
 *
 * Cette phrase ne tenait que par la vigilance de celui qui ajoute une route :
 * **quatre-vingt-une routes n'y figuraient pas**, dont toutes celles des V17 et
 * V20, et rien ne le signalait. Un document qui prétend décrire l'API et en
 * omet le tiers est plus coûteux que pas de document du tout — on s'y fie pour
 * conclure qu'un point d'entrée n'existe pas.
 *
 * Ces deux tests vérifient les **deux** moitiés de la phrase. La dérive devient
 * donc impossible à réintroduire en silence : elle casse la construction.
 */

/** Ce que le document déclare, sous forme « MÉTHODE /chemin ». */
function documented(): Set<string> {
  const doc = toumaOpenApiDocument() as { paths: Record<string, Record<string, unknown>> };
  const entrees = new Set<string>();
  for (const [chemin, operations] of Object.entries(doc.paths)) {
    for (const methode of Object.keys(operations)) entrees.add(`${methode.toUpperCase()} ${chemin}`);
  }
  return entrees;
}

/**
 * Le webhook est monté sur l'application, **avant** `express.json()`, parce
 * qu'il lui faut le corps brut pour vérifier sa signature. Il ne figure donc
 * pas dans l'inventaire du routeur v1, mais il fait bien partie de l'API
 * publique et doit rester documenté.
 */
const HORS_ROUTEUR_V1 = new Set(
  inventoryRoutes(paymentWebhookRouter, '/payments/webhook').map((r) => `${r.method} ${r.path}`),
);

describe('Le document OpenAPI', () => {
  it('décrit toutes les routes réellement montées', () => {
    const declarees = documented();
    const manquantes = inventoryRoutes(toumaV1Router)
      .map((r) => `${r.method} ${r.path}`)
      .filter((r) => !declarees.has(r))
      .sort();

    assert.deepEqual(
      manquantes,
      [],
      `Routes montées mais absentes du document OpenAPI :\n  ${manquantes.join('\n  ')}\n` +
        'Ajoutez-les dans src/touma/openapi.ts — un document qui en omet est pire qu’aucun document.',
    );
  });

  it('ne décrit aucune route qui n’existe pas', () => {
    // L'autre moitié de la promesse : inventer une route dans le document
    // enverrait un intégrateur écrire du code contre un point d'entrée qui
    // répondra 404.
    const montees = new Set([
      ...inventoryRoutes(toumaV1Router).map((r) => `${r.method} ${r.path}`),
      ...HORS_ROUTEUR_V1,
    ]);

    const imaginaires = [...documented()].filter((d) => !montees.has(d)).sort();

    assert.deepEqual(
      imaginaires,
      [],
      `Routes décrites mais non montées :\n  ${imaginaires.join('\n  ')}\n` +
        'Retirez-les du document, ou montez-les.',
    );
  });

  it('donne à chaque opération un résumé et des réponses', () => {
    const doc = toumaOpenApiDocument() as { paths: Record<string, Record<string, any>> };
    for (const [chemin, operations] of Object.entries(doc.paths)) {
      for (const [methode, operation] of Object.entries(operations)) {
        assert.ok(operation.summary, `${methode.toUpperCase()} ${chemin} : résumé manquant`);
        assert.ok(operation.responses?.['200'], `${methode.toUpperCase()} ${chemin} : réponse 200 manquante`);
        assert.ok(Array.isArray(operation.tags) && operation.tags.length > 0, `${methode.toUpperCase()} ${chemin} : sans étiquette`);
      }
    }
  });

  it('déclare chaque paramètre de chemin qu’il emploie', () => {
    // Un `{id}` dans l'URL sans paramètre déclaré rend le document
    // inexploitable par un générateur de client.
    const doc = toumaOpenApiDocument() as { paths: Record<string, Record<string, any>> };
    for (const [chemin, operations] of Object.entries(doc.paths)) {
      const attendus = [...chemin.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      if (attendus.length === 0) continue;
      for (const [methode, operation] of Object.entries(operations)) {
        const declares = (operation.parameters ?? []).filter((p: any) => p.in === 'path').map((p: any) => p.name);
        for (const nom of attendus) {
          assert.ok(declares.includes(nom), `${methode.toUpperCase()} ${chemin} : paramètre « ${nom} » non déclaré`);
        }
      }
    }
  });
});
