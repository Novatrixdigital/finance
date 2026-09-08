/**
 * Build guard — refuses to ship a secret to the browser.
 *
 * Vite inlines every VITE_* variable into the bundle. That is fine for the
 * Supabase anon key (RLS makes it useless on its own) and fatal for anything
 * else. This runs before `vite build` and fails loudly if a key that looks
 * like a credential has picked up the VITE_ prefix.
 *
 *   node scripts/check-env.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/* Names that must never be public, matched against the part after VITE_. */
const FORBIDDEN = [
  { pattern: /RESEND/i, why: 'a Resend key can send mail as your domain' },
  { pattern: /SERVICE_ROLE/i, why: 'the service_role key bypasses Row Level Security' },
  { pattern: /SECRET/i, why: 'secrets belong on the server' },
  { pattern: /PRIVATE/i, why: 'private keys belong on the server' },
  { pattern: /PASSWORD/i, why: 'passwords belong on the server' },
  { pattern: /^SUPABASE_SERVICE/i, why: 'the service_role key bypasses Row Level Security' },
  { pattern: /API_KEY$/i, why: 'API keys are credentials', allow: [/SUPABASE_ANON_KEY/i] },
];

/** Very rough shape checks for keys pasted into the wrong slot. */
const VALUE_SHAPES = [
  { pattern: /^re_[A-Za-z0-9_-]{10,}$/, label: 'a Resend API key' },
  { pattern: /^sk-[A-Za-z0-9_-]{20,}$/, label: 'a secret key' },
  { pattern: /^rk_[A-Za-z0-9_-]{10,}$/, label: 'a restricted key' },
];

function parseEnv(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter(({ line }) => line && !line.startsWith('#') && line.includes('='))
    .map(({ line, no }) => {
      const eq = line.indexOf('=');
      return { key: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim(), no };
    });
}

const files = ['.env', '.env.local', '.env.production', '.env.production.local']
  .map((f) => path.join(ROOT, f))
  .filter((f) => fs.existsSync(f));

const problems = [];

for (const file of files) {
  const name = path.basename(file);

  for (const { key, value, no } of parseEnv(file)) {
    if (!key.startsWith('VITE_')) {
      // Non-public var: only check it is not obviously mislabelled.
      continue;
    }

    const bare = key.slice(5);

    for (const rule of FORBIDDEN) {
      if (rule.allow?.some((a) => a.test(bare))) continue;
      if (rule.pattern.test(bare)) {
        problems.push(
          `${name}:${no}  ${key}\n      → ${rule.why}.\n` +
            `      Rename it to ${bare} (no VITE_ prefix) and push it with ` +
            `\`npm run secrets:push\`.`,
        );
      }
    }

    // Even a innocuously-named VITE_ var can hold a pasted secret.
    for (const shape of VALUE_SHAPES) {
      if (value && shape.pattern.test(value)) {
        problems.push(
          `${name}:${no}  ${key}\n      → the value looks like ${shape.label}, ` +
            `and every VITE_ variable is public.\n` +
            `      Move it out of the VITE_ namespace.`,
        );
      }
    }
  }
}

if (problems.length) {
  const line = '─'.repeat(70);
  console.error(`\n\x1b[31m${line}`);
  console.error('  BUILD BLOCKED — a secret would be published in the bundle');
  console.error(`${line}\x1b[0m\n`);
  problems.forEach((p) => console.error('  \x1b[31m✖\x1b[0m ' + p + '\n'));
  console.error(
    '  Vite inlines every VITE_* variable into the JavaScript it ships,\n' +
      '  so anyone can read it with DevTools. Server secrets belong in the\n' +
      '  Edge Function — see the bottom of .env.example.\n',
  );
  process.exit(1);
}

console.log('✓ env check passed — no secrets in the VITE_ namespace');
