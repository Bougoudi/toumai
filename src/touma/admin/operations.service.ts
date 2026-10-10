import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { readiness } from '../health.js';
import { estSimulation } from '../trade/corridor.service.js';
import { fxService } from '../trade/fx.service.js';
import { providerStatus as providerStatusIa } from '../ai/registry.js';
import { integrityService } from './integrity.service.js';
import { incidentService } from './incident.service.js';
import { PERMISSIONS_ADMIN } from './permissions.js';

/**
 * CENTRE D'OPÉRATIONS (V25 §53, §86).
 *
 * Un tableau de bord d'exploitation est l'endroit où l'on ment le plus
 * facilement, et où le mensonge coûte le plus cher : c'est l'écran qu'on
 * regarde à trois heures du matin pour décider s'il faut réveiller quelqu'un.
 *
 * §89 le dit sans détour — interdit d'afficher « système sain » si les
 * services critiques ne sont pas réellement vérifiés, interdit d'afficher
 * « prestataire de paiement opérationnel » si aucune vérification n'a été
 * faite. Chaque ligne d'ici vient donc soit d'une sonde exécutée à l'instant,
 * soit d'un état lu en base. Rien n'est déduit de la présence d'un fichier de
 * configuration.
 *
 * Et ce qui **n'est pas mesuré** est écrit comme tel — `NON_INSTRUMENTE` —
 * plutôt que rendu en vert. Une case verte pour une chose que personne ne
 * mesure est exactement ce qui fait rater un incident.
 */

export type EtatService = 'OK' | 'DEGRADE' | 'INDISPONIBLE' | 'NON_CONFIGURE' | 'NON_INSTRUMENTE';

export interface LigneService {
  name: string;
  status: EtatService;
  /** Ce que cet état veut dire, en clair. Jamais un code seul. */
  detail: string;
  latencyMs?: number;
}

/** Transporteurs réellement enregistrés, simulations exclues. */
async function transporteurs(): Promise<LigneService> {
  const actifs = await prisma.toumaShippingProvider.findMany({ where: { active: true }, select: { code: true } });
  const reels = actifs.filter((t) => !estSimulation(t.code));
  const simules = actifs.filter((t) => estSimulation(t.code));

  if (reels.length > 0) {
    return { name: 'Transporteurs', status: 'OK', detail: `${reels.length} transporteur(s) réel(s) : ${reels.map((t) => t.code).join(', ')}.` };
  }
  return {
    name: 'Transporteurs',
    status: 'NON_CONFIGURE',
    detail:
      simules.length > 0
        ? `Aucun transporteur réel. Seule une simulation est enregistrée (${simules.map((t) => t.code).join(', ')}), et une simulation n’achemine aucun colis.`
        : 'Aucun transporteur enregistré.',
  };
}

export const operationsService = {
  async overview() {
    const [sondes, integrite, transport, admins, demandesSuppression, incidents] = await Promise.all([
      readiness(),
      integrityService.run(),
      transporteurs(),
      prisma.user.count({ where: { toumaRole: 'ADMIN', adminScoped: false, status: 'ACTIVE' } }),
      prisma.toumaAccountDeletionRequest.count({ where: { status: 'PENDING' } }),
      incidentService.ouverts(),
    ]);

    const etatIa = providerStatusIa();
    const base = sondes.dependencies.find((d) => d.name === 'postgres');
    const redis = sondes.dependencies.find((d) => d.name === 'redis');

    const infrastructure: LigneService[] = [
      {
        name: 'PostgreSQL',
        status: base?.status === 'ok' ? 'OK' : 'INDISPONIBLE',
        detail: base?.status === 'ok' ? 'Source de vérité joignable.' : (base?.detail ?? 'Injoignable.'),
        latencyMs: base?.latencyMs,
      },
      {
        name: 'Redis',
        status: redis?.status === 'ok' ? 'OK' : redis?.status === 'skipped' ? 'NON_CONFIGURE' : 'INDISPONIBLE',
        /**
         * Le texte de l'état « joignable » disait « PING TCP effectué. » —
         * exact, et sans intérêt pour qui lit cet écran à trois heures du
         * matin. Ce qu'il faut savoir tient en une phrase : ce que sa
         * disparition coûterait. Ici, rien de critique (§8).
         *
         * Mon poste n'avait pas de Redis, l'intégration continue en a un :
         * ce texte-là ne s'affichait donc jamais localement, et c'est elle
         * qui l'a montré.
         */
        detail:
          redis?.status === 'skipped'
            ? 'Aucun Redis configuré. Aucune donnée critique n’en dépend : tout est récupérable depuis PostgreSQL.'
            : redis?.status === 'ok'
              ? 'Joignable. Aucune donnée critique n’en dépend : une disparition de Redis ne perd rien, tout reste en base.'
              : `Configuré mais injoignable : ${redis?.detail ?? 'cause inconnue'}. Sans conséquence sur les données, qui vivent dans PostgreSQL.`,
        latencyMs: redis?.latencyMs,
      },
      {
        name: 'Stockage objet',
        status: env.storage.enabled ? 'OK' : 'NON_CONFIGURE',
        detail: env.storage.enabled
          ? 'Stockage objet configuré.'
          : 'Aucun stockage objet : les pièces jointes vont sur le disque local, qui disparaît avec le conteneur.',
      },
      {
        name: 'Moteur de recherche',
        status: 'NON_CONFIGURE',
        detail: 'Aucun OpenSearch installé. La recherche s’exécute en SQL sur PostgreSQL — c’est le fonctionnement nominal, pas une dégradation.',
      },
      {
        name: 'File d’attente',
        status: 'NON_CONFIGURE',
        detail: 'Aucune file d’attente. Les travaux périodiques passent par node-cron, dans le processus de l’API.',
      },
    ];

    const prestataires: LigneService[] = [
      {
        name: 'Paiement',
        status: sondes.adapters.paymentsReal ? 'OK' : 'NON_CONFIGURE',
        detail: sondes.adapters.paymentsMessage,
      },
      transport,
      {
        /**
         * L'état vient de `providerStatus()`, qui sait si un modèle réel
         * répond — pas d'une comparaison de chaîne sur le nom configuré.
         *
         * La première version comparait `aiProvider !== 'rule_based'` et
         * affichait « OK — prestataire "mock" configuré » : exactement la
         * fausse déclaration que §89 interdit, dans le module écrit pour
         * l'empêcher. Un adaptateur nommé dans la configuration n'est pas un
         * modèle qui répond.
         */
        name: 'Assistance IA',
        status: etatIa.realProviderConfigured ? 'OK' : 'NON_CONFIGURE',
        detail:
          etatIa.realProviderConfigured
            ? `Modèle réel actif : ${etatIa.name}.`
            : (etatIa.message ?? 'Aucun prestataire d’IA réel : repli déterministe, qui refuse d’inventer plutôt que de répondre à côté.'),
      },
      {
        name: 'Taux de change',
        status: fxService.status().configured ? 'OK' : 'NON_CONFIGURE',
        detail: fxService.status().message ?? 'Aucune source de taux configurée.',
      },
    ];

    /**
     * Ce que personne ne mesure, dit comme tel.
     *
     * Les afficher en « OK » parce qu'aucune erreur n'a été vue reviendrait à
     * confondre « rien de cassé » et « rien de surveillé ».
     */
    const nonInstrumente: LigneService[] = [
      {
        name: 'Sauvegardes',
        status: 'NON_CONFIGURE',
        detail:
          'Aucune sauvegarde automatique de PostgreSQL n’est configurée dans ce dépôt. ' +
          'Une perte de la base serait définitive. C’est un bloqueur de mise en service — voir docs/operations/backups.md.',
      },
      {
        name: 'Métriques',
        status: 'NON_INSTRUMENTE',
        detail: 'Aucun collecteur de métriques installé. Latences et taux d’erreur ne sont pas agrégés.',
      },
      {
        name: 'Alertes',
        status: 'NON_INSTRUMENTE',
        detail: 'Aucune alerte : rien ne préviendra personne. Les alertes supposent un collecteur.',
      },
      {
        name: 'Travaux périodiques',
        status: env.touma.maintenanceEnabled ? 'NON_INSTRUMENTE' : 'NON_CONFIGURE',
        detail: env.touma.maintenanceEnabled
          ? 'Entretien actif, mais aucune trace de dernière exécution n’est conservée : on ne peut pas dire ici quand il a tourné pour la dernière fois.'
          : 'Entretien désactivé (TOUMA_MAINTENANCE_ENABLED=false).',
      },
    ];

    const securite = {
      adminsNonCadres: admins,
      detail:
        admins > 0
          ? `${admins} administrateur(s) conservent l’accès complet hérité d’avant le découpage des permissions. Le cloisonnement reste partiel tant qu’ils ne sont pas cadrés.`
          : 'Tous les administrateurs actifs sont cadrés.',
      permissionsDisponibles: PERMISSIONS_ADMIN.length,
    };

    /**
     * L'état global ne peut pas être meilleur que sa pire ligne critique.
     *
     * Une dépendance requise absente rend l'ensemble indisponible ; une
     * anomalie d'intégrité critique aussi. Le reste dégrade sans abattre.
     */
    const critiqueDown = infrastructure.some((l) => l.name === 'PostgreSQL' && l.status !== 'OK');
    const status = critiqueDown || integrite.status === 'CRITICAL' ? 'CRITICAL' : integrite.status === 'WARNING' || !sondes.ready ? 'WARNING' : 'HEALTHY';

    return {
      status,
      checkedAt: new Date().toISOString(),
      environment: env.nodeEnv,
      infrastructure,
      providers: prestataires,
      notInstrumented: nonInstrumente,
      integrity: {
        status: integrite.status,
        checked: integrite.checked,
        issues: integrite.issues.map((i) => ({ code: i.code, label: i.label, severity: i.severity, count: i.count })),
        failures: integrite.failures,
      },
      security: securite,
      privacy: { pendingDeletions: demandesSuppression },
      /**
       * Incidents ouverts. Tenus à la main : ce compteur ne dit pas ce qui va
       * mal, il dit ce que quelqu'un a écrit. Le confondre avec une détection
       * ferait lire « zéro incident » comme « tout va bien ».
       */
      incidents: { ...incidents, note: 'Ouverts à la main : aucune alerte n’existe. Zéro incident ne veut pas dire zéro problème.' },
      note:
        'Chaque ligne vient d’une sonde exécutée à l’instant ou d’un état lu en base. ' +
        'Ce qui n’est pas mesuré est marqué NON_INSTRUMENTE plutôt que rendu en vert.',
    };
  },
};
