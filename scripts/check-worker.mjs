/**
 * Behavioural check for the edge Worker's routing.
 *
 * The case that matters is the last one a static host gets right: a deep link
 * refreshed with an `If-None-Match` header. dist/_headers marks /index.html
 * `no-cache, must-revalidate`, so the browser revalidates on every refresh.
 * If the fallback forwards those headers to the assets binding, the binding
 * answers 304 with a null body — and a 200 wrapped around a null body is a
 * blank white page. Opening a fresh tab skips the conditional request, which
 * is why the bug looked intermittent.
 *
 *   node scripts/check-worker.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const target = process.argv[2] || 'worker/index.js';
const { default: worker } = await import(pathToFileURL(path.resolve(target)).href);

const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';
const ETAG = '"shell-v1"';

/** Stands in for env.ASSETS, including its handling of conditional requests. */
const ASSETS = {
  async fetch(input) {
    const req = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(req.url);

    if (pathname === '/index.html' || pathname === '/') {
      if (req.headers.get('If-None-Match') === ETAG) {
        return new Response(null, {
          status: 304,
          headers: { etag: ETAG, 'cache-control': 'no-cache, must-revalidate' },
        });
      }
      return new Response(SHELL, {
        status: 200,
        headers: {
          etag: ETAG,
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-cache, must-revalidate',
        },
      });
    }
    return new Response('Not Found', { status: 404 });
  },
};

const env = { ASSETS };
const failures = [];

function check(name, ok, detail) {
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

console.log(`\nWorker routing — ${target}\n`);

console.log('Deep link refreshed (conditional request):');
{
  const res = await worker.fetch(
    new Request('https://finance.example/accounts', { headers: { 'If-None-Match': ETAG } }),
    env,
    {},
  );
  const body = await res.text();
  check('200', res.status === 200, `got ${res.status}`);
  check('shell body is not empty', body.includes('id="root"'), `${body.length} bytes`);
  check('no shared ETag echoed back', !res.headers.get('etag'));
}

console.log('\nDeep link, first visit:');
{
  const res = await worker.fetch(new Request('https://finance.example/cash'), env, {});
  const body = await res.text();
  check('200', res.status === 200, `got ${res.status}`);
  check('shell served', body.includes('id="root"'));
  check('content-type is html', (res.headers.get('content-type') || '').includes('text/html'));
}

console.log('\nMissing asset stays a 404 (never HTML in place of a .js):');
{
  const res = await worker.fetch(
    new Request('https://finance.example/assets/gone-abc123.js'),
    env,
    {},
  );
  check('404', res.status === 404, `got ${res.status}`);
}

console.log('\nHealth probe:');
{
  const res = await worker.fetch(new Request('https://finance.example/healthz'), env, {});
  const json = await res.json();
  check('ok', res.status === 200 && json.ok === true);
}

if (failures.length) {
  console.error(`\n✖ ${failures.length} failing check(s): ${failures.join(', ')}\n`);
  process.exit(1);
}
console.log('\n✓ Worker routing is correct.\n');
