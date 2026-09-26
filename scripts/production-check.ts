/**
 * CONTRÔLE DE PRODUCTION (V25 §78).
 *
 * Répond à une seule question : **cette instance peut-elle démarrer et
 * servir ?** Elle n'énumère pas ce qui existe dans le code ; elle interroge ce
 * qui répond.
 *
 * Aucune valeur de secret n'est affichée, ni en clair ni tronquée. La présence
 * d'une variable se dit par « défini » ou « absent », jamais par un extrait :
 * un fragment de secret dans une sortie de console est un secret dans une
 * sortie de console, et ces sorties se collent dans des tickets.
 *
 *     npm run check:production
 *
 * Code de sortie : 0 si rien ne bloque, 1 sinon. C'est ce qui permet de
 * l'enchaîner dans un déploiement.
 */
import { prisma } from '../src/db/prisma.js';
import { env } from '../src/config/env.js';
import { configurationFaible } from '../src/config/production-guard.js';
import { readiness } from '../src/touma/health.js';
import { integrityService } from '../src/touma/admin/integrity.service.js';
import { operationsService } from '../src/touma/admin/operations.service.js';

type Gravite = 'BLOQUANT' | 'AVERTISSEMENT' | 'INFORMATION';

interface Constat {
  gravite: Gravite;
  sujet: string;
  detail: string;
}

const constats: Constat[] = [];
const note = (gravite: Gravite, sujet: string, detail: string) => constats.push({ gravite, sujet, detail });

/** Variables attendues en production. Seule leur **présence** est rapportée. */
const VARIABLES_ATTENDUES = [
  'DATABASE_URL',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'TOUMA_PAYMENT_WEBHOOK_SECRET',
];

async function main(): Promise<void> {
  const production = env.nodeEnv === 'production';
  note('INFORMATION', 'Environnement', env.nodeEnv);

  // ── Configuration ─────────────────────────────────────────────────────────
  for (const nom of VARIABLES_ATTENDUES) {
    const defini = Boolean(process.env[nom]);
    if (defini) note('INFORMATION', nom, 'défini');
    else if (nom === 'TOUMA_PAYMENT_WEBHOOK_SECRET') {
      note('AVERTISSEMENT', nom, 'absent : la clé des jetons sert aussi à vérifier les webhooks. Une clé distincte est préférable.');
    } else {
      note(production ? 'BLOQUANT' : 'AVERTISSEMENT', nom, 'absent');
    }
  }

  const faibles = configurationFaible({
    defini: (nom) => Boolean(process.env[nom]),
    valeur: (nom) => process.env[nom] ?? '',
    databaseUrl: env.databaseUrl,
  });
  for (const f of faibles) note(production ? 'BLOQUANT' : 'AVERTISSEMENT', 'Configuration', f);

  // ── Dépendances ───────────────────────────────────────────────────────────
  const sondes = await readiness();
  for (const d of sondes.dependencies) {
    if (d.status === 'ok') note('INFORMATION', d.name, `joignable${d.latencyMs != null ? ` (${d.latencyMs} ms)` : ''}`);
    else if (d.required) note('BLOQUANT', d.name, d.detail ?? 'injoignable');
    else note('INFORMATION', d.name, d.detail ?? d.status);
  }

  // ── Intégrité ─────────────────────────────────────────────────────────────
  const integrite = await integrityService.run();
  note('INFORMATION', 'Intégrité', `${integrite.checked} invariants contrôlés`);
  for (const echec of integrite.failures) note('BLOQUANT', 'Intégrité', `contrôle ${echec.code} en échec : ${echec.error}`);
  for (const souci of integrite.issues) {
    note(souci.severity === 'CRITIQUE' ? 'BLOQUANT' : 'AVERTISSEMENT', `Intégrité · ${souci.code}`, `${souci.count} ligne(s) — ${souci.label}`);
  }

  // ── Prestataires et exploitation ──────────────────────────────────────────
  const vue = await operationsService.overview();
  for (const p of vue.providers) {
    note(p.status === 'OK' ? 'INFORMATION' : 'AVERTISSEMENT', `Prestataire · ${p.name}`, p.detail);
  }
  for (const l of vue.notInstrumented) {
    /**
     * L'absence de sauvegarde est **bloquante**, pas informative.
     *
     * C'est le seul point de cette liste dont la conséquence est
     * irréversible : tout le reste se rattrape, une base perdue non.
     */
    const bloquant = l.name === 'Sauvegardes';
    note(bloquant ? 'BLOQUANT' : 'AVERTISSEMENT', l.name, l.detail);
  }
  if (vue.security.adminsNonCadres > 0) {
    note('AVERTISSEMENT', 'Permissions', vue.security.detail);
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  const ordre: Gravite[] = ['BLOQUANT', 'AVERTISSEMENT', 'INFORMATION'];
  const symbole: Record<Gravite, string> = { BLOQUANT: '✗', AVERTISSEMENT: '!', INFORMATION: '·' };

  console.log('\n═══ Contrôle de production TOUMA ═══\n');
  for (const gravite of ordre) {
    const lot = constats.filter((c) => c.gravite === gravite);
    if (lot.length === 0) continue;
    console.log(`${gravite} (${lot.length})`);
    for (const c of lot) console.log(`  ${symbole[gravite]} ${c.sujet} — ${c.detail}`);
    console.log();
  }

  const bloquants = constats.filter((c) => c.gravite === 'BLOQUANT');
  if (bloquants.length > 0) {
    console.log(`✗ ${bloquants.length} point(s) bloquant(s). Cette instance ne doit pas servir de production en l’état.\n`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log('✓ Aucun point bloquant.\n');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('✗ Le contrôle lui-même a échoué :', err instanceof Error ? err.message : String(err));
  console.error('  Un contrôle qui ne peut pas s’exécuter ne vaut pas un contrôle réussi.');
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
