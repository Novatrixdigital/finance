import { describe, it, expect, vi } from 'vitest';
import { cx, groupBy, sumBy, clamp, progressOf, partition, tintFor, debounce, toCSV } from './utils';

describe('cx', () => {
  it('drops falsy parts and flattens nesting', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
    expect(cx(['a', ['b', 'c']], 'd')).toBe('a b c d');
    expect(cx()).toBe('');
  });
});

describe('groupBy', () => {
  it('buckets by the key function', () => {
    const rows = [
      { type: 'income', n: 1 },
      { type: 'expense', n: 2 },
      { type: 'income', n: 3 },
    ];
    const out = groupBy(rows, (r) => r.type);
    expect(Object.keys(out).sort()).toEqual(['expense', 'income']);
    expect(out.income).toHaveLength(2);
  });

  it('survives a null list', () => {
    expect(groupBy(null, (x) => x)).toEqual({});
  });
});

describe('sumBy', () => {
  it('totals numbers and treats unusable values as zero', () => {
    expect(sumBy([{ a: 1 }, { a: 2 }], (x) => x.a)).toBe(3);
    // Amounts arrive from PostgREST as strings; they must still add up.
    expect(sumBy([{ a: '1.5' }, { a: '2.5' }], (x) => x.a)).toBe(4);
    expect(sumBy([{ a: null }, { a: 'x' }, { a: 5 }], (x) => x.a)).toBe(5);
    expect(sumBy(null, (x) => x)).toBe(0);
  });
});

describe('clamp', () => {
  it('holds the bounds', () => {
    expect(clamp(50)).toBe(50);
    expect(clamp(-10)).toBe(0);
    expect(clamp(999)).toBe(100);
    expect(clamp('abc')).toBe(0);
    expect(clamp(5, 1, 3)).toBe(3);
  });
});

describe('progressOf', () => {
  it('caps at 100 and never divides by zero', () => {
    expect(progressOf(50, 100)).toBe(50);
    expect(progressOf(150, 100)).toBe(100);
    // A goal with no target must render an empty bar, not NaN or Infinity.
    expect(progressOf(50, 0)).toBe(0);
    expect(progressOf(50, null)).toBe(0);
  });
});

describe('partition', () => {
  it('splits into matches and rest, preserving order', () => {
    const [even, odd] = partition([1, 2, 3, 4], (n) => n % 2 === 0);
    expect(even).toEqual([2, 4]);
    expect(odd).toEqual([1, 3]);
    expect(partition(null, () => true)).toEqual([[], []]);
  });
});

describe('tintFor', () => {
  it('is deterministic and stays inside the palette', () => {
    const palette = ['#111', '#222', '#333'];
    expect(tintFor('Groceries', palette)).toBe(tintFor('Groceries', palette));
    expect(palette).toContain(tintFor('anything', palette));
  });
});

describe('debounce', () => {
  it('runs once, after the wait, with the last arguments', async () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 100);

    d('a');
    d('b');
    d('c');
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('c');

    vi.useRealTimers();
  });

  it('can be cancelled before it fires', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 100);
    d('a');
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('toCSV', () => {
  it('writes a header row from the first object', () => {
    expect(toCSV([{ Date: '2026-01-01', Amount: 100 }])).toBe(
      'Date,Amount\r\n"2026-01-01","100"',
    );
  });

  it('neutralises spreadsheet formula injection', () => {
    /*
      A description is free text a user types. Without the leading apostrophe,
      opening the export in Excel executes it — the classic CSV injection.
    */
    const csv = toCSV([{ Description: '=HYPERLINK("http://evil","click me")' }]);
    expect(csv).toContain(`"'=HYPERLINK`);
    expect(csv).not.toContain('"=HYPERLINK');

    for (const lead of ['=', '+', '-', '@']) {
      expect(toCSV([{ D: `${lead}cmd` }])).toContain(`"'${lead}cmd"`);
    }
  });

  it('does not mangle ordinary text that merely contains those characters', () => {
    expect(toCSV([{ D: 'Rent - March' }])).toContain('"Rent - March"');
  });

  it('doubles embedded quotes so the cell stays one cell', () => {
    expect(toCSV([{ D: 'He said "hi"' }])).toContain('"He said ""hi"""');
  });

  it('renders null and undefined as empty cells, not the words', () => {
    const csv = toCSV([{ A: null, B: undefined, C: 0 }]);
    expect(csv).toBe('A,B,C\r\n"","","0"');
  });

  it('returns nothing for nothing', () => {
    expect(toCSV([])).toBe('');
    expect(toCSV(null)).toBe('');
  });
});
