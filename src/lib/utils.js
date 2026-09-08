import { ICON_REGISTRY } from '@/lib/icons';

/** Tiny className joiner — nulls and falses drop out. */
export function cx(...parts) {
  return parts.flat(Infinity).filter(Boolean).join(' ');
}

/**
 * Resolves an icon name stored in the database ('building-2', 'TrendingUp')
 * to a Lucide component, via the explicit registry in lib/icons.js.
 *
 * Falls back to a neutral glyph so an unknown value from a user-created
 * category can never crash a render.
 */
export function icon(name, fallback = 'Circle') {
  if (!name) return ICON_REGISTRY[fallback] || ICON_REGISTRY.Circle;

  const pascal = String(name)
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');

  return (
    ICON_REGISTRY[pascal] ||
    ICON_REGISTRY[name] ||
    ICON_REGISTRY[fallback] ||
    ICON_REGISTRY.Circle
  );
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Groups an array into a Map keyed by the result of `keyFn`. */
export function groupBy(list, keyFn) {
  return (list || []).reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] ||= []).push(item);
    return acc;
  }, {});
}

export function sumBy(list, pick) {
  return (list || []).reduce((total, item) => total + (Number(pick(item)) || 0), 0);
}

/** Clamps to [min, max]. */
export function clamp(n, min = 0, max = 100) {
  return Math.min(Math.max(Number(n) || 0, min), max);
}

/** Percentage of target reached, capped at 100 for progress bars. */
export function progressOf(current, target) {
  if (!target) return 0;
  return clamp((Number(current) / Number(target)) * 100, 0, 100);
}

export function debounce(fn, wait = 250) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** Deterministic accent for an arbitrary string (avatar tints, category dots). */
export function tintFor(text, palette) {
  const colors = palette || ['#C8FF00', '#A8E600', '#7DD3FC', '#FFB547', '#A78BFA', '#F472B6'];
  let hash = 0;
  for (let i = 0; i < String(text).length; i += 1) {
    hash = (hash * 31 + String(text).charCodeAt(i)) >>> 0;
  }
  return colors[hash % colors.length];
}

/** Rows → CSV download. Used by every export button in the app. */
export function downloadCSV(filename, rows) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);

  const escape = (value) => {
    const s = value === null || value === undefined ? '' : String(value);
    // Guard against spreadsheet formula injection on untrusted text.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\r\n');

  // Lead with a UTF-8 BOM so Excel opens rupee symbols and names correctly.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Splits a list into `[matching, rest]`. */
export function partition(list, predicate) {
  const yes = [];
  const no = [];
  (list || []).forEach((item) => (predicate(item) ? yes : no).push(item));
  return [yes, no];
}
