/**
 * Application configuration — one place that knows the app's own address.
 *
 * Auth redirects (email confirmation, OAuth callback, password reset) have to
 * be absolute URLs. Deriving them from `window.location.origin` works, but it
 * silently sends production users to whatever host they happened to load —
 * a preview deployment, an IP address, a stale custom domain.
 *
 * `VITE_APP_URL` pins the canonical origin; the browser origin is only a
 * development fallback.
 */

const RAW_APP_URL = import.meta.env.VITE_APP_URL || '';

/** Strips any trailing slash so `${SITE_URL}/path` never doubles up. */
function normalise(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

const configured = normalise(RAW_APP_URL);

/**
 * The canonical origin for this deployment.
 *
 * In development the configured value is deliberately ignored — otherwise
 * every magic link from localhost would bounce you to production.
 */
export const SITE_URL = (() => {
  const browserOrigin = typeof window !== 'undefined' ? normalise(window.location.origin) : '';

  if (import.meta.env.DEV) return browserOrigin || configured || 'http://localhost:5173';
  return configured || browserOrigin;
})();

/** Builds an absolute URL against the site origin. `path` may omit the slash. */
export function siteUrl(path = '') {
  const suffix = String(path || '');
  if (!suffix) return SITE_URL;
  return `${SITE_URL}${suffix.startsWith('/') ? '' : '/'}${suffix}`;
}

/** Routes Supabase redirects back into the SPA. */
export const AUTH_REDIRECTS = {
  callback: () => siteUrl('/auth/callback'),
  reset: () => siteUrl('/reset'),
};

export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Novatrix Digital';
export const DEFAULT_CURRENCY = import.meta.env.VITE_DEFAULT_CURRENCY || 'INR';

/** Router basename — set VITE_BASE_PATH only when hosting under a subdirectory. */
export const BASE_PATH = normalise(import.meta.env.BASE_URL || '/') || '/';

export default { SITE_URL, siteUrl, AUTH_REDIRECTS, APP_NAME, DEFAULT_CURRENCY, BASE_PATH };
