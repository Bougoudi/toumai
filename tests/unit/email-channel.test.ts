import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deepLink, renderNotificationEmail } from '../../src/touma/lib/email-channel.js';
import type { NotificationInput } from '../../src/touma/lib/notifications.js';

/** Notification minimale, que chaque test ajuste. */
const SITE = 'https://touma.example';

function notification(patch: Partial<NotificationInput> = {}): NotificationInput {
  return { userId: 'u1', type: 'MESSAGE_RECEIVED', title: 'Nouveau message', body: 'Vous avez reçu un message.', ...patch };
}

describe('Lien profond d’une notification', () => {
  it('mène à la page de la catégorie', () => {
    assert.equal(deepLink('MESSAGE_RECEIVED', undefined, SITE), 'https://touma.example/touma/messages');
    assert.equal(deepLink('OFFER_RECEIVED', undefined, SITE), 'https://touma.example/touma/negociations');
    assert.equal(deepLink('ORDER_CREATED', undefined, SITE), 'https://touma.example/touma/commandes');
  });

  it('précise la destination quand un identifiant est fourni', () => {
    // Une barre finale en trop ne doit pas produire une URL à double barre.
    assert.equal(deepLink('MESSAGE_RECEIVED', { conversationId: 'conv_123' }, `${SITE}/`), 'https://touma.example/touma/messages/conv_123');
    assert.equal(deepLink('OFFER_RECEIVED', { quoteId: 'q-42' }, SITE), 'https://touma.example/touma/negociations/q-42');
  });

  it('refuse tout ce qui n’est pas un identifiant', () => {
    // Une valeur venue d'ailleurs ne doit jamais se retrouver dans l'URL.
    assert.equal(deepLink('MESSAGE_RECEIVED', { conversationId: '../../admin' }, SITE), 'https://touma.example/touma/messages');
    assert.equal(deepLink('MESSAGE_RECEIVED', { conversationId: 'https://pirate.example' }, SITE), 'https://touma.example/touma/messages');
    assert.equal(deepLink('MESSAGE_RECEIVED', { conversationId: 42 as unknown as string }, SITE), 'https://touma.example/touma/messages');
  });

  it('n’invente pas de lien quand l’adresse publique n’est pas configurée', () => {
    // Un bouton vers localhost ne mène nulle part depuis un téléphone : mieux
    // vaut un e-mail sans bouton.
    assert.equal(deepLink('MESSAGE_RECEIVED', undefined, ''), null);
    assert.equal(deepLink('MESSAGE_RECEIVED', undefined, 'http://localhost:3000'), null);
    assert.equal(deepLink('MESSAGE_RECEIVED', undefined, 'http://127.0.0.1:3000'), null);
  });
});

describe('Mise en forme de l’e-mail', () => {
  it('porte le titre de la notification dans l’objet', () => {
    const { subject } = renderNotificationEmail(notification({ title: 'Offre reçue' }));
    assert.equal(subject, 'TOUMA — Offre reçue');
  });

  it('échappe ce qui vient d’un humain', () => {
    const { html } = renderNotificationEmail(
      notification({ title: '<script>alert(1)</script>', body: 'Boutique « Cacao & Fils » <b>promo</b>' }),
    );
    assert.ok(!html.includes('<script>'), 'aucune balise active ne traverse');
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('Cacao &amp; Fils'));
    assert.ok(!html.includes('<b>promo</b>'));
  });

  it('affiche un bouton quand l’adresse publique est connue, et rien sinon', () => {
    const avec = renderNotificationEmail(notification({ data: { conversationId: 'conv_9' } }), SITE).html;
    assert.ok(avec.includes('https://touma.example/touma/messages/conv_9'));
    assert.ok(avec.includes('Ouvrir dans TOUMA'));

    const sans = renderNotificationEmail(notification(), 'http://localhost:3000').html;
    assert.ok(!sans.includes('Ouvrir dans TOUMA'), 'pas de bouton sans destination réelle');
  });

  it('rappelle toujours comment cesser de recevoir ces e-mails', () => {
    const { html } = renderNotificationEmail(notification());
    assert.match(html, /préférences/i);
  });

  it('ne transporte ni jeton, ni signature, ni pièce jointe', () => {
    const { html } = renderNotificationEmail(
      notification({ data: { conversationId: 'conv_9', signature: 'abc123', token: 'secret' } }),
      SITE,
    );
    assert.ok(!/abc123|secret|signature=|token=/.test(html), 'aucun secret ne part par e-mail');
    // Aucune image distante : les clients les bloquent, et elles pistent.
    assert.ok(!/<img/i.test(html));
  });
});
