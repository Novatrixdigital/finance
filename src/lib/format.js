/**
 * Formatting helpers.
 *
 * Money is rendered in the Indian grouping system by default (₹ 24,85,000),
 * which is what the product is designed around. Pass a different locale or
 * currency and everything below follows it.
 */

const DEFAULT_LOCALE = import.meta.env.VITE_DEFAULT_LOCALE || 'en-IN';
const DEFAULT_CURRENCY = import.meta.env.VITE_DEFAULT_CURRENCY || 'INR';

export const CURRENCY_SYMBOLS = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'د.إ',
  SGD: 'S$',
  AUD: 'A$',
  CAD: 'C$',
};

export function currencySymbol(currency = DEFAULT_CURRENCY) {
  return CURRENCY_SYMBOLS[currency] || currency;
}

/**
 * `formatMoney(2485000)` → "₹ 24,85,000"
 * Decimals are hidden unless the value actually has paise, keeping the big
 * dashboard figures clean.
 */
export function formatMoney(value, options = {}) {
  const {
    currency = DEFAULT_CURRENCY,
    locale = DEFAULT_LOCALE,
    decimals,
    withSymbol = true,
    spaced = true,
    signed = false,
  } = options;

  const n = Number(value);
  if (!Number.isFinite(n)) return withSymbol ? `${currencySymbol(currency)}${spaced ? ' ' : ''}0` : '0';

  const hasPaise = Math.abs(n % 1) > 0.004;
  const fraction = decimals ?? (hasPaise ? 2 : 0);

  const body = new Intl.NumberFormat(locale, {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(Math.abs(n));

  const sign = n < 0 ? '−' : signed ? '+' : '';
  const symbol = withSymbol ? `${currencySymbol(currency)}${spaced ? ' ' : ''}` : '';

  return `${sign}${symbol}${body}`;
}

/**
 * Compact Indian notation for tight spaces: 2485000 → "₹24.9L", 12000000 → "₹1.2Cr"
 */
export function formatCompact(value, options = {}) {
  const { currency = DEFAULT_CURRENCY, withSymbol = true } = options;
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const sym = withSymbol ? currencySymbol(currency) : '';
  const sign = n < 0 ? '−' : '';

  const trim = (x) => Number(x.toFixed(x < 10 ? 1 : 0)).toString();

  if (currency === 'INR') {
    if (abs >= 1e7) return `${sign}${sym}${trim(abs / 1e7)}Cr`;
    if (abs >= 1e5) return `${sign}${sym}${trim(abs / 1e5)}L`;
    if (abs >= 1e3) return `${sign}${sym}${trim(abs / 1e3)}K`;
    return `${sign}${sym}${Math.round(abs)}`;
  }

  if (abs >= 1e9) return `${sign}${sym}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${sym}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${sym}${trim(abs / 1e3)}K`;
  return `${sign}${sym}${Math.round(abs)}`;
}

/** Signed money for ledger rows: "+ ₹ 1,50,000" / "− ₹ 60,000" */
export function formatSigned(value, type, options = {}) {
  const n = Math.abs(Number(value) || 0);
  const body = formatMoney(n, options);
  if (type === 'income') return `+ ${body}`;
  if (type === 'expense') return `− ${body}`;
  return body;
}

export function formatPercent(value, { decimals = 1, signed = false } = {}) {
  const n = Number(value) || 0;
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals).replace(/\.0$/, '')}%`;
}

export function formatNumber(value, locale = DEFAULT_LOCALE) {
  return new Intl.NumberFormat(locale).format(Number(value) || 0);
}

/* ── Dates ──────────────────────────────────────────────────────────────── */

function toDate(input) {
  if (!input) return null;
  if (input instanceof Date) return input;
  // Date-only strings must not be shifted by the local timezone.
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Sep 08, 2026" */
export function formatDate(input, opts = {}) {
  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleDateString(DEFAULT_LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...opts,
  });
}

/** "08 Sep" — for dense tables */
export function formatDateShort(input) {
  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleDateString(DEFAULT_LOCALE, { day: '2-digit', month: 'short' });
}

/** "Today", "Yesterday", "3 days ago", then falls back to a date. */
export function formatRelativeDate(input) {
  const d = toDate(input);
  if (!d) return '—';

  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days === -1) return 'Tomorrow';
  if (days > 1 && days < 7) return `${days} days ago`;
  if (days < -1 && days > -7) return `In ${Math.abs(days)} days`;
  return formatDate(d);
}

/** Days until a due date — negative means overdue. */
export function daysUntil(input) {
  const d = toDate(input);
  if (!d) return 0;
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
}

/** `yyyy-mm-dd` in local time — what date inputs and Postgres `date` want. */
export function toISODate(input = new Date()) {
  const d = toDate(input) || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfMonthISO(offsetMonths = 0) {
  const d = new Date();
  return toISODate(new Date(d.getFullYear(), d.getMonth() + offsetMonths, 1));
}

/** "Good Morning" / "Good Afternoon" / "Good Evening" */
export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

/** "SM" from "Surendran M" — used by every avatar in the app. */
export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'NV';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function truncate(text, max = 38) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
