import type { IncidentEventKind, IncidentSeverity, IncidentStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

/**
 * GESTION D'INCIDENTS (V25 §48).
 *
 * Un incident est **tenu à la main**, et rien ne l'ouvre automatiquement. Ce
 * n'est pas un manque : aucune alerte n'existe sur cette installation, et un
 * incident ouvert par une machine que personne ne lit ne sert à rien. Le jour
 * où il y aura des alertes, l'ouverture automatique aura un sens ; l'écrire
 * avant donnerait l'illusion d'une détection qui n'existe pas.
 *
 * Ce que ce module sert vraiment : qu'une personne d'astreinte écrive ce
 * qu'elle constate **pendant** qu'elle le constate. C'est l'exercice que
 * personne ne refait après coup, et c'est pourtant le seul moment où l'on sait
 * ce qu'on ne savait pas encore.
 *
 * D'où la règle qui gouverne le reste : **la chronologie ne se réécrit pas.**
 * Aucune ligne n'est modifiable ni supprimable. Un compte rendu rédigé une
 * fois qu'on connaît la fin de l'histoire est toujours plus net que la
 * réalité, et c'est précisément ce qui le rend inutile.
 */

/** Transitions permises. Un incident ne saute pas d'étape sans le dire. */
const SUITES: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ['INVESTIGATING', 'MITIGATED', 'RESOLVED'],
  INVESTIGATING: ['MITIGATED', 'RESOLVED'],
  // Atténué puis rouvert : c'est fréquent, et le nier ferait mentir la frise.
  MITIGATED: ['INVESTIGATING', 'RESOLVED'],
  RESOLVED: ['INVESTIGATING', 'CLOSED'],
  CLOSED: [],
};

export interface EntreeIncident {
  title: string;
  severity: IncidentSeverity;
  impact?: string | null;
  component?: string | null;
  ownerId?: string | null;
}

/** Référence lisible : `INC-2026-0001`. */
async function referenceSuivante(): Promise<string> {
  const annee = new Date().getUTCFullYear();
  const prefixe = `INC-${annee}-`;
  const dernier = await prisma.toumaIncident.findFirst({
    where: { reference: { startsWith: prefixe } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  const rang = dernier ? Number(dernier.reference.slice(prefixe.length)) + 1 : 1;
  return `${prefixe}${String(rang).padStart(4, '0')}`;
}

export const incidentService = {
  async open(input: EntreeIncident, actorId: string) {
    if (input.ownerId) {
      const proprietaire = await prisma.user.findUnique({ where: { id: input.ownerId }, select: { id: true } });
      if (!proprietaire) throw badRequest('Responsable inconnu.');
    }

    return prisma.$transaction(async (tx) => {
      const incident = await tx.toumaIncident.create({
        data: {
          reference: await referenceSuivante(),
          title: input.title,
          severity: input.severity,
          impact: input.impact ?? null,
          component: input.component ?? null,
          ownerId: input.ownerId ?? actorId,
          openedById: actorId,
        },
      });
      await tx.toumaIncidentEvent.create({
        data: { incidentId: incident.id, kind: 'STATUS', note: 'Incident ouvert.', toStatus: 'OPEN', actorId },
      });
      return incident;
    });
  },

  /**
   * Ajoute une ligne à la chronologie.
   *
   * Refusée sur un incident clos : rouvrir est une décision, pas un effet de
   * bord d'une note écrite trois semaines plus tard.
   */
  async addEvent(incidentId: string, input: { kind: IncidentEventKind; note: string }, actorId: string) {
    const incident = await prisma.toumaIncident.findUnique({ where: { id: incidentId }, select: { id: true, status: true } });
    if (!incident) throw notFound('Incident introuvable.');
    if (incident.status === 'CLOSED') throw conflict('Incident clos : sa chronologie ne peut plus être complétée.');

    return prisma.toumaIncidentEvent.create({
      data: { incidentId, kind: input.kind, note: input.note, actorId },
    });
  },

  /**
   * Change l'état, et consigne le changement dans la même transaction.
   *
   * Un état qui bouge sans laisser de ligne rend la frise fausse : on verrait
   * un incident résolu sans savoir quand ni par qui.
   */
  async transition(
    incidentId: string,
    input: { status: IncidentStatus; note: string; rootCause?: string | null; resolution?: string | null },
    actorId: string,
  ) {
    const incident = await prisma.toumaIncident.findUnique({ where: { id: incidentId } });
    if (!incident) throw notFound('Incident introuvable.');

    if (!SUITES[incident.status].includes(input.status)) {
      throw conflict(`Transition ${incident.status} → ${input.status} impossible.`);
    }

    /**
     * Clore demande une cause **et** une résolution.
     *
     * Un incident clos sans cause établie est un incident qu'on reverra, et
     * le seul moment où l'on peut encore l'écrire est maintenant.
     */
    const causeFinale = input.rootCause ?? incident.rootCause;
    const resolutionFinale = input.resolution ?? incident.resolution;
    if (input.status === 'CLOSED') {
      if (!causeFinale) throw badRequest('Clore demande une cause établie. « Probablement » n’en est pas une : laissez l’incident ouvert.');
      if (!resolutionFinale) throw badRequest('Clore demande de dire ce qui a rétabli le service.');
    }

    const maintenant = new Date();
    return prisma.$transaction(async (tx) => {
      const maj = await tx.toumaIncident.update({
        where: { id: incidentId },
        data: {
          status: input.status,
          rootCause: causeFinale,
          resolution: resolutionFinale,
          // Les horodatages ne sont posés qu'une fois : un incident atténué
          // deux fois garde la date de la première atténuation, qui est celle
          // où les gens ont cessé d'être gênés.
          mitigatedAt: input.status === 'MITIGATED' ? (incident.mitigatedAt ?? maintenant) : incident.mitigatedAt,
          resolvedAt: input.status === 'RESOLVED' ? (incident.resolvedAt ?? maintenant) : incident.resolvedAt,
          closedAt: input.status === 'CLOSED' ? maintenant : incident.closedAt,
        },
      });
      await tx.toumaIncidentEvent.create({
        data: { incidentId, kind: 'STATUS', note: input.note, fromStatus: incident.status, toStatus: input.status, actorId },
      });
      return maj;
    });
  },

  async list(filtre: { status?: IncidentStatus; severity?: IncidentSeverity } = {}) {
    const items = await prisma.toumaIncident.findMany({
      where: { ...(filtre.status ? { status: filtre.status } : {}), ...(filtre.severity ? { severity: filtre.severity } : {}) },
      orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }],
      take: 100,
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { events: true } },
      },
    });
    return {
      items,
      /** Ce que cette liste n'est pas. */
      note: 'Les incidents sont ouverts à la main : aucune alerte n’existe sur cette installation, et cette liste ne reflète donc que ce que quelqu’un a écrit.',
    };
  },

  async get(id: string) {
    const incident = await prisma.toumaIncident.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true } },
        openedBy: { select: { id: true, name: true } },
        events: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { id: true, name: true } } },
        },
      },
    });
    if (!incident) throw notFound('Incident introuvable.');
    return incident;
  },

  /** Incidents ouverts, pour le centre d'opérations. */
  async ouverts() {
    const parGravite = await prisma.toumaIncident.groupBy({
      by: ['severity'],
      where: { status: { notIn: ['RESOLVED', 'CLOSED'] } },
      _count: { _all: true },
    });
    return {
      total: parGravite.reduce((n, g) => n + g._count._all, 0),
      bySeverity: Object.fromEntries(parGravite.map((g) => [g.severity, g._count._all])),
    };
  },
};
