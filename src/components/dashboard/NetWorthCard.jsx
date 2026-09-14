import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, TrendingUp, TrendingDown, ChevronRight, User, Briefcase, Layers } from 'lucide-react';
import { Card } from '@/components/ui';
import { BarSpark } from '@/components/brand/WaveViz';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useModals } from '@/context/ModalContext';
import { formatMoney } from '@/lib/format';
import { QUICK_ACTIONS, SCOPES } from '@/lib/constants';
import { cx, icon as resolveIcon } from '@/lib/utils';

/**
 * Net worth headline plus the personal / business split.
 *
 * The eye toggle blanks every figure — useful when the screen is shared, and
 * the kind of small courtesy a finance product is judged on.
 */
export function NetWorthCard({ stats, trend = [] }) {
  const { scope, setScope, hidden, toggleHidden } = useWorkspace();
  const navigate = useNavigate();

  const growth = stats.netWorthGrowth;
  const positive = growth >= 0;
  const Trend = positive ? TrendingUp : TrendingDown;

  const mask = (value) => (hidden ? '••••••' : formatMoney(value));

  const allRows = [
    { id: SCOPES.PERSONAL, label: 'Personal', Icon: User, value: stats.personalBalance },
    { id: SCOPES.BUSINESS, label: 'Business', Icon: Briefcase, value: stats.businessBalance },
  ];

  if (stats.hasShared) {
    allRows.push({
      id: 'shared',
      label: 'Shared by both',
      Icon: Layers,
      value: stats.sharedBalance,
    });
  }

  const rows = allRows.filter((row) => {
    if (scope === SCOPES.PERSONAL) return row.id === SCOPES.PERSONAL;
    if (scope === SCOPES.BUSINESS) return row.id === SCOPES.BUSINESS;
    return true;
  });

  const openScope = (scopeId) => {
    // "Shared by both" has no scope of its own — Combined is where it all adds
    // up, so that is where the row leads.
    setScope(scopeId === 'shared' ? SCOPES.COMBINED : scopeId);
    navigate('/accounts');
  };

  return (
    <Card>
      <div className="mb-5 flex items-start justify-between">
        <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">Your Net Worth</h3>
        <button
          type="button"
          onClick={toggleHidden}
          aria-label={hidden ? 'Show amounts' : 'Hide amounts'}
          className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
        >
          {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Steps down a size so a 9-figure rupee total still fits the rail
              instead of being truncated to "₹ 24,85,…". */}
          <p className="truncate text-[2rem] font-bold leading-none tracking-[-0.03em] tnum text-ink sm:text-[2.35rem]">
            {mask(stats.netWorth)}
          </p>
          <p
            className={cx(
              'mt-2.5 flex items-center gap-1.5 text-[12.5px] font-medium',
              positive ? 'text-accent' : 'text-negative',
            )}
          >
            <Trend size={14} strokeWidth={2.4} />
            {positive ? '+' : ''}
            {growth}%
            <span className="font-normal text-ink-muted">from last month</span>
          </p>
        </div>

        <BarSpark values={trend} className="shrink-0 opacity-90" />
      </div>

      {/* Split rows */}
      <div className="mt-6 space-y-2">
        {rows.map(({ id, label, Icon, value }) => (
          <button
            key={id}
            type="button"
            onClick={() => openScope(id)}
            className="group flex w-full items-center gap-3 rounded-2xl border border-hair bg-surface px-4 py-3.5 text-left transition-all duration-400 ease-premium hover:border-hair-strong hover:bg-elevated"
          >
            <span className="icon-tile h-9 w-9 group-hover:border-accent/30 group-hover:bg-lime/[0.07]">
              <Icon
                size={15}
                strokeWidth={1.9}
                className="text-ink-muted transition-colors duration-300 group-hover:text-accent"
              />
            </span>
            <span className="flex-1 text-[13px] font-medium text-ink-dim">{label}</span>
            <span className="text-[14px] font-semibold tnum text-ink">{mask(value)}</span>
            <ChevronRight
              size={15}
              className="shrink-0 text-ink-muted transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-accent"
            />
          </button>
        ))}
      </div>
    </Card>
  );
}

/**
 * Four square action tiles. The first is the primary lime action; the rest
 * light up only on hover so the panel stays quiet.
 */
export function QuickActions() {
  const { open } = useModals();

  const run = (id) => {
    if (id === 'transfer') open('transaction', { defaultType: 'transfer' });
    else if (id === 'transaction') open('transaction');
    else open(id);
  };

  return (
    <Card>
      <h3 className="mb-5 text-[17px] font-semibold tracking-[-0.01em] text-ink">Quick Actions</h3>

      <div className="grid grid-cols-4 gap-1.5 sm:gap-2.5">
        {QUICK_ACTIONS.map(({ id, label, icon: iconName, accent }) => {
          const Icon = resolveIcon(iconName);
          const [top, bottom] = label.split('\n');

          return (
            <button
              key={id}
              type="button"
              onClick={() => run(id)}
              className={cx(
                'group flex flex-col items-center gap-2 sm:gap-2.5 rounded-2xl border px-1 sm:px-2 py-3 sm:py-4 transition-all duration-400 ease-premium',
                accent
                  ? 'border-accent/35 bg-lime/[0.07] hover:bg-lime/[0.12]'
                  : 'border-hair bg-surface hover:border-accent/30 hover:bg-elevated',
              )}
            >
              <span
                className={cx(
                  'flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl transition-colors duration-300',
                  accent
                    ? 'bg-lime text-black'
                    : 'border border-hair bg-elevated text-ink-dim group-hover:text-accent',
                )}
              >
                <Icon size={16} strokeWidth={2.2} />
              </span>
              <span className="text-center text-[9.5px] xs:text-[10.5px] font-medium leading-[1.25] text-ink-dim">
                {top}
                <br />
                {bottom}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export default NetWorthCard;
