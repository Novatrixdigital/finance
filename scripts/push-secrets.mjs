/**
 * Pushes the server secrets from .env up to Supabase Edge Functions, so the
 * Resend key ends up where it can actually be used without ever entering the
 * browser bundle.
 *
 *   npm run secrets:push            # push
 *   npm run secrets:push -- --dry   # show what would be pushed
 *
 * Requires the Supabase CLI:  https://supabase.com/docs/guides/cli
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry');

/* Only these are ever uploaded — an explicit allowlist, so a stray variable
   in .env can never be shipped somewhere it does not belong. */
const SECRET_KEYS = ['RESEND_API_KEY', 'RESEND_FROM', 'APP_URL', 'REMINDER_SECRET'];

const REQUIRED = ['RESEND_API_KEY'];

function readEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) {
    console.error('✖ No .env found. Copy .env.example to .env first.');
    process.exit(1);
  }
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip matching quotes, keeping inner ones (the From header has < >).
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const mask = (v) => (v.length <= 8 ? '••••' : `${v.slice(0, 4)}…${v.slice(-3)}`);

const env = readEnv();

/* ── Sanity checks ───────────────────────────────────────────────────────── */

const missing = REQUIRED.filter((k) => !env[k]);
if (missing.length) {
  console.error(`\n✖ Missing in .env: ${missing.join(', ')}`);
  console.error('  Get a Resend key at https://resend.com/api-keys\n');
  process.exit(1);
}

if (env.RESEND_API_KEY && !/^re_[A-Za-z0-9_-]{10,}$/.test(env.RESEND_API_KEY)) {
  console.warn('⚠ RESEND_API_KEY does not look like a Resend key (expected re_…). Pushing anyway.');
}

if (Object.keys(env).some((k) => k.startsWith('VITE_') && /RESEND|SECRET/i.test(k))) {
  console.error('\n✖ A secret is sitting in the VITE_ namespace — it would be published.');
  console.error('  Run `node scripts/check-env.mjs` for details.\n');
  process.exit(1);
}

const ref = env.SUPABASE_PROJECT_REF;
const hasRef = ref && !ref.includes('your-project-ref');

const pushing = SECRET_KEYS.filter((k) => env[k]);
const skipped = SECRET_KEYS.filter((k) => !env[k]);

console.log('\nSecrets to upload to the send-reminders function:\n');
pushing.forEach((k) => console.log(`  ${k.padEnd(18)} ${mask(env[k])}`));
skipped.forEach((k) => console.log(`  ${k.padEnd(18)} \x1b[2m(blank — skipped)\x1b[0m`));
console.log(hasRef ? `\n  project: ${ref}` : '\n  project: linked project (no SUPABASE_PROJECT_REF set)');

if (DRY) {
  console.log('\n--dry: nothing was sent.\n');
  process.exit(0);
}

/* ── Push ────────────────────────────────────────────────────────────────── */

const args = ['secrets', 'set', ...pushing.map((k) => `${k}=${env[k]}`)];
if (hasRef) args.push('--project-ref', ref);

console.log('\nRunning: supabase secrets set ' + pushing.join(' ') + (hasRef ? ` --project-ref ${ref}` : '') + '\n');

const result = spawnSync('supabase', args, { stdio: 'inherit', shell: true });

if (result.error || result.status !== 0) {
  console.error('\n✖ Could not push secrets.');
  console.error('  Is the Supabase CLI installed and are you logged in?');
  console.error('    npm i -g supabase   &&   supabase login   &&   supabase link\n');
  console.error('  Or set them by hand: Supabase dashboard → Project Settings →');
  console.error('  Edge Functions → Secrets.\n');
  process.exit(1);
}

console.log('\n✓ Secrets uploaded.\n');
console.log('  Next:  supabase functions deploy send-reminders --no-verify-jwt');
console.log('  Test:  see README § 7.5\n');
