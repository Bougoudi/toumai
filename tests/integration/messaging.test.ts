import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Messagerie : l'accès repose sur la participation au fil, jamais sur la
 * connaissance d'un identifiant.
 */
const api = new TestApi();

let buyer: any;
let seller: any;
let intruder: any;
let storeId: string;
let conversationId: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur Msg', email: uniqueEmail('msg-v'), role: 'SELLER', countryCode: 'CM' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique Msg ${Date.now()}`, countryCode: 'CM' }, seller.accessToken)).body.id;
  buyer = await registerUser(api, { name: 'Acheteur Msg', email: uniqueEmail('msg-a'), role: 'BUYER', countryCode: 'TD' });
  intruder = await registerUser(api, { name: 'Tiers Msg', email: uniqueEmail('msg-t'), role: 'BUYER', countryCode: 'TD' });
});
after(async () => api.stop());

describe('Conversations acheteur ↔ vendeur', () => {
  it('ouvre une conversation avec une boutique', async () => {
    const res = await api.post('/api/v1/conversations', { storeId, subject: 'Disponibilité et délai' }, buyer.accessToken);
    assert.equal(res.status, 201);
    conversationId = res.body.id;
  });

  it('ne recrée pas un fil déjà ouvert', async () => {
    const again = await api.post('/api/v1/conversations', { storeId }, buyer.accessToken);
    assert.equal(again.status, 200);
    assert.equal(again.body.id, conversationId);
  });

  it('empêche un vendeur de s’écrire à lui-même', async () => {
    const res = await api.post('/api/v1/conversations', { storeId }, seller.accessToken);
    assert.equal(res.status, 400);
  });

  it('transmet le message et signale le non-lu au destinataire', async () => {
    const sent = await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Bonjour, quel est le délai pour 200 kg ?' }, buyer.accessToken);
    assert.equal(sent.status, 201);

    const sellerInbox = await api.get('/api/v1/conversations', seller.accessToken);
    const thread = sellerInbox.body.items.find((c: any) => c.id === conversationId);
    assert.ok(thread, 'le vendeur voit le fil');
    assert.equal(thread.unread, true);

    const unread = await api.get('/api/v1/conversations/unread-count', seller.accessToken);
    assert.equal(unread.body.count, 1);
  });

  it('marque le fil comme lu à l’ouverture', async () => {
    const read = await api.get(`/api/v1/conversations/${conversationId}`, seller.accessToken);
    assert.equal(read.status, 200);
    assert.equal(read.body.messages.length, 1);
    const unread = await api.get('/api/v1/conversations/unread-count', seller.accessToken);
    assert.equal(unread.body.count, 0);
  });

  it('refuse l’accès à un tiers, sans révéler l’existence du fil', async () => {
    const read = await api.get(`/api/v1/conversations/${conversationId}`, intruder.accessToken);
    assert.equal(read.status, 404);
    const write = await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Coucou' }, intruder.accessToken);
    assert.equal(write.status, 404);
  });

  it('refuse les pièces jointes déclarées par le client (contrat V13 retiré)', async () => {
    // Une URL, un type et une taille annoncés par le navigateur ne sont
    // vérifiables en rien : le format V13 est refusé explicitement, pas ignoré.
    const declared = await api.post(
      `/api/v1/conversations/${conversationId}/messages`,
      { body: 'Voici le fichier', attachments: [{ url: 'https://f.touma.test/x.exe', name: 'x.exe', mimeType: 'image/jpeg', sizeBytes: 10 }] },
      buyer.accessToken,
    );
    assert.equal(declared.status, 400);
    assert.match(JSON.stringify(declared.body), /corps brut/i);
  });

  it('accepte un fichier réel, reconnu par son contenu', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(512, 7),
    ]);
    const sent = await api.upload(`/api/v1/conversations/${conversationId}/attachments`, png, 'lot.png', seller.accessToken, 'Photo du lot');
    assert.equal(sent.status, 201);
    assert.equal(sent.body.attachments.length, 1);
    assert.equal(sent.body.attachments[0].mimeType, 'image/png');
    // Le fichier n'est jamais exposé par son chemin de stockage.
    assert.match(sent.body.attachments[0].url, /^\/api\/v1\/attachments\/[\w-]+\?expires=\d+&signature=[a-f0-9]{64}$/);
  });

  it('refuse un exécutable déguisé en image', async () => {
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(256, 0)]);
    const rejected = await api.upload(`/api/v1/conversations/${conversationId}/attachments`, exe, 'photo.png', buyer.accessToken);
    assert.equal(rejected.status, 400);
  });

  it('refuse un contenu dont le format n’est pas reconnu', async () => {
    const noise = Buffer.from('ceci n’est ni une image ni un PDF', 'utf8');
    const rejected = await api.upload(`/api/v1/conversations/${conversationId}/attachments`, noise, 'facture.pdf', buyer.accessToken);
    assert.equal(rejected.status, 400);
  });

  it('refuse un message vide ou démesuré', async () => {
    assert.equal((await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: '' }, buyer.accessToken)).status, 400);
    assert.equal((await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'x'.repeat(5000) }, buyer.accessToken)).status, 400);
  });
});
