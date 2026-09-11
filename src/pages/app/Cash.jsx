import { useState, useMemo, useEffect } from 'react';
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Plus,
  Download,
  AlertTriangle,
  Banknote,
} from 'lucide-react';
import { PageHeader, StatStrip } from '@/components/layout/PageHeader';
import {
  Card,
  CardHeader,
  Button,
  Badge,
  EmptyState,
  LoadingBlock,
  Segmented,
  WorkspaceBadge,
} from '@/components/ui';
import { useCash } from '@/hooks/useCash';
import { useModals } from '@/context/ModalContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { formatMoney, formatDate, toISODate, startOfMonthISO } from '@/lib/format';
import { cx, downloadCSV } from '@/lib/utils';

const RANGES = [
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: '3 months' },
  { id: 'year', label: '12 months' },
  { id: 'all', label: 'All time' },
];

/** Start date for each range. `null` means "no lower bound". */
function rangeStart(id) {
  if (id === 'all') return null;
  if (id === 'month') return startOfMonthISO();
  const d = new Date();
  d.setMonth(d.getMonth() - (id === 'quarter' ? 3 : 12));
  return toISODate(d);
}

/* ── One cash account ────────────────────────────────────────────────────── */
function CashCard({ account, onWithdraw, onSpend, showWorkspace, workspaceType }) {
  const balance = Number(account.current_balance);
  const empty = balance <= 0;

  return (
    <Card hover className="group">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="icon-tile h-11 w-11 border-accent/25 bg-accent/[0.08]">
            <Wallet size={17} strokeWidth={1.9} className="text-accent" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-ink">{account.name}</p>
            <p className="mt-0.5 text-[11.5px] text-ink-muted">Physical money</p>
          </div>
        </div>
        {(showWorkspace || account.workspace_id === null) && (
          <WorkspaceBadge type={workspaceType(account.workspace_id)} />
        )}
      </div>

      <p className="eyebrow mb-1.5">In hand</p>
      <p className={cx('truncate text-figure-md tnum', empty ? 'text-ink-dim' : 'text-ink')}>
        {formatMoney(balance, { currency: account.currency })}
      </p>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-hair-soft pt-4">
        <button
          type="button"
          onClick={() => onWithdraw(account)}
          className="inline-flex items-center gap-1.5 rounded-full border border-hair bg-surface px-3 py-1.5 text-[11.5px] font-medium text-ink-dim transition-colors hover:border-accent/40 hover:text-accent"
        >
          <ArrowDownLeft size={12} />
          Withdraw
        </button>
        <button
          type="button"
          onClick={() => onSpend(account)}
          className="inline-flex items-center gap-1.5 rounded-full border border-hair bg-surface px-3 py-1.5 text-[11.5px] font-medium text-ink-dim transition-colors hover:border-accent/40 hover:text-accent"
        >
          <ArrowUpRight size={12} />
          Spend
        </button>
      </div>
    </Card>
  );
}

/* ── One row of the history ──────────────────────────────────────────────── */
function ActivityRow({ row, showWorkspace, workspaceType }) {
  const out = row.flow === 'out';
  const Icon = row.type === 'transfer' ? ArrowLeftRight : out ? ArrowUpRight : ArrowDownLeft;

  return (
    <div className="flex items-center gap-3 border-b border-hair-soft px-1 py-3.5 last:border-0">
      <span
        className={cx(
          'icon-tile h-9 w-9 shrink-0',
          out ? 'border-negative/20 bg-negative/[0.07]' : 'border-accent/25 bg-accent/[0.08]',
        )}
      >
        <Icon size={14} strokeWidth={1.9} className={out ? 'text-negative' : 'text-accent'} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13.5px] font-medium text-ink">{row.description || '—'}</p>
          {!row.on_cash_account && (
            <Badge tone="warning" className="shrink-0">
              Not from cash
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
          {formatDate(row.txn_date)}
          {row.category_name ? ` · ${row.category_name}` : ''}
          {row.account_name ? ` · ${row.account_name}` : ''}
        </p>
      </div>

      {showWorkspace && (
        <WorkspaceBadge type={workspaceType(row.workspace_id)} />
      )}

      <p
        className={cx(
          'shrink-0 text-[14px] font-semibold tnum',
          out ? 'text-negative' : 'text-accent',
        )}
      >
        {out ? '−' : '+'}
        {formatMoney(row.amount)}
      </p>
    </div>
  );
}

/**
 * Cash in hand.
 *
 * The bank half of the app has always worked; this is the other half. Cash
 * accounts ride the same ledger as everything else, so a cash expense both
 * lowers what is in your hand and counts in the month's spend — the point of
 * "noted in both". Withdrawals are transfers, so bank and cash move together
 * in a single entry.
 */
export default function Cash() {
  const { open, dirtyToken } = useModals();
  const { workspaceType, isCombined } = useWorkspace();
  const toast = useToast();

  const [range, setRange] = useState('month');
  const [flow, setFlow] = useState('all');

  const from = useMemo(() => rangeStart(range), [range]);
  const { stats, rows, cashAccounts, bankAccounts, loading, refreshAll } = useCash({
    from,
    limit: 400,
  });

  useEffect(() => {
    if (dirtyToken > 0) refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyToken]);

  const filtered = useMemo(
    () => (flow === 'all' ? rows : rows.filter((r) => r.flow === flow)),
    [rows, flow],
  );

  const periodTotals = useMemo(() => {
    let out = 0;
    let inn = 0;
    rows.forEach((r) => {
      if (r.flow === 'out') out += Number(r.amount) || 0;
      else inn += Number(r.amount) || 0;
    });
    return { out, in: inn };
  }, [rows]);

  /* ── Actions ───────────────────────────────────────────────────────────
     Both open the ordinary transaction form with the sides pre-chosen, so
     every balance trigger, budget and report treats them like any other
     entry. Nothing about cash is a special case downstream. */

  const withdrawTo = (cashAccount) => {
    const source = bankAccounts.find((a) => a.workspace_id === cashAccount.workspace_id);
    if (!source) {
      toast.info('Add a bank account first — a withdrawal needs somewhere to come from.');
      return;
    }
    open('transaction', {
      defaultType: 'transfer',
      preset: {
        type: 'transfer',
        workspace_id: cashAccount.workspace_id,
        account_id: source.id,
        to_account_id: cashAccount.id,
        description: 'Cash withdrawal',
        payment_method: 'Cash',
      },
    });
  };

  const depositFrom = (cashAccount) => {
    const target = bankAccounts.find((a) => a.workspace_id === cashAccount.workspace_id);
    if (!target) {
      toast.info('Add a bank account first — a deposit needs somewhere to go.');
      return;
    }
    open('transaction', {
      defaultType: 'transfer',
      preset: {
        type: 'transfer',
        workspace_id: cashAccount.workspace_id,
        account_id: cashAccount.id,
        to_account_id: target.id,
        description: 'Cash deposited to bank',
        payment_method: 'Cash',
      },
    });
  };

  const spendFrom = (cashAccount) =>
    open('transaction', {
      defaultType: 'expense',
      preset: {
        type: 'expense',
        workspace_id: cashAccount.workspace_id,
        account_id: cashAccount.id,
        payment_method: 'Cash',
      },
    });

  const exportCsv = () => {
    if (!filtered.length) return toast.info('Nothing to export.');
    downloadCSV(
      `novatrix-cash-${toISODate()}`,
      filtered.map((r) => ({
        Date: r.txn_date,
        Description: r.description,
        Flow: r.flow === 'out' ? 'Out' : 'In',
        Amount: r.amount,
        Category: r.category_name || '',
        Account: r.account_name || '',
        Method: r.payment_method || '',
        FromCashAccount: r.on_cash_account ? 'Yes' : 'No',
      })),
    );
    toast.success('Cash history exported.');
  };

  const primaryCash = cashAccounts[0] || null;

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="What's actually"
        accent="in your hand."
        subtitle="Notes and coins tracked the same way as the bank — spend it and both your cash and your monthly total move together."
        actions={
          <>
            <Button variant="secondary" size="md" icon={Download} onClick={exportCsv}>
              Export
            </Button>
            {primaryCash ? (
              <Button size="md" icon={Plus} onClick={() => spendFrom(primaryCash)}>
                Record Cash Spend
              </Button>
            ) : (
              <Button size="md" icon={Plus} onClick={() => open('account')}>
                Add Cash Account
              </Button>
            )}
          </>
        }
      >
        <StatStrip
          items={[
            { label: 'Cash in hand', value: formatMoney(stats.inHand), tone: 'lime' },
            { label: 'Spent this month', value: formatMoney(stats.spentMonth), tone: 'negative' },
            { label: 'Taken out this month', value: formatMoney(stats.receivedMonth) },
            {
              label: 'Spent all time',
              value: formatMoney(stats.spentTotal),
              meta: stats.lastMovement ? `Last moved ${formatDate(stats.lastMovement)}` : 'No movement yet',
            },
          ]}
        />
      </PageHeader>

      {/* ── Historical cash spends booked elsewhere ─────────────────────────
          Surfaced rather than corrected: rewriting entries you already made
          would move balances behind your back. */}
      {stats.untrackedCount > 0 && (
        <Card className="mb-6 border-warning/30 bg-warning/[0.04]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3.5">
              <span className="icon-tile h-10 w-10 shrink-0 border-warning/30 bg-warning/10">
                <AlertTriangle size={17} strokeWidth={1.9} className="text-warning" />
              </span>
              <div>
                <p className="text-[14px] font-semibold text-ink">
                  {stats.untrackedCount} older cash {stats.untrackedCount === 1 ? 'spend is' : 'spends are'}{' '}
                  booked to a bank or card
                </p>
                <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink-dim">
                  {formatMoney(stats.untrackedAmount)} marked paid in cash but recorded against
                  another account, so it counted as spending without ever leaving your hand. They
                  are listed below, tagged{' '}
                  <span className="font-medium text-warning">Not from cash</span>. Open one and
                  switch its account to fix it — nothing was changed for you.
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── Cash accounts ──────────────────────────────────────────────── */}
      {loading && !cashAccounts.length ? (
        <Card className="mb-6">
          <LoadingBlock rows={2} />
        </Card>
      ) : !cashAccounts.length ? (
        <Card className="mb-6">
          <EmptyState
            icon={Banknote}
            title="No cash account yet"
            description="Add an account of type Cash and set its opening balance to whatever you are carrying. Every cash entry after that keeps it current."
            action={
              <Button size="sm" icon={Plus} onClick={() => open('account')}>
                Add a cash account
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="stagger mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cashAccounts.map((account) => (
            <CashCard
              key={account.id}
              account={account}
              onWithdraw={withdrawTo}
              onSpend={spendFrom}
              showWorkspace={isCombined}
              workspaceType={workspaceType}
            />
          ))}

          {/* Move money the other way. */}
          {primaryCash && (
            <Card className="flex flex-col justify-center border-dashed">
              <p className="eyebrow mb-3">Move money</p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => withdrawTo(primaryCash)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-hair bg-surface px-4 py-3 text-left transition-colors hover:border-accent/40"
                >
                  <ArrowDownLeft size={15} className="shrink-0 text-accent" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">Bank → Cash</span>
                    <span className="block text-[11.5px] text-ink-muted">Withdrawal</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => depositFrom(primaryCash)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-hair bg-surface px-4 py-3 text-left transition-colors hover:border-accent/40"
                >
                  <ArrowUpRight size={15} className="shrink-0 text-ink-dim" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">Cash → Bank</span>
                    <span className="block text-[11.5px] text-ink-muted">Deposit</span>
                  </span>
                </button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── History ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Cash history"
          subtitle={
            filtered.length
              ? `${formatMoney(periodTotals.out)} out · ${formatMoney(periodTotals.in)} in`
              : 'Every note that moved, oldest entries included.'
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                size="sm"
                options={[
                  { id: 'all', label: 'All' },
                  { id: 'out', label: 'Out' },
                  { id: 'in', label: 'In' },
                ]}
                value={flow}
                onChange={setFlow}
              />
              <Segmented size="sm" options={RANGES} value={range} onChange={setRange} />
            </div>
          }
        />

        {loading ? (
          <LoadingBlock rows={5} />
        ) : !filtered.length ? (
          <EmptyState
            compact
            icon={Wallet}
            title="Nothing in this range"
            description={
              rows.length
                ? 'Try a wider range or a different direction.'
                : 'Record a cash spend and it will appear here.'
            }
          />
        ) : (
          <div>
            {filtered.map((row) => (
              <ActivityRow
                key={`${row.id}-${row.flow}`}
                row={row}
                showWorkspace={isCombined}
                workspaceType={workspaceType}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
