import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { logisticsService, registerLogisticsProvider } from '../../src/touma/logistics/logistics.service.js';
import type { LogisticsProvider } from '../../src/touma/logistics/logistics.types.js';
import { readiness } from '../../src/touma/health.js';

/**
 * DÉGRADATION GRACIEUSE (V25 §51-52, §74).
 *
 * Le système **affirme** qu'il dégrade proprement quand un prestataire tombe.
 * Ces tests le mettent à l'épreuve en provoquant de vraies pannes plutôt qu'en
 * relisant la documentation.
 *
 * La règle que chacun vérifie est toujours la même, et c'est la seule qui
 * compte : **ne jamais simuler une réussite**. Un tarif inventé engage un
 * vendeur sur un coût qu'il devra payer ; un paiement déclaré réussi fait
 * expédier une marchandise dont l'argent n'est jamais arrivé. Une panne franche
 * coûte bien moins cher qu'une fausse réussite.
 */
const api = new TestApi();

/** Transporteur qui tombe en panne à chaque appel. */
function transporteurEnPanne(code: string, dessert = true): LogisticsProvider {
  return {
    code,
    name: `Panne ${code}`,
    supports: () => dessert,
    async getQuote() {
      throw new Error('Prestataire injoignable (panne simulée par le test).');
    },
    async createShipment() {
      throw new Error('Prestataire injoignable (panne simulée par le test).');
    },
    async getTracking() {
      throw new Error('Prestataire injoignable (panne simulée par le test).');
    },
    async cancelShipment() {
      throw new Error('Prestataire injoignable (panne simulée par le test).');
    },
  };
}

/**
 * Transporteur neutralisé : il ne dessert plus rien.
 *
 * Le registre n'offre pas de retrait — seulement un enregistrement par code.
 * Écraser un code par un transporteur qui ne se déclare candidat nulle part
 * revient à le retirer, sans laisser derrière soi un prestataire qui lève.
 *
 * Sans cela, un transporteur ajouté par un test répond encore dans le
 * suivant : c'est exactement ce qui a fait passer pour vert un essai censé
 * prouver qu'aucun tarif n'est inventé quand plus personne ne répond.
 */
function transporteurRetire(code: string): LogisticsProvider {
  return { ...transporteurEnPanne(code, false), code, name: `Retiré ${code}` };
}

/** Transporteur qui répond normalement. */
function transporteurValide(code: string): LogisticsProvider {
  return {
    code,
    name: `Valide ${code}`,
    supports: () => true,
    async getQuote(request) {
      return [
        {
          providerCode: code,
          serviceName: 'Standard',
          amount: '2500',
          currency: request.currency,
          etaMinDays: 2,
          etaMaxDays: 5,
          ttlSeconds: 3600,
        },
      ];
    },
    async createShipment() {
      return { providerCode: code, trackingNumber: `T-${code}`, labelUrl: null, status: 'LABEL_CREATED' as const };
    },
    async getTracking() {
      return [];
    },
    async cancelShipment() {
      return { cancelled: true };
    },
  };
}

const demande = {
  origin: { countryCode: 'TD', city: "N'Djamena" },
  destination: { countryCode: 'TD', city: 'Abéché' },
  parcel: { weightGrams: 1200 },
  currency: 'XAF',
};

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});
after(async () => api.stop());

describe('Un transporteur qui tombe n’emporte pas les autres', () => {
  it('rend les tarifs des transporteurs qui répondent encore', async () => {
    const valide = `ok-${Math.random().toString(36).slice(2, 7)}`;
    const enPanne = `ko-${Math.random().toString(36).slice(2, 7)}`;
    registerLogisticsProvider(transporteurEnPanne(enPanne));
    registerLogisticsProvider(transporteurValide(valide));

    try {
      const devis = await logisticsService.quote(demande);
      assert.ok(devis.length > 0, 'les transporteurs valides répondent malgré la panne du voisin');
      assert.ok(devis.some((d: any) => d.providerCode === valide));
      // Aucun tarif ne porte le code du transporteur en panne : une panne ne
      // produit pas de ligne, elle en produit zéro.
      assert.ok(!devis.some((d: any) => d.providerCode.startsWith('ko-')));
    } finally {
      registerLogisticsProvider(transporteurRetire(valide));
      registerLogisticsProvider(transporteurRetire(enPanne));
    }
  });
});

describe('Quand plus personne ne répond', () => {
  it('refuse franchement plutôt que d’inventer un tarif', async () => {
    /**
     * Le cœur de §52.
     *
     * Un tarif deviné engage un vendeur sur un coût qu'il devra payer, et un
     * délai deviné devient une promesse faite à un acheteur. Mieux vaut dire
     * qu'on ne sait pas.
     *
     * Une première version de ce test visait une destination inexistante en
     * espérant que personne ne la desserve. Elle ne prouvait rien : le
     * transporteur de simulation accepte **toute** destination et produit un
     * tarif par formule — c'est sa nature, et c'est pourquoi `check:go-live`
     * refuse une ouverture au public tant qu'il est le seul enregistré.
     *
     * Le vrai essai consiste donc à faire tomber les transporteurs
     * **réellement enregistrés**, par leur code, puis à les rendre.
     */
    const { MockLogisticsProvider } = await import('../../src/touma/logistics/providers/mock.provider.js');
    const { ZoneLogisticsProvider } = await import('../../src/touma/logistics/providers/zone.provider.js');

    registerLogisticsProvider(transporteurEnPanne('mock'));
    registerLogisticsProvider(transporteurEnPanne('zones'));
    try {
      await assert.rejects(
        () => logisticsService.quote(demande),
        (err: any) => {
          assert.equal(err.statusCode, 400);
          // Ni montant ni délai dans le refus : le message dit l'absence, il
          // ne la comble pas.
          assert.ok(!/\d+\s*(XAF|FCFA)/.test(err.message), `un montant est apparu : ${err.message}`);
          assert.ok(!/\d+\s*(jour|jours)/.test(err.message), `un délai est apparu : ${err.message}`);
          return true;
        },
      );
    } finally {
      // Les transporteurs sont rendus : ce registre est partagé par le
      // processus, et un test qui casse la logistique pour les suivants
      // transforme une panne simulée en panne réelle.
      registerLogisticsProvider(new MockLogisticsProvider());
      registerLogisticsProvider(new ZoneLogisticsProvider());
    }
  });

  it('rend bien les transporteurs après l’essai', async () => {
    // Le nettoyage précédent est vérifié, pas supposé.
    const devis = await logisticsService.quote(demande);
    assert.ok(devis.length > 0, 'la logistique fonctionne de nouveau');
  });
});

describe('Redis absent ou injoignable', () => {
  it('ne rend pas l’instance indisponible', async () => {
    /**
     * §8 : rien de critique ne doit dépendre de Redis. Sur cette instance il
     * n'est pas installé ; la sonde doit donc rester prête, et la marquer
     * « requise » serait une régression silencieuse qui bloquerait tout
     * déploiement.
     */
    const rapport = await readiness();
    const redis = rapport.dependencies.find((d) => d.name === 'redis');
    assert.ok(redis, 'la sonde Redis est rapportée');
    assert.equal(redis.required, false, 'Redis ne doit jamais être une dépendance requise');
    if (redis.status !== 'ok') {
      assert.equal(rapport.ready, true, 'une instance sans Redis reste prête à servir');
    }
  });
});

describe('Assistance IA sans modèle réel', () => {
  it('répond tout de même, et dit que ce n’est pas un modèle', async () => {
    const acheteur = await registerUser(api, { name: 'Chaos IA', email: uniqueEmail('chaos-ia'), role: 'BUYER', countryCode: 'TD' });
    const res = await api.request('POST', '/api/v1/ai/chat', { token: acheteur.accessToken, body: { message: 'bonjour' } });

    if (res.status === 503) {
      // L'assistance est éteinte sur cette instance : dégradation franche,
      // acceptable. Ce qui ne le serait pas, c'est une réponse inventée.
      assert.match(JSON.stringify(res.body), /disponible|activé/i);
      return;
    }

    assert.equal(res.status, 200);
    /**
     * La garantie de §3 et §89 : l'interface doit pouvoir dire d'où vient la
     * réponse. Sans ce champ, un écran afficherait « assistance IA » alors
     * que ce sont des règles locales qui répondent.
     */
    assert.ok(res.body.source, 'la réponse déclare sa provenance');
    assert.equal(typeof res.body.source.realProviderConfigured, 'boolean');
    if (!res.body.source.realProviderConfigured) {
      assert.equal(res.body.source.provider, 'RULE_BASED');
      assert.match(res.body.source.note, /règles locales/i);
      // La note doit dire l'absence de modèle, pas la laisser deviner.
      assert.match(res.body.source.note, /aucun modèle|n’est configuré/i);
    }
  });

  it('ne fabrique pas de produit qui n’existe pas', async () => {
    const acheteur = await registerUser(api, { name: 'Chaos IA 2', email: uniqueEmail('chaos-ia2'), role: 'BUYER', countryCode: 'TD' });
    const terme = `objet-parfaitement-introuvable-${Date.now()}`;
    const res = await api.request('POST', '/api/v1/ai/chat', { token: acheteur.accessToken, body: { message: `je cherche un ${terme}` } });

    if (res.status !== 200) return;
    const rendu = JSON.stringify(res.body).toLowerCase();
    // §71 : si aucune donnée, dire que l'information n'est pas disponible —
    // pas proposer un article plausible.
    assert.ok(
      /aucun|pas trouv|indisponible|introuvable|rien/.test(rendu),
      `la réponse devrait reconnaître l’absence de résultat : ${rendu.slice(0, 250)}`,
    );
  });
});
