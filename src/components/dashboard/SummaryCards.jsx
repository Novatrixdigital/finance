import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  ArrowDownLeft,
  TrendingUp,
  TrendingDown,
  Wallet,
  Hourglass,
  CalendarClock,
} from 'lucide-react';
import { formatMoney } from '@/lib/format';
import { cx } from '@/lib/utils';

/**
 * One card. Icon tile top-right, oversized figure, small delta underneath.
 * `tone` decides whether the delta reads as good or bad — an expense rising is
 * not the same news as income rising.
 */
function StatCard({ label, sub, value, delta, deltaLabel, Icon, tone = 'neutral', accent, to, meta }) {
  const navigate = useNavigate();

  const positive = delta >= 0;
  // For expenses, up is bad; for everything else, up is good.
  const good = tone === 'inverse' ? !positive : positive;
  const DeltaIcon = positive ? TrendingUp : TrendingDown;

  return (
    <button
      type="button"
      onClick={() => to && navigate(to)}
      disabled={!to}
      className={cx(
        'bento bento-pad group flex flex-col items-start text-left transition-all duration-500 ease-premium',
        to && 'hover:border-hair-strong hover:bg-elevated',
        !to && 'cursor-default',
      )}
    >
      <div className="mb-5 flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-dim">
            {label}
            {sub && <span className="ml-1.5 text-[11.5px] text-ink-muted">({sub})</span>}
          </p>
        </div>

        <span
          className={cx(
            'icon-tile h-10 w-10 shrink-0',
            accent === 'lime' && 'border-accent/30 bg-accent/12 text-accent',
            accent === 'negative' && 'border-negative/25 bg-negative/10 text-negative',
            accent === 'warning' && 'border-warning/25 bg-warning/10 text-warning',
            !accent && 'text-ink-dim',
          )}
        >
          <Icon size={17} strokeWidth={2} />
        </span>
      </div>

      <p className="w-full truncate text-figure-md tnum text-ink">{formatMoney(value)}</p>

      {delta !== undefined && delta !== null ? (
        <p
          className={cx(
            'mt-2.5 flex items-center gap-1.5 text-[12px] font-medium',
            good ? 'text-accent' : 'text-negative',
          )}
        >
          <DeltaIcon size={13} strokeWidth={2.4} />
          {positive ? '+' : ''}
          {delta}%
          {deltaLabel && <span className="font-normal text-ink-muted">{deltaLabel}</span>}
        </p>
      ) : (
        <p className="mt-2.5 text-[12px] text-ink-muted">{meta}</p>
      )}
    </button>
  );
}

/**
 * The five headline figures under the hero.
 *
 * A five-column grid on wide screens; it steps down to three, then two, then
 * a horizontal scroll strip on phones so nothing is ever crushed.
 */
export function SummaryCards({ stats }) {
  const cards = [
    {
      key: 'balance',
      label: 'Total Balance',
      value: stats.totalBalance,
      delta: stats.netWorthGrowth,
      deltaLabel: 'from last month',
      Icon: Wallet,
      accent: 'lime',
      to: '/accounts',
    },
    {
      key: 'income',
      label: 'Income',
      sub: 'This Month',
      value: stats.income,
      delta: stats.incomeGrowth,
      Icon: ArrowDownLeft,
      to: '/transactions',
    },
    {
      key: 'expense',
      label: 'Expenses',
      sub: 'This Month',
      value: stats.expense,
      delta: stats.expenseGrowth,
      tone: 'inverse',
      Icon: ArrowUpRight,
      accent: 'negative',
      to: '/transactions',
    },
    {
      key: 'receivables',
      label: 'Pending Receivables',
      value: stats.receivables,
      meta: `${stats.receivableCount} invoice${stats.receivableCount === 1 ? '' : 's'}`,
      Icon: Hourglass,
      accent: 'warning',
      to: '/invoices',
    },
    {
      key: 'upcoming',
      label: 'Upcoming Payments',
      value: stats.upcoming,
      meta: `${stats.upcomingCount} payment${stats.upcomingCount === 1 ? '' : 's'}`,
      Icon: CalendarClock,
      to: '/payments',
    },
  ];

  return (
    <div className="-mx-4 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:overflow-visible sm:px-0">
      <div className="stagger grid min-w-[42rem] grid-cols-5 gap-4 sm:min-w-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map(({ key, ...card }) => (
          // React warns when the key prop travels inside a spread.
          <StatCard key={key} {...card} />
        ))}
      </div>
    </div>
  );
}

export default SummaryCards;
