import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import { deriveSigningKey, S3CompatibleStorage } from '../../src/touma/messaging/s3-storage.js';

const CONFIG = {
  endpoint: 'https://s3.example.net',
  bucket: 'touma-prod',
  accessKey: 'AKIAEXAMPLE',
  secretKey: 'secret-de-test',
  region: 'eu-west-3',
  keyPrefix: 'pieces-jointes/',
  forcePathStyle: true,
};

const realFetch = globalThis.fetch;

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** Remplace `fetch` et retient la requête envoyée, sans jamais sortir du process. */
function capture(response: Response): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({ url: String(input), method: init.method, headers: init.headers });
    return response;
  }) as typeof fetch;
  return calls;
}

function ok(body = ''): Response {
  return new Response(body, { status: 200 });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Signature AWS V4', () => {
  it('dérive la clé de signature comme le vecteur d’exemple publié par AWS', () => {
    // Vecteur officiel : secret d'exemple, 20120215, us-east-1, iam.
    const key = deriveSigningKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam');
    assert.equal(key.toString('hex'), 'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
  });

  it('signe l’empreinte du contenu réellement envoyé', async () => {
    const calls = capture(ok());
    const content = Buffer.from('%PDF-1.7 facture');
    await new S3CompatibleStorage(CONFIG).put('2026/09/abcdef.pdf', content);

    const [call] = calls;
    assert.equal(call.headers['x-amz-content-sha256'], createHash('sha256').update(content).digest('hex'));
    assert.match(call.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/eu-west-3\/s3\/aws4_request, /);
    assert.match(call.headers.authorization, /Signature=[0-9a-f]{64}$/);
  });

  it('signe les en-têtes dans l’ordre canonique, hôte et date compris', async () => {
    const calls = capture(ok());
    await new S3CompatibleStorage(CONFIG).put('2026/09/abcdef.pdf', Buffer.from('x'));

    const signed = /SignedHeaders=([^,]+),/.exec(calls[0].headers.authorization)?.[1];
    assert.equal(signed, 'content-type;host;x-amz-content-sha256;x-amz-date');
    assert.match(calls[0].headers['x-amz-date'], /^\d{8}T\d{6}Z$/);
  });

  it('produit une signature différente pour un contenu différent', async () => {
    const storage = new S3CompatibleStorage(CONFIG);
    const first = capture(ok());
    await storage.put('2026/09/abcdef.pdf', Buffer.from('un'));
    const second = capture(ok());
    await storage.put('2026/09/abcdef.pdf', Buffer.from('deux'));

    assert.notEqual(first[0].headers.authorization, second[0].headers.authorization);
  });
});

describe('Adressage de l’objet', () => {
  it('range l’objet sous le préfixe configuré, en adressage par chemin', async () => {
    const calls = capture(ok());
    await new S3CompatibleStorage(CONFIG).put('2026/09/abcdef.pdf', Buffer.from('x'));
    assert.equal(calls[0].url, 'https://s3.example.net/touma-prod/pieces-jointes/2026/09/abcdef.pdf');
  });

  it('bascule sur le sous-domaine quand le service l’exige', async () => {
    const calls = capture(ok());
    await new S3CompatibleStorage({ ...CONFIG, forcePathStyle: false }).put('2026/09/abcdef.pdf', Buffer.from('x'));
    assert.equal(calls[0].url, 'https://touma-prod.s3.example.net/pieces-jointes/2026/09/abcdef.pdf');
  });

  it('refuse une clé qui tenterait de sortir du préfixe', async () => {
    capture(ok());
    const storage = new S3CompatibleStorage(CONFIG);
    await assert.rejects(() => storage.get('../../etc/passwd.pdf'), /Clé de stockage invalide/);
    await assert.rejects(() => storage.get('/absolu.pdf'), /Clé de stockage invalide/);
    await assert.rejects(() => storage.get('sans-extension'), /Clé de stockage invalide/);
  });
});

describe('Erreurs du stockage', () => {
  it('traduit un objet absent en « introuvable »', async () => {
    capture(new Response('', { status: 404 }));
    await assert.rejects(
      () => new S3CompatibleStorage(CONFIG).get('2026/09/abcdef.pdf'),
      (err: any) => err.statusCode === 404,
    );
  });

  it('ne recopie jamais la réponse du stockage vers le client', async () => {
    capture(new Response('<Error><BucketName>touma-prod</BucketName></Error>', { status: 403 }));
    await assert.rejects(
      () => new S3CompatibleStorage(CONFIG).get('2026/09/abcdef.pdf'),
      (err: any) => err.statusCode === 502 && !/touma-prod|BucketName/.test(err.message),
    );
  });

  it('rend le contenu tel quel quand la lecture aboutit', async () => {
    capture(ok('contenu'));
    const buffer = await new S3CompatibleStorage(CONFIG).get('2026/09/abcdef.pdf');
    assert.equal(buffer.toString(), 'contenu');
  });
});
