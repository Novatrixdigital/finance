import { useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, FileText, TrendingUp, Wifi, BatteryFull, Signal } from 'lucide-react';
import { LogoMark } from '@/components/brand/Logo';
import { ArcField } from '@/components/brand/WaveViz';
import { formatMoney, formatCompact, formatRelativeDate } from '@/lib/format';
import { cx } from '@/lib/utils';

/* ── Sparkline drawn from the real cash-flow series ──────────────────────── */
function MiniTrend({ points = [] }) {
  const path = useMemo(() => {
    const values = points.length ? points : [30, 42, 38, 55, 48, 68, 62, 80];
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = max - min || 1;

    const coords = values.map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * 100;
      const y = 34 - ((v - min) / span) * 28;
      return [x, y];
    });

    // Smooth the polyline into a curve so it reads as a chart, not a zigzag.
    let d = `M ${coords[0][0]} ${coords[0][1]}`;
    for (let i = 1; i < coords.length; i += 1) {
      const [px, py] = coords[i - 1];
      const [cxp, cyp] = coords[i];
      const mx = (px + cxp) / 2;
      d += ` Q ${px} ${py} ${mx} ${(py + cyp) / 2} T ${cxp} ${cyp}`;
    }
    return { line: d, area: `${d} L 100 40 L 0 40 Z` };
  }, [points]);

  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-11 w-full" aria-hidden="true">
      <defs>
        <linearGradient id="phone-trend" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C8FF00" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#C8FF00" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path.area} fill="url(#phone-trend)" />
      <path d={path.line} fill="none" stroke="#C8FF00" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/* ── Phone chrome ────────────────────────────────────────────────────────── */
function PhoneFrame({ children, className, tone = 'dark' }) {
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-[2.4rem] border border-hair-strong p-[3px] shadow-lift',
        tone === 'dark' ? 'bg-night-500' : 'bg-night-600',
        className,
      )}
    >
      <div className="relative h-full w-full overflow-hidden rounded-[2.15rem] bg-night-900">
        {/* Notch */}
        <div className="absolute left-1/2 top-2 z-20 h-[18px] w-[70px] -translate-x-1/2 rounded-full bg-black/85" />

        {/* Status bar */}
        <div className="relative z-10 flex items-center justify-between px-5 pb-1 pt-[9px] text-[9px] font-medium text-white/60">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <Signal size={8} />
            <Wifi size={8} />
            <BatteryFull size={10} />
          </span>
        </div>

        {children}
      </div>
    </div>
  );
}

const ACTIONS = [
  { Icon: ArrowDownLeft, label: 'Income' },
  { Icon: ArrowUpRight, label: 'Expense' },
  { Icon: ArrowLeftRight, label: 'Transfer' },
  { Icon: FileText, label: 'Invoice' },
];

/**
 * The hero product shot: two overlapping app screens, one personal and one
 * business, wrapped in editorial annotations.
 *
 * It is fed the user's real balance and transactions, so the "screenshot" is
 * genuinely their account rather than a static mock.
 */
export function PhoneVisual({ totalBalance = 0, growth = 0, transactions = [], trend = [], business = 0 }) {
  const recent = transactions.slice(0, 3);

  return (
    <div className="relative select-none">
      {/* Ambience */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[26rem] max-h-[34rem] w-full max-w-[34rem] -translate-x-1/2 -translate-y-1/2 lime-orb sm:h-[34rem]" />
        <div className="absolute inset-0 opacity-70">
          <ArcField />
        </div>
      </div>

      {/*
        Editorial annotations sit in normal flow above and below the devices.
        They were absolutely positioned over the phone area before, which meant
        they printed straight across the screens at most widths.
      */}
      <p className="mb-1 hidden text-right font-editorial text-[17px] italic leading-[1.2] text-ink-dim xl:block">
        Discipline today, freedom tomorrow.
      </p>

      <div className="relative mx-auto flex h-[26rem] w-full max-w-[26rem] items-center justify-center sm:h-[29rem]">
        {/* ── Back phone: Business ──────────────────────────────────────── */}
        <PhoneFrame
          tone="light"
          className="absolute left-[6%] top-3 h-[21rem] w-[11rem] -rotate-[9deg] opacity-90 sm:h-[23rem] sm:w-[12.5rem]"
        >
          <div className="px-4 pt-4">
            <div className="mb-4 flex items-center justify-between">
              <LogoMark size={22} />
              <span className="rounded-full border border-lime/25 bg-lime/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-lime">
                Business
              </span>
            </div>

            <p className="text-[9px] uppercase tracking-[0.12em] text-white/35">Business Balance</p>
            <p className="mt-1 text-[19px] font-bold tracking-tight text-white tnum">
              {formatCompact(business)}
            </p>

            <div className="mt-4 space-y-2">
              {['Receivables', 'Payables', 'Runway'].map((label, i) => (
                <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5">
                  <p className="text-[8.5px] uppercase tracking-[0.1em] text-white/35">{label}</p>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-lime"
                      style={{ width: `${[68, 42, 84][i]}%`, opacity: 0.5 + i * 0.2 }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-lime/20 bg-lime/[0.06] p-3">
              <TrendingUp size={12} className="mb-1.5 text-lime" />
              <p className="text-[9px] leading-snug text-white/60">
                More control.
                <br />
                More freedom.
              </p>
            </div>
          </div>
        </PhoneFrame>

        {/* ── Front phone: Personal ─────────────────────────────────────── */}
        <PhoneFrame className="absolute right-[4%] top-8 z-10 h-[22rem] w-[12rem] rotate-[4deg] sm:h-[26rem] sm:w-[13.5rem]">
          <div className="px-4 pt-3">
            <div className="mb-3 flex items-center justify-between">
              <LogoMark size={22} />
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-white/50">
                Personal
              </span>
            </div>

            <p className="text-[9px] uppercase tracking-[0.12em] text-white/35">Total Balance</p>
            <p className="mt-1 text-[21px] font-bold leading-none tracking-tight text-white tnum">
              {formatMoney(totalBalance)}
            </p>
            <p className="mt-1.5 flex items-center gap-1 text-[9.5px] font-medium text-lime">
              <TrendingUp size={9} />
              {growth >= 0 ? '+' : ''}
              {growth}% this month
            </p>

            <MiniTrend points={trend} />

            {/* Action grid */}
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {ACTIONS.map(({ Icon, label }) => (
                <div
                  key={label}
                  className="flex flex-col items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.03] py-2"
                >
                  <Icon size={11} className="text-lime" strokeWidth={2.2} />
                  <span className="text-[7px] font-medium text-white/45">{label}</span>
                </div>
              ))}
            </div>

            {/* Recent */}
            <p className="mb-1.5 mt-4 text-[9px] font-semibold text-white/70">Recent Transactions</p>
            <div className="space-y-1.5">
              {(recent.length
                ? recent
                : [
                    { id: 'a', description: 'Client Payment', amount: 150000, type: 'income', txn_date: null },
                    { id: 'b', description: 'Office Rent', amount: 60000, type: 'expense', txn_date: null },
                    { id: 'c', description: 'Amazon Purchase', amount: 8499, type: 'expense', txn_date: null },
                  ]
              ).map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] p-1.5"
                >
                  <span
                    className={cx(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
                      t.type === 'income' ? 'bg-lime/15 text-lime' : 'bg-white/[0.06] text-white/45',
                    )}
                  >
                    {t.type === 'income' ? <ArrowDownLeft size={9} /> : <ArrowUpRight size={9} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[8px] font-medium text-white/75">
                      {t.description}
                    </span>
                    <span className="block text-[7px] text-white/30">
                      {t.txn_date ? formatRelativeDate(t.txn_date) : 'Today'}
                    </span>
                  </span>
                  <span
                    className={cx(
                      'shrink-0 text-[8px] font-semibold tnum',
                      t.type === 'income' ? 'text-lime' : 'text-white/55',
                    )}
                  >
                    {t.type === 'income' ? '+' : '−'}
                    {formatCompact(t.amount, { withSymbol: true })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </PhoneFrame>

      </div>

      <p className="mt-2 hidden text-right text-[11.5px] font-semibold uppercase leading-[1.6] tracking-[0.1em] text-ink-muted xl:block">
        Personal &amp; Business <span className="text-accent">Together.</span>
      </p>
    </div>
  );
}

export default PhoneVisual;
