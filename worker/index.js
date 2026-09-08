/**
 * NOVATRIX DIGITAL — Cloudflare Pages Advanced Mode worker
 * ────────────────────────────────────────────────────────────────────────────
 * Placed in /public, this file is copied to /dist at build time. Cloudflare
 * Pages detects `_worker.js` at the output root and hands EVERY request to it
 * instead of using the default static handler.
 *
 * What it does:
 *   1. Serves hashed build assets with a one-year immutable cache.
 *   2. Falls back to index.html for unknown paths so React Router owns routing
 *      (a client-side route like /invoices must not 404 on a hard refresh).
 *   3. Attaches security headers, including a CSP scoped to the Supabase
 *      project this deployment actually talks to.
 *   4. Answers /healthz for uptime checks.
 *
 * NOTE ON SECRETS
 * The worker reads VITE_SUPABASE_URL only to build the CSP `connect-src`.
 * That value is public by design (it already ships inside the JS bundle).
 * The Supabase service_role key must NEVER be added to this environment.
 */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

/** Anything under /assets/ is content-hashed by Vite, so it can be cached hard. */
const IMMUTABLE = /^\/assets\/.+\.[0-9a-zA-Z_-]{8,}\.(js|css|woff2?|png|jpe?g|svg|webp|avif)$/;

/** Extensions we serve as-is rather than rewriting to the SPA shell. */
const STATIC_EXT =
  /\.(js|mjs|css|json|txt|xml|ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|eot|map|webmanifest|pdf)$/i;

function buildCsp(env) {
  // Derive the Supabase origin so connect-src stays as narrow as possible.
  let supabaseOrigin = '';
  try {
    if (env?.VITE_SUPABASE_URL) supabaseOrigin = new URL(env.VITE_SUPABASE_URL).origin;
  } catch {
    supabaseOrigin = '';
  }

  const supabaseWs = supabaseOrigin.replace(/^https:/, 'wss:');

  return [
    "default-src 'self'",
    // Vite emits no inline scripts in production, but the SPA shell may carry
    // a small bootstrap; 'unsafe-inline' is dropped by browsers that honour
    // nonces, and kept here for the module preload shim.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${supabaseOrigin} ${supabaseWs}`.trim(),
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function withHeaders(response, { env, immutable = false, html = false }) {
  const headers = new Headers(response.headers);

  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => headers.set(key, value));

  if (html) {
    headers.set('Content-Security-Policy', buildCsp(env));
    // The shell must never be cached, or a deploy leaves stale asset links.
    headers.set('Cache-Control', 'no-cache, must-revalidate');
  } else if (immutable) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // ── Health check ───────────────────────────────────────────────────────
    if (pathname === '/healthz') {
      return new Response(
        JSON.stringify({ ok: true, app: 'novatrix-digital', time: new Date().toISOString() }),
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
      );
    }

    // Only GET/HEAD make sense for a static SPA.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    // ── Static asset ───────────────────────────────────────────────────────
    if (STATIC_EXT.test(pathname)) {
      const asset = await env.ASSETS.fetch(request);

      if (asset.status === 404) {
        // A missing asset must 404 rather than silently returning the shell —
        // an HTML body served as .js is the classic white-screen bug.
        return withHeaders(asset, { env });
      }
      return withHeaders(asset, { env, immutable: IMMUTABLE.test(pathname) });
    }

    // ── Try the path itself (covers /_headers-style files and real pages) ──
    const direct = await env.ASSETS.fetch(request);
    if (direct.status !== 404) {
      const isHtml = (direct.headers.get('Content-Type') || '').includes('text/html');
      return withHeaders(direct, { env, html: isHtml });
    }

    // ── SPA fallback ───────────────────────────────────────────────────────
    const shell = await env.ASSETS.fetch(new Request(new URL('/index.html', url), request));

    return withHeaders(
      new Response(shell.body, {
        // A deep link is a real page to the user, so it is a 200, not a 404.
        status: 200,
        headers: shell.headers,
      }),
      { env, html: true },
    );
  },
};
