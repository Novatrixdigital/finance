import { describe, it, expect, beforeEach } from 'vitest';
import {
  setMoneyDefaults,
  defaultCurrency,
  currencySymbol,
  formatMoney,
  formatCompact,
  formatSigned,
  formatPercent,
  toISODate,
  daysUntil,
  formatRelativeDate,
  initials,
  truncate,
} from './format';

/*
  Money and dates are the two things this product cannot get wrong, and they
  were the two things with no test at all. Every case below is one that either
  reached production or is a boundary the code explicitly reasons about.
*/

beforeEach(() => {
  // The active currency is module state, so each test starts from a known one.
  setMoneyDefaults({ currency: 'INR' });
});

describe('setMoneyDefaults', () => {
  it('changes what every later format call uses', () => {
    expect(formatMoney(1000)).toContain('₹');
    setMoneyDefaults({ currency: 'USD' });
    expect(defaultCurrency()).toBe('USD');
    expect(formatMoney(1000)).toContain('$');
  });

  it('follows the currency into its grouping, not just its symbol', () => {
    // The bug this guards: en-IN grouping applied to dollars, giving
    // "$10,00,000" — lakh-grouped dollars, which is nobody's convention.
    setMoneyDefaults({ currency: 'USD' });
    expect(formatMoney(1000000)).toBe('$ 1,000,000');

    setMoneyDefaults({ currency: 'INR' });
    expect(formatMoney(1000000)).toBe('₹ 10,00,000');
  });

  it('ignores a currency it has no symbol for rather than blanking the app', () => {
    setMoneyDefaults({ currency: 'ZZZ' });
    expect(defaultCurrency()).toBe('INR');
  });

  it('tolerates being called with nothing', () => {
    expect(() => setMoneyDefaults()).not.toThrow();
  });
});

describe('formatMoney', () => {
  it('groups in the Indian system by default', () => {
    expect(formatMoney(2485000)).toBe('₹ 24,85,000');
  });

  it('hides decimals on whole amounts and shows them on paise', () => {
    expect(formatMoney(1200)).toBe('₹ 1,200');
    expect(formatMoney(1200.5)).toBe('₹ 1,200.50');
  });

  it('treats sub-half-paise noise as whole', () => {
    // Floating point sums land on 1200.000000001; that must not render
    // "₹ 1,200.00" and imply a precision the ledger does not have.
    expect(formatMoney(1200.000000001)).toBe('₹ 1,200');
  });

  it('uses a real minus sign, not a hyphen', () => {
    expect(formatMoney(-500)).toBe('−₹ 500');
  });

  it('falls back to zero for values that are not numbers', () => {
    expect(formatMoney(null)).toBe('₹ 0');
    expect(formatMoney(undefined)).toBe('₹ 0');
    expect(formatMoney(NaN)).toBe('₹ 0');
    expect(formatMoney('not a number')).toBe('₹ 0');
  });

  it('honours a per-call currency over the active default', () => {
    expect(formatMoney(1000, { currency: 'GBP' })).toContain('£');
    expect(defaultCurrency()).toBe('INR');
  });

  it('can drop the symbol and the space', () => {
    expect(formatMoney(1000, { withSymbol: false })).toBe('1,000');
    expect(formatMoney(1000, { spaced: false })).toBe('₹1,000');
  });
});

describe('formatCompact', () => {
  it('uses lakh and crore for rupees', () => {
    expect(formatCompact(2485000)).toBe('₹25L');
    expect(formatCompact(12000000)).toBe('₹1.2Cr');
    expect(formatCompact(5000)).toBe('₹5K');
  });

  it('uses M and B for everything else', () => {
    expect(formatCompact(12000000, { currency: 'USD' })).toBe('$12M');
    expect(formatCompact(2000000000, { currency: 'USD' })).toBe('$2B');
  });

  it('keeps the sign', () => {
    expect(formatCompact(-2485000)).toBe('−₹25L');
  });
});

describe('formatSigned', () => {
  it('marks direction and never shows a negative amount twice', () => {
    expect(formatSigned(500, 'income')).toBe('+ ₹ 500');
    expect(formatSigned(500, 'expense')).toBe('− ₹ 500');
    expect(formatSigned(-500, 'expense')).toBe('− ₹ 500');
    expect(formatSigned(500, 'transfer')).toBe('₹ 500');
  });
});

describe('formatPercent', () => {
  it('trims a trailing .0 but keeps real precision', () => {
    expect(formatPercent(12)).toBe('12%');
    expect(formatPercent(12.5)).toBe('12.5%');
    expect(formatPercent(12, { signed: true })).toBe('+12%');
    expect(formatPercent(-12)).toBe('-12%');
  });
});

describe('toISODate', () => {
  it('formats in LOCAL time, not UTC', () => {
    // toISOString() would roll this back a day anywhere east of UTC, which is
    // every user of an India-first product. A transaction dated "today" must
    // not be saved as yesterday.
    const d = new Date(2026, 0, 1, 0, 30);
    expect(toISODate(d)).toBe('2026-01-01');
  });

  it('pads month and day', () => {
    expect(toISODate(new Date(2026, 8, 5))).toBe('2026-09-05');
  });

  it('round-trips a date-only string without shifting it', () => {
    expect(toISODate('2026-03-31')).toBe('2026-03-31');
  });
});

describe('daysUntil', () => {
  it('counts whole days, ignoring the time of day', () => {
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 23, 59);
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 0, 1);

    expect(daysUntil(today)).toBe(0);
    expect(daysUntil(tomorrow)).toBe(1);
    // Negative means overdue — the whole payments screen keys off this sign.
    expect(daysUntil(yesterday)).toBe(-1);
  });

  it('returns 0 for a missing date rather than NaN', () => {
    expect(daysUntil(null)).toBe(0);
    expect(daysUntil('')).toBe(0);
  });
});

describe('formatRelativeDate', () => {
  it('names the days around today', () => {
    const at = (offset) => {
      const t = new Date();
      return new Date(t.getFullYear(), t.getMonth(), t.getDate() + offset);
    };
    expect(formatRelativeDate(at(0))).toBe('Today');
    expect(formatRelativeDate(at(-1))).toBe('Yesterday');
    expect(formatRelativeDate(at(1))).toBe('Tomorrow');
    expect(formatRelativeDate(at(-3))).toBe('3 days ago');
    expect(formatRelativeDate(at(3))).toBe('In 3 days');
  });

  it('falls back to a date once the window is past', () => {
    const old = new Date(2020, 0, 15);
    expect(formatRelativeDate(old)).toContain('2020');
  });

  it('shows an em dash for nothing', () => {
    expect(formatRelativeDate(null)).toBe('—');
  });
});

describe('initials', () => {
  it('takes first and last, never the middle', () => {
    expect(initials('Surendran M')).toBe('SM');
    expect(initials('Ada Byron Lovelace')).toBe('AL');
  });

  it('handles one name, empty input and stray whitespace', () => {
    expect(initials('Novatrix')).toBe('NO');
    expect(initials('')).toBe('NV');
    expect(initials('   ')).toBe('NV');
    expect(initials()).toBe('NV');
  });
});

describe('truncate', () => {
  it('only cuts when it has to, and marks the cut', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate(null)).toBe('');
  });
});

describe('currencySymbol', () => {
  it('returns the code itself when there is no symbol for it', () => {
    expect(currencySymbol('INR')).toBe('₹');
    expect(currencySymbol('JPY')).toBe('JPY');
  });
});
