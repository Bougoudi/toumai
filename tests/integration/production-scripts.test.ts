import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';

/**
 * SCRIPTS DE VÉRIFICATION (V25 §78-79).
 *
 * Ces scripts se lancent dans un terminal, et leur sortie se colle dans des
 * tickets et des fils de discussion. Un fragment de secret qui y apparaîtrait
 * serait un secret publié — §78 est explicite : « Il ne doit jamais afficher
 * les secrets. »
 *
 * Ils sont donc exécutés pour de vrai ici, et leur sortie fouillée.
 */
const executer = promisify(execFile);

/** Lance un script et rend sa sortie, quel que soit son code de retour. */
async function lancer(script: string): Promise<{ sortie: string; code: number }> {
  try {
    const { stdout, stderr } = await executer('npx', ['tsx', script], {
      cwd: process.cwd(),
      timeout: 120_000,
      env: { ...process.env, SECRET_SONDE_POUR_TEST: 'valeur-de-sonde-a-ne-jamais-afficher' },
    });
    return { sortie: stdout + stderr, code: 0 };
  } catch (err: any) {
    return { sortie: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.code ?? 1 };
  }
}

describe('Contrôle de production', () => {
  it('s’exécute et rend un verdict', async () => {
    const { sortie } = await lancer('scripts/production-check.ts');
    assert.match(sortie, /Contrôle de production TOUMA/);
    // Le verdict est explicite dans les deux sens : un script qui ne conclut
    // pas laisse chacun conclure ce qu'il veut.
    assert.ok(/point\(s\) bloquant\(s\)|Aucun point bloquant/.test(sortie), sortie.slice(0, 300));
  });

  it('n’affiche aucune valeur de secret', async () => {
    const { sortie } = await lancer('scripts/production-check.ts');

    const secrets = [process.env.JWT_SECRET, process.env.ENCRYPTION_KEY, process.env.DATABASE_URL].filter(
      (v): v is string => typeof v === 'string' && v.length >= 8,
    );
    assert.ok(secrets.length > 0, 'l’environnement de test porte bien des secrets à ne pas divulguer');

    for (const secret of secrets) {
      assert.ok(!sortie.includes(secret), 'une valeur de secret est apparue dans la sortie');
      // Ni en entier, ni tronquée : un extrait suffit souvent à retrouver le reste.
      assert.ok(!sortie.includes(secret.slice(0, 12)), 'un extrait de secret est apparu dans la sortie');
    }
    // La présence se dit par un mot, pas par une valeur.
    assert.match(sortie, /JWT_SECRET — défini|JWT_SECRET — absent/);
  });

  it('signale l’absence de sauvegarde comme bloquante', async () => {
    const { sortie, code } = await lancer('scripts/production-check.ts');
    // C'est le seul point dont la conséquence est irréversible : tout le reste
    // se rattrape, une base perdue non.
    assert.match(sortie, /Sauvegardes/);
    assert.match(sortie, /BLOQUANT/);
    assert.equal(code, 1, 'un point bloquant doit donner un code de sortie non nul');
  });
});

describe('Contrôle de mise en service', () => {
  it('nomme les domaines qui reposent sur une simulation', async () => {
    const { sortie, code } = await lancer('scripts/go-live-check.ts');
    assert.match(sortie, /état des domaines/);
    // Sur une instance sans prestataire réel, paiement et expédition doivent
    // ressortir : ouvrir au public dans cet état promettrait à des acheteurs
    // ce que personne ne peut tenir.
    assert.match(sortie, /SIMULATION/);
    assert.equal(code, 1);
  });

  it('dit explicitement ce qu’il ne prouve pas', async () => {
    const { sortie } = await lancer('scripts/go-live-check.ts');
    // Un contrôle qui laisserait croire qu'il valide les parcours ferait
    // exactement ce que V24 §72 interdit : conclure de l'existence du code.
    assert.match(sortie, /ne prouve pas que les parcours fonctionnent/);
    assert.match(sortie, /test:e2e/);
  });

  it('n’affiche aucune valeur de secret non plus', async () => {
    const { sortie } = await lancer('scripts/go-live-check.ts');
    for (const secret of [process.env.JWT_SECRET, process.env.DATABASE_URL].filter((v): v is string => typeof v === 'string' && v.length >= 8)) {
      assert.ok(!sortie.includes(secret.slice(0, 12)), 'un extrait de secret est apparu dans la sortie');
    }
  });
});
