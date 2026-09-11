import { useNavigate } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ArrowRight,
  Quote,
  Target,
  Receipt,
  CalendarClock,
} from 'lucide-react';
import { Card, CardHeader, ViewAllLink, EmptyState, Badge, ProgressBar, LoadingBlock, WorkspaceBadge } from '@/components/ui';
import { WaveViz } from '@/components/brand/WaveViz';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useModals } from '@/context/ModalContext';
import { formatMoney, formatRelativeDate, formatDate, daysUntil } from '@/lib/format';
import { PAYMENT_STATUS, BRAND } from '@/lib/constants';
import { cx, icon as resolveIcon, progressOf } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   RECENT TRANSACTIONS
   ══════════════════════════════════════════════════════════════════════════ */
export function RecentTransactions({ rows = [], loading }) {
  const navigate = useNavigate();
  const { workspaceType, isCombined } = useWorkspace();
  const { open } = useModals();

  const TYPE_ICON = { income: ArrowDownLeft, expense: ArrowUpRight, transfer: ArrowLeftRight };

  return (
    <Card className="h-full">
      <CardHeader
        title="Recent Transactions"
        action={<ViewAllLink onClick={() => navigate('/transactions')} />}
      />

      {loading ? (
        <LoadingBlock rows={5} />
      ) : !rows.length ? (
        <EmptyState
          icon={Receipt}
          compact
          title="No transactions yet"
          description="Your ledger will appear here the moment you record something."
          action={
            <button type="button" onClick={() => open('transaction')} className="btn-secondary btn-sm">
              Add transaction
            </button>
          }
        />
      ) : (
        <ul className="-mx-2">
          {rows.map((t) => {
            const Icon = TYPE_ICON[t.type] || ArrowLeftRight;
            const income = t.type === 'income';
            const type = workspaceType(t.workspace_id);

            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => navigate('/transactions')}
                  className="group flex w-full items-center gap-3.5 rounded-2xl border-t border-hair-soft px-2 py-3 text-left transition-colors duration-300 first:border-0 hover:bg-elevated/60"
                >
                  <span
                    className={cx(
                      'icon-tile h-10 w-10',
                      income
                        ? 'border-accent/25 bg-accent/10 text-accent'
                        : t.type === 'transfer'
                          ? 'text-ink-dim'
                          : 'border-negative/20 bg-negative/[0.07] text-negative',
                    )}
                  >
                    <Icon size={15} strokeWidth={2.1} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">
                      {t.description || 'Transaction'}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                      {isCombined && <WorkspaceBadge type={type} />}
                      <span className="truncate">
                        {t.category?.name ? `${t.category.name} · ` : ''}
                        {formatRelativeDate(t.txn_date)}
                      </span>
                    </span>
                  </span>

                  <span
                    className={cx(
                      'shrink-0 text-[13.5px] font-semibold tnum',
                      income ? 'text-accent' : 'text-ink',
                    )}
                  >
                    {income ? '+ ' : t.type === 'expense' ? '− ' : ''}
                    {formatMoney(t.amount)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   UPCOMING PAYMENTS
   ══════════════════════════════════════════════════════════════════════════ */
export function UpcomingPayments({ rows = [], loading }) {
  const navigate = useNavigate();
  const { open } = useModals();

  return (
    <Card className="h-full">
      <CardHeader title="Upcoming Payments" action={<ViewAllLink onClick={() => navigate('/payments')} />} />

      {loading ? (
        <LoadingBlock rows={4} />
      ) : !rows.length ? (
        <EmptyState
          icon={CalendarClock}
          compact
          title="Nothing due"
          description="Scheduled outgoings show up here with their status."
          action={
            <button type="button" onClick={() => open('payment')} className="btn-secondary btn-sm">
              Schedule a payment
            </button>
          }
        />
      ) : (
        <div className="-mx-2 sm:overflow-x-auto">
          <table className="table-stack w-full sm:min-w-[30rem]">
            <thead>
              <tr>
                <th className="t-head !px-2">Name</th>
                <th className="t-head !px-2">Due Date</th>
                <th className="t-head !px-2 text-right">Amount</th>
                <th className="t-head !px-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const status = PAYMENT_STATUS[p.status] || PAYMENT_STATUS.upcoming;
                const days = daysUntil(p.due_date);

                return (
                  <tr key={p.id} className="t-row cursor-pointer" onClick={() => navigate('/payments')}>
                    <td className="t-cell !px-2" data-primary>
                      <p className="truncate font-medium">{p.name}</p>
                      {p.contact?.name && (
                        <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">{p.contact.name}</p>
                      )}
                    </td>
                    <td className="t-cell !px-2" data-label="Due">
                      <p className="text-[13px] text-ink-dim">{formatDate(p.due_date)}</p>
                      <p
                        className={cx(
                          'mt-0.5 text-[11px]',
                          days < 0 ? 'text-negative' : days <= 3 ? 'text-warning' : 'text-ink-muted',
                        )}
                      >
                        {days < 0
                          ? `${Math.abs(days)}d overdue`
                          : days === 0
                            ? 'Today'
                            : `in ${days}d`}
                      </p>
                    </td>
                    <td className="t-cell !px-2 text-right font-semibold tnum" data-label="Amount">
                      {formatMoney(p.amount)}
                    </td>
                    <td className="t-cell !px-2 text-right" data-label="Status">
                      <Badge className={status.className} dot>
                        {status.label}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   FINANCIAL GOALS
   ══════════════════════════════════════════════════════════════════════════ */
export function GoalsPanel({ rows = [], loading }) {
  const navigate = useNavigate();
  const { open } = useModals();

  return (
    <Card className="h-full">
      <CardHeader title="Financial Goals" action={<ViewAllLink onClick={() => navigate('/goals')} />} />

      {loading ? (
        <LoadingBlock rows={2} />
      ) : !rows.length ? (
        <EmptyState
          icon={Target}
          compact
          title="No goals set"
          description="Name a target and watch the bar fill as you save."
          action={
            <button type="button" onClick={() => open('goal')} className="btn-secondary btn-sm">
              Create a goal
            </button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.slice(0, 2).map((goal) => {
            const Icon = resolveIcon(goal.icon, 'Target');
            const pct = progressOf(goal.current_amount, goal.target_amount);

            return (
              <button
                key={goal.id}
                type="button"
                onClick={() => navigate('/goals')}
                className="group rounded-2xl border border-hair bg-surface p-4 text-left transition-all duration-400 ease-premium hover:border-hair-strong hover:bg-elevated"
              >
                <div className="mb-3 flex items-start gap-3">
                  <span className="icon-tile h-10 w-10 group-hover:border-accent/30">
                    <Icon size={16} strokeWidth={1.9} className="text-ink-dim group-hover:text-accent" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-ink">{goal.name}</p>
                    <p className="mt-0.5 truncate text-[11.5px] tnum text-ink-muted">
                      {formatMoney(goal.current_amount)} / {formatMoney(goal.target_amount)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-bold tnum text-accent">{Math.round(pct)}%</span>
                </div>

                <ProgressBar value={pct} />

                {goal.target_date && (
                  <p className="mt-2.5 text-[11px] text-ink-muted">
                    Target: {formatDate(goal.target_date, { day: undefined })}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PROMOTIONAL CARD
   ══════════════════════════════════════════════════════════════════════════ */
export function PromoCard() {
  const navigate = useNavigate();

  return (
    <Card
      pad={false}
      className="group relative h-full min-h-[15rem] overflow-hidden bg-night-800"
      as="section"
    >
      {/* Abstract landscape: layered ridges under a lime horizon glow */}
      <div className="absolute inset-0" aria-hidden="true">
        <div className="absolute inset-x-0 bottom-0 h-2/3 lime-orb opacity-80" />
        <svg viewBox="0 0 400 200" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-3/4 w-full">
          <defs>
            <linearGradient id="ridge-back" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#C8FF00" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#C8FF00" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="ridge-front" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0F1214" stopOpacity="1" />
              <stop offset="100%" stopColor="#090B0D" stopOpacity="1" />
            </linearGradient>
          </defs>
          <path d="M0 130 L70 70 L120 110 L190 40 L260 105 L320 65 L400 120 L400 200 L0 200 Z" fill="url(#ridge-back)" />
          <path d="M0 160 L60 120 L130 155 L200 110 L270 150 L340 118 L400 158 L400 200 L0 200 Z" fill="url(#ridge-front)" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 h-24 opacity-40">
          <WaveViz seed={3.7} lines={5} />
        </div>
      </div>

      <div className="relative flex h-full flex-col justify-between p-6">
        <div>
          <h3 className="headline max-w-[15rem] text-[1.9rem] text-white">
            Smarter
            <br />
            Finances for a
            <br />
            <span className="text-lime">Brighter Tomorrow.</span>
          </h3>
          <p className="mt-4 text-[12.5px] tracking-[0.06em] text-white/55">Track. Plan. Grow.</p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/analytics')}
          aria-label="Open analytics"
          className="mt-6 flex h-12 w-12 items-center justify-center self-end rounded-full bg-white text-night-900 transition-all duration-400 ease-premium hover:bg-lime hover:text-black group-hover:scale-105"
        >
          <ArrowRight size={19} strokeWidth={2.2} />
        </button>
      </div>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   QUOTE / INSIGHT CARD
   ══════════════════════════════════════════════════════════════════════════ */
export function QuoteCard() {
  return (
    <Card className="relative overflow-hidden">
      <Quote
        size={44}
        className="absolute -left-1 -top-1 text-accent/15"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <div className="relative pl-2 pt-4">
        <p className="text-[16px] font-medium leading-[1.45] tracking-[-0.01em] text-ink">
          “Money is a tool.
          <br />
          A better you is the goal.”
        </p>
        <p className="mt-4 text-[11.5px] tracking-[0.04em] text-ink-muted">— {BRAND.name}</p>
      </div>
    </Card>
  );
}
