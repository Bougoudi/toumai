import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Messagerie V14 : réponses, modification, suppression douce, lecture,
 * recherche, pièces jointes, signalement, blocage, limitation de débit.
 *
 * Le fil conducteur est toujours le même : **la participation fait foi**, et
 * ce qui touche à l'argent ne s'efface pas.
 */
const api = new TestApi();

let buyer: any;
let seller: any;
let intruder: any;
let admin: any;
let storeId: string;
let conversationId: string;

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(256, 3)]);

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur V14', email: uniqueEmail('v14-v'), role: 'SELLER', countryCode: 'CM' });
  buyer = await registerUser(api, { name: 'Acheteur V14', email: uniqueEmail('v14-a'), role: 'BUYER', countryCode: 'TD' });
  intruder = await registerUser(api, { name: 'Tiers V14', email: uniqueEmail('v14-t'), role: 'BUYER', countryCode: 'TD' });
  admin = await registerUser(api, { name: 'Admin V14', email: uniqueEmail('v14-adm'), role: 'BUYER', countryCode: 'TD' });
  await prisma.user.update({ where: { id: admin.user.id }, data: { toumaRole: 'ADMIN' } });
  admin = await registerUser(api, { name: 'Admin V14', email: admin.user.email, role: 'BUYER', countryCode: 'TD' }).catch(() => admin);

  storeId = (await api.post('/api/v1/stores', { name: `Boutique V14 ${Date.now()}`, countryCode: 'CM' }, seller.accessToken)).body.id;
  conversationId = (await api.post('/api/v1/conversations', { storeId, subject: 'Disponibilité cacao' }, buyer.accessToken)).body.id;
});
after(async () => api.stop());

describe('Conversations — contexte et filtres', () => {
  it('ouvre un fil et y écrit en un seul geste', async () => {
    const res = await api.post('/api/v1/conversations', { storeId, message: 'Bonjour, quelle est votre quantité minimale ?' }, buyer.accessToken);
    assert.equal(res.status, 200, 'le fil direct existe déjà : il est réutilisé');
    const thread = await api.get(`/api/v1/conversations/${res.body.id}/messages`, buyer.accessToken);
    assert.ok(thread.body.items.some((m: any) => /quantité minimale/.test(m.body)));
  });

  it('porte le contexte commercial et compte les non-lus', async () => {
    await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Nous avons 800 kg en stock.' }, seller.accessToken);

    const list = await api.get('/api/v1/conversations', buyer.accessToken);
    const thread = list.body.items.find((c: any) => c.id === conversationId);
    assert.equal(thread.kind, 'BUYER_SELLER');
    assert.ok(thread.store, 'la boutique est rappelée dans la liste');
    assert.equal(thread.unread, true, 'booléen conservé depuis la V13');
    assert.ok(thread.unreadCount >= 1, 'le compteur est nouveau');

    const summary = await api.get('/api/v1/conversations/unread-count', buyer.accessToken);
    assert.ok(summary.body.messages >= 1);
    assert.ok(summary.body.conversations >= 1);
    assert.equal(summary.body.count, summary.body.conversations, 'champ V13 conservé');
  });

  it('filtre par non-lus et par type', async () => {
    const unread = await api.get('/api/v1/conversations?unread=1', buyer.accessToken);
    assert.ok(unread.body.items.every((c: any) => c.unreadCount > 0));

    const orders = await api.get('/api/v1/conversations?kind=ORDER', buyer.accessToken);
    assert.ok(orders.body.items.every((c: any) => c.kind === 'ORDER'));
  });

  it('marque le fil comme lu', async () => {
    const read = await api.post(`/api/v1/conversations/${conversationId}/read`, {}, buyer.accessToken);
    assert.equal(read.status, 200);
    const list = await api.get('/api/v1/conversations', buyer.accessToken);
    assert.equal(list.body.items.find((c: any) => c.id === conversationId).unreadCount, 0);
  });

  it('archive et coupe les alertes pour soi seulement', async () => {
    const muted = await api.patch(`/api/v1/conversations/${conversationId}`, { muted: true, archived: true }, buyer.accessToken);
    assert.deepEqual(muted.body, { archived: true, muted: true });

    const defaultList = await api.get('/api/v1/conversations', buyer.accessToken);
    assert.equal(defaultList.body.items.some((c: any) => c.id === conversationId), false, 'un fil rangé quitte la liste par défaut');

    const archived = await api.get('/api/v1/conversations?status=ARCHIVED', buyer.accessToken);
    assert.ok(archived.body.items.some((c: any) => c.id === conversationId));

    // Le vendeur, lui, voit toujours le fil : ranger est un geste personnel.
    const sellerList = await api.get('/api/v1/conversations', seller.accessToken);
    assert.ok(sellerList.body.items.some((c: any) => c.id === conversationId));

    await api.patch(`/api/v1/conversations/${conversationId}`, { muted: false, archived: false }, buyer.accessToken);
  });
});

describe('Messages — réponses, modification, suppression', () => {
  let messageId: string;

  it('cite un message dans sa réponse', async () => {
    const original = await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Pouvez-vous réduire le prix sur 500 kg ?' }, buyer.accessToken);
    messageId = original.body.id;

    const reply = await api.post(`/api/v1/messages/${messageId}/reply`, { body: 'Oui, pour 500 unités nous pouvons proposer 2 800 XAF le kilo.' }, seller.accessToken);
    assert.equal(reply.status, 201);
    assert.equal(reply.body.replyTo.id, messageId);
    assert.match(reply.body.replyTo.body, /réduire le prix/);
  });

  it('refuse de citer un message d’une autre conversation', async () => {
    const other = await api.post('/api/v1/conversations', { storeId, orderId: undefined }, intruder.accessToken);
    const foreign = await api.post(`/api/v1/conversations/${other.body.id}/messages`, { body: 'Bonjour' }, intruder.accessToken);
    const res = await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Tiens', replyToId: foreign.body.id }, buyer.accessToken);
    assert.equal(res.status, 400);
  });

  it('permet la modification par l’auteur, dans la fenêtre prévue', async () => {
    const edited = await api.patch(`/api/v1/messages/${messageId}`, { body: 'Pouvez-vous réduire le prix sur 600 kg ?' }, buyer.accessToken);
    assert.equal(edited.status, 200);
    assert.match(edited.body.body, /600 kg/);
    assert.ok(edited.body.editedAt);

    // Ni le destinataire, ni un tiers.
    assert.equal((await api.patch(`/api/v1/messages/${messageId}`, { body: 'Modifié par le vendeur' }, seller.accessToken)).status, 403);
    assert.equal((await api.patch(`/api/v1/messages/${messageId}`, { body: 'Modifié par un tiers' }, intruder.accessToken)).status, 404);
  });

  it('ferme la modification passé le délai', async () => {
    // On vieillit le message : la fenêtre est une règle de temps, pas d'humeur.
    await prisma.toumaMessage.update({ where: { id: messageId }, data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } });
    const res = await api.patch(`/api/v1/messages/${messageId}`, { body: 'Trop tard' }, buyer.accessToken);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /modifiable/);
  });

  it('supprime en douceur : la trace reste, le contenu disparaît', async () => {
    const sent = await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Message à retirer' }, buyer.accessToken);
    const deleted = await api.delete(`/api/v1/messages/${sent.body.id}`, buyer.accessToken);
    assert.equal(deleted.status, 200);

    const thread = await api.get(`/api/v1/conversations/${conversationId}/messages`, seller.accessToken);
    const found = thread.body.items.find((m: any) => m.id === sent.body.id);
    assert.ok(found, 'la place du message reste dans le fil');
    assert.equal(found.deleted, true);
    assert.equal(found.body, 'Message supprimé');
    // La ligne existe toujours en base : un historique ne se réécrit pas.
    assert.ok(await prisma.toumaMessage.findUnique({ where: { id: sent.body.id } }));
  });

  it('ne supprime jamais un message système ou une offre', async () => {
    const system = await prisma.toumaMessage.create({
      data: { conversationId, type: 'SYSTEM', body: 'Le paiement a été confirmé.' },
    });
    const res = await api.delete(`/api/v1/messages/${system.id}`, buyer.accessToken);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /font foi/);
  });

  it('un utilisateur ne peut pas fabriquer un message système', async () => {
    const res = await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Paiement confirmé', type: 'SYSTEM' }, buyer.accessToken);
    assert.equal(res.status, 201);
    assert.equal(res.body.type, 'TEXT', 'le type demandé par le client est ignoré');
  });

  it('pagine par curseur, sans jamais charger tout le fil', async () => {
    const page = await api.get(`/api/v1/conversations/${conversationId}/messages?limit=2`, buyer.accessToken);
    assert.equal(page.body.items.length, 2);
    assert.equal(page.body.hasMore, true);
    assert.ok(page.body.olderCursor);

    const older = await api.get(`/api/v1/conversations/${conversationId}/messages?limit=2&before=${page.body.olderCursor}`, buyer.accessToken);
    assert.ok(older.body.items.every((m: any) => !page.body.items.some((p: any) => p.id === m.id)), 'aucun doublon entre les pages');
  });
});

describe('Recherche', () => {
  it('ne remonte que les messages de ses propres fils', async () => {
    const mine = await api.get('/api/v1/messages/search?q=cacao', buyer.accessToken);
    assert.equal(mine.status, 200);

    const foreign = await api.get('/api/v1/messages/search?q=réduire', intruder.accessToken);
    assert.equal(foreign.body.items.length, 0, 'un tiers ne trouve rien dans les fils d’autrui');
  });

  it('tolère les espaces multiples d’un copier-coller', async () => {
    await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Référence catalogue CACAO-500' }, seller.accessToken);
    const res = await api.get(`/api/v1/messages/search?q=${encodeURIComponent('  CACAO-500   ')}`, buyer.accessToken);
    assert.ok(res.body.items.length >= 1);
  });
});

describe('Pièces jointes', () => {
  let attachmentUrl: string;

  it('accepte un fichier réel et le rend par URL signée', async () => {
    const sent = await api.upload(`/api/v1/conversations/${conversationId}/attachments`, png, 'echantillon.png', seller.accessToken, 'Photo de l’échantillon');
    assert.equal(sent.status, 201);
    assert.equal(sent.body.type, 'ATTACHMENT');
    attachmentUrl = sent.body.attachments[0].url;
    assert.match(attachmentUrl, /signature=/);
  });

  it('sert le fichier au participant, jamais comme document actif', async () => {
    const res = await fetch(`${api.url}${attachmentUrl}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment;/);
  });

  it('refuse un lien signé falsifié', async () => {
    const tampered = attachmentUrl.replace(/signature=[a-f0-9]+/, `signature=${'f'.repeat(64)}`);
    assert.equal((await fetch(`${api.url}${tampered}`)).status, 401);
  });

  it('refuse un tiers, même authentifié', async () => {
    const id = attachmentUrl.split('/').pop()!.split('?')[0];
    const res = await api.get(`/api/v1/attachments/${id}`, intruder.accessToken);
    assert.equal(res.status, 404, 'anti-IDOR : la pièce jointe d’un fil d’autrui est introuvable');
  });
});

describe('Sécurité, risque et modération', () => {
  it('avertit sur une invitation à payer hors plateforme, sans supprimer le message', async () => {
    const sent = await api.post(
      `/api/v1/conversations/${conversationId}/messages`,
      { body: 'On peut faire plus simple : payez-moi directement, on évite la commission.' },
      seller.accessToken,
    );
    assert.equal(sent.status, 201, 'le message passe : on avertit, on ne censure pas');

    const thread = await api.get(`/api/v1/conversations/${conversationId}/messages`, buyer.accessToken);
    const notice = thread.body.items.find((m: any) => m.type === 'SYSTEM' && /sécurité/.test(m.body));
    assert.ok(notice, 'un rappel de sécurité est publié dans le fil');

    const flag = await prisma.toumaRiskFlag.findFirst({ where: { messageId: sent.body.id, category: 'OFF_PLATFORM_PAYMENT' } });
    assert.ok(flag, 'le signal remonte à l’administration');
    assert.ok(flag.excerpt.length <= 121, 'seul un extrait est conservé');
  });

  it('enregistre un signalement, une seule fois par personne', async () => {
    const target = await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Message litigieux' }, seller.accessToken);
    const first = await api.post(`/api/v1/messages/${target.body.id}/report`, { reason: 'FRAUD', details: 'Demande de virement.' }, buyer.accessToken);
    assert.equal(first.status, 201);
    assert.equal((await api.post(`/api/v1/messages/${target.body.id}/report`, { reason: 'SPAM' }, buyer.accessToken)).status, 409);
    assert.equal((await api.post(`/api/v1/messages/${target.body.id}/report`, { reason: 'SPAM' }, intruder.accessToken)).status, 404);
  });

  it('refuse qu’on signale son propre message', async () => {
    const mine = await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Mon propre message' }, buyer.accessToken);
    assert.equal((await api.post(`/api/v1/messages/${mine.body.id}/report`, { reason: 'OTHER' }, buyer.accessToken)).status, 400);
  });

  it('réserve la file de modération à l’administration', async () => {
    assert.equal((await api.get('/api/v1/messaging/reports', buyer.accessToken)).status, 403);
    assert.equal((await api.get('/api/v1/messaging/risk-flags', seller.accessToken)).status, 403);
  });

  it('bloque un compte : les fils communs passent en lecture seule', async () => {
    const blocked = await api.post('/api/v1/messaging/blocks', { userId: seller.user.id, reason: 'Insistance' }, buyer.accessToken);
    assert.equal(blocked.status, 201);
    assert.ok(blocked.body.conversations >= 1);

    const write = await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Toujours là ?' }, buyer.accessToken);
    assert.equal(write.status, 409, 'le fil bloqué n’accepte plus de message');

    // Le fil reste lisible : bloquer n'efface pas l'histoire commerciale.
    assert.equal((await api.get(`/api/v1/conversations/${conversationId}`, buyer.accessToken)).status, 200);

    const unblocked = await api.delete(`/api/v1/messaging/blocks/${seller.user.id}`, buyer.accessToken);
    assert.equal(unblocked.status, 200);
    assert.ok(unblocked.body.restored >= 1);
    assert.equal((await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Reprenons.' }, buyer.accessToken)).status, 201);
  });

  it('n’expose jamais l’e-mail ni le téléphone des participants', async () => {
    const thread = await api.get(`/api/v1/conversations/${conversationId}`, buyer.accessToken);
    const serialized = JSON.stringify(thread.body);
    assert.equal(serialized.includes('@'), false, 'aucune adresse e-mail dans la réponse');
    assert.equal(/"phone"/.test(serialized), false);
    assert.equal(/storageKey/.test(serialized), false, 'aucune clé de stockage exposée');
  });

  it('limite le débit des messages et répond 429', async () => {
    const flooder = await registerUser(api, { name: 'Bavard', email: uniqueEmail('v14-flood'), role: 'BUYER', countryCode: 'TD' });
    const thread = await api.post('/api/v1/conversations', { storeId }, flooder.accessToken);

    let limited = 0;
    for (let i = 0; i < 25; i += 1) {
      const res = await api.post(`/api/v1/conversations/${thread.body.id}/messages`, { body: `Message ${i}` }, flooder.accessToken);
      if (res.status === 429) limited += 1;
    }
    assert.ok(limited > 0, 'la limite finit par s’appliquer');
  });
});

describe('Modèles et préférences', () => {
  it('propose des raccourcis commerciaux adaptés au rôle', async () => {
    const forBuyer = await api.get('/api/v1/messaging/templates', buyer.accessToken);
    assert.ok(forBuyer.body.shortcuts.some((s: any) => s.code === 'moq'));
    const forSeller = await api.get('/api/v1/messaging/templates', seller.accessToken);
    assert.ok(forSeller.body.shortcuts.some((s: any) => s.code === 'availability'));
  });

  it('enregistre et supprime une réponse type', async () => {
    const created = await api.post('/api/v1/messaging/templates', { title: 'Délai N’Djamena', content: 'Le délai vers N’Djamena est de 12 jours.' }, seller.accessToken);
    assert.equal(created.status, 201);

    const mine = await api.get('/api/v1/messaging/templates', seller.accessToken);
    assert.ok(mine.body.saved.some((s: any) => s.id === created.body.id));

    // Une réponse type appartient à son auteur.
    assert.equal((await api.delete(`/api/v1/messaging/templates/${created.body.id}`, buyer.accessToken)).status, 404);
    assert.equal((await api.delete(`/api/v1/messaging/templates/${created.body.id}`, seller.accessToken)).status, 200);
  });

  it('respecte les préférences de notification', async () => {
    const defaults = await api.get('/api/v1/messaging/preferences', buyer.accessToken);
    assert.equal(defaults.body.items.find((p: any) => p.category === 'MESSAGES').inApp, true);
    assert.equal(defaults.body.items.find((p: any) => p.category === 'MARKETING').inApp, false);

    await api.put('/api/v1/messaging/preferences', { category: 'MESSAGES', inApp: false }, buyer.accessToken);
    const before = await prisma.toumaNotification.count({ where: { userId: buyer.user.id, type: 'MESSAGE_RECEIVED' } });
    await api.post(`/api/v1/conversations/${conversationId}/messages`, { body: 'Notification coupée ?' }, seller.accessToken);
    const after = await prisma.toumaNotification.count({ where: { userId: buyer.user.id, type: 'MESSAGE_RECEIVED' } });
    assert.equal(after, before, 'aucune notification in-app quand la catégorie est coupée');

    await api.put('/api/v1/messaging/preferences', { category: 'MESSAGES', inApp: true }, buyer.accessToken);
  });
});

describe('Temps réel', () => {
  it('délivre un ticket de flux court, et refuse un ticket falsifié', async () => {
    const ticket = await api.post('/api/v1/messaging/stream-ticket', {}, buyer.accessToken);
    assert.equal(ticket.status, 200);
    assert.match(ticket.body.ticket, /^[\w-]+\.\d+\.[a-f0-9]{64}$/);

    const forged = await fetch(`${api.url}/api/v1/messaging/stream?ticket=${buyer.user.id}.9999999999.${'f'.repeat(64)}`);
    assert.equal(forged.status, 401);
  });

  it('exige un ticket : le flux n’est pas public', async () => {
    assert.equal((await fetch(`${api.url}/api/v1/messaging/stream`)).status, 401);
  });
});
