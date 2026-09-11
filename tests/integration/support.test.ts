import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Assistance : un ticket appartient à celui qui l'ouvre, l'équipe voit la file
 * complète, et une note interne ne sort jamais côté demandeur.
 */
const api = new TestApi();

let buyer: any;
let other: any;
let admin: any;
let ticketId: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  buyer = await registerUser(api, { name: 'Acheteur aide', email: uniqueEmail('sup-buyer'), role: 'BUYER', countryCode: 'TD' });
  other = await registerUser(api, { name: 'Tiers aide', email: uniqueEmail('sup-other'), role: 'BUYER', countryCode: 'TD' });
  admin = await registerUser(api, { name: 'Équipe TOUMA', email: uniqueEmail('sup-admin'), role: 'BUYER', countryCode: 'TD' });
  await promoteToAdmin(admin.user.id);
  // Le rôle est porté par le jeton : on en obtient un nouveau après promotion.
  const relogin = await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password });
  admin.accessToken = relogin.body.accessToken;
});
after(async () => api.stop());

describe('Assistance', () => {
  it('ouvre un ticket avec sa priorité déduite du sujet', async () => {
    const res = await api.post(
      '/api/v1/support/tickets',
      { subject: 'Paiement débité deux fois', category: 'PAYMENT', message: 'J’ai été débité deux fois pour la même commande.' },
      buyer.accessToken,
    );
    assert.equal(res.status, 201);
    assert.ok(res.body.reference.startsWith('AS-'));
    assert.equal(res.body.status, 'OPEN');
    // Un problème de paiement passe devant : la priorité vient du serveur.
    assert.equal(res.body.priority, 'HIGH');
    assert.equal(res.body.messages.length, 1);
    ticketId = res.body.id;
  });

  it('cache le ticket aux autres utilisateurs', async () => {
    assert.equal((await api.get(`/api/v1/support/tickets/${ticketId}`, other.accessToken)).status, 404);
    const list = await api.get('/api/v1/support/tickets?scope=mine', other.accessToken);
    assert.equal(list.body.items.length, 0);
  });

  it('réserve la file complète à l’administration', async () => {
    assert.equal((await api.get('/api/v1/support/tickets?scope=all', buyer.accessToken)).status, 403);
    const queue = await api.get('/api/v1/support/tickets?scope=all', admin.accessToken);
    assert.equal(queue.status, 200);
    assert.ok(queue.body.items.some((t: any) => t.id === ticketId));
  });

  it('garde les notes internes hors de la vue du demandeur', async () => {
    const internal = await api.post(
      `/api/v1/support/tickets/${ticketId}/messages`,
      { body: 'Vérifier auprès du PSP avant de répondre.', internal: true },
      admin.accessToken,
    );
    assert.equal(internal.status, 201);

    const asBuyer = await api.get(`/api/v1/support/tickets/${ticketId}`, buyer.accessToken);
    assert.ok(!asBuyer.body.messages.some((m: any) => m.internal), 'aucune note interne côté acheteur');
    assert.equal(asBuyer.body.messages.length, 1);

    const asAdmin = await api.get(`/api/v1/support/tickets/${ticketId}`, admin.accessToken);
    assert.equal(asAdmin.body.messages.length, 2);
  });

  it('refuse une note interne à un utilisateur ordinaire', async () => {
    const res = await api.post(`/api/v1/support/tickets/${ticketId}/messages`, { body: 'Discret.', internal: true }, buyer.accessToken);
    assert.equal(res.status, 403);
  });

  it('fait avancer le statut au fil des réponses', async () => {
    const reply = await api.post(`/api/v1/support/tickets/${ticketId}/messages`, { body: 'Bonjour, nous vérifions.' }, admin.accessToken);
    assert.equal(reply.body.status, 'PENDING_USER', 'la balle est dans le camp du demandeur');

    const back = await api.post(`/api/v1/support/tickets/${ticketId}/messages`, { body: 'Merci, j’attends.' }, buyer.accessToken);
    assert.equal(back.body.status, 'IN_PROGRESS');
  });

  it('réserve le changement de statut et de priorité à l’administration', async () => {
    assert.equal((await api.patch(`/api/v1/support/tickets/${ticketId}`, { status: 'RESOLVED' }, buyer.accessToken)).status, 403);
    const updated = await api.patch(`/api/v1/support/tickets/${ticketId}`, { status: 'RESOLVED', priority: 'NORMAL' }, admin.accessToken);
    assert.equal(updated.body.status, 'RESOLVED');
    assert.equal(updated.body.priority, 'NORMAL');
  });

  it('laisse le demandeur clore, puis verrouille le fil', async () => {
    const closed = await api.post(`/api/v1/support/tickets/${ticketId}/close`, {}, buyer.accessToken);
    assert.equal(closed.body.status, 'CLOSED');
    const late = await api.post(`/api/v1/support/tickets/${ticketId}/messages`, { body: 'Encore une chose.' }, buyer.accessToken);
    assert.equal(late.status, 409);
  });

  it('refuse de rattacher la commande d’un autre', async () => {
    const res = await api.post(
      '/api/v1/support/tickets',
      { subject: 'Commande d’un autre', category: 'ORDER', message: 'Je voudrais des nouvelles de cette commande.', orderId: 'clzzzzzzzzzzzzzzzzzzzzzzz' },
      buyer.accessToken,
    );
    assert.equal(res.status, 400);
  });
});
