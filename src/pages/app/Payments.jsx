import { useState, useMemo, useEffect } from 'react';
import { Plus, Check, Pencil, Trash2, CalendarClock, Download } from 'lucide-react';
import { PageHeader, StatStrip } from '@/components/layout/PageHeader';
import {
  Card,
  Button,
  Badge,
  EmptyState,
  LoadingBlock,
  Segmented,
  ConfirmDialog,
  WorkspaceBadge,
} from '@/components/ui';
import { useCollection } from '@/hooks/useCollection';
import { useModals } from '@/context/ModalContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { formatMoney, formatDate, daysUntil, toISODate } from '@/lib/format';
import { PAYMENT_STATUS } from '@/lib/constants';
import { cx, sumBy, downloadCSV } from '@/lib/utils';

/**
 * Whether a payment has fallen overdue, as of right now.
 *
 * The database derives this too, but only on write — payments_derive_status is
 * a BEFORE trigger, so a row due yesterday keeps saying "Upcoming" until
 * something happens to touch it. Reading the calendar here keeps the badge
 * honest without rewriting rows just to change how they look.
 */
function effectiveStatus(payment) {
  if (payment.status === 'upcoming' || payment.status === 'pending') {
    if (daysUntil(payment.due_date) < 0) return 'overdue';
  }
  return payment.status;
}

const TABS = [
  { id: 'outgoing', label: 'Outgoing' },
  { id: 'incoming', label: 'Incoming' },
  { id: 'all', label: 'All' },
];

export default function Payments() {
  const { open, dirtyToken } = useModals();
  const { workspaceType, isCombined } = useWorkspace();
  const toast = useToast();

  const [tab, setTab] = useState('outgoing');
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const { rows, loading, update, remove, refresh } = useCollection('payments', {
    select: '*, contact:contacts(name), account:accounts(name)',
    orderBy: { column: 'due_date', ascending: true },
  });

  useEffect(() => {
    if (dirtyToken > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyToken]);

  const filtered = useMemo(
    () => (tab === 'all' ? rows : rows.filter((p) => p.direction === tab)),
    [rows, tab],
  );

  const totals = useMemo(() => {
    const pending = filtered.filter((p) => ['upcoming', 'pending', 'overdue'].includes(p.status));
    return {
      due: sumBy(pending, (p) => p.amount),
      count: pending.length,
      overdue: sumBy(
        filtered.filter((p) => effectiveStatus(p) === 'overdue'),
        (p) => p.amount,
      ),
      paid: sumBy(filtered.filter((p) => p.status === 'paid'), (p) => p.amount),
    };
  }, [filtered]);

  /*
   * Settling a payment now posts a ledger entry and moves the account
   * balance — the payments_post_to_ledger trigger does it. Before that this
   * only changed a badge, so money marked paid never actually left an
   * account and never showed up in the month's spend.
   */
  const markPaid = async (payment) => {
    const { error } = await update(payment.id, { status: 'paid', paid_date: toISODate() });
    if (error) return;

    toast.success(
      payment.account_id
        ? `${payment.name} marked paid — ${payment.account?.name || 'the account'} updated.`
        : `${payment.name} marked as paid. Add an account to it if you want the balance to move.`,
    );
    refresh();
  };

  const confirmDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    const { error } = await remove(confirm.id);
    setDeleting(false);
    if (!error) toast.success('Payment removed.');
    setConfirm(null);
  };

  const exportCsv = () => {
    if (!filtered.length) return toast.info('Nothing to export.');
    downloadCSV(
      `novatrix-payments-${toISODate()}`,
      filtered.map((p) => ({
        Name: p.name,
        Direction: p.direction,
        Amount: p.amount,
        Due: p.due_date,
        Status: p.status,
        Contact: p.contact?.name || '',
        Account: p.account?.name || '',
        Method: p.method || '',
      })),
    );
    toast.success('Payments exported.');
  };

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="Nothing slips"
        accent="past due."
        subtitle="Everything scheduled to leave or arrive, ranked by urgency."
        actions={
          <>
            <Button variant="secondary" size="md" icon={Download} onClick={exportCsv}>
              Export
            </Button>
            <Button size="md" icon={Plus} onClick={() => open('payment')}>
              Record Payment
            </Button>
          </>
        }
      >
        <StatStrip
          items={[
            { label: 'Due', value: formatMoney(totals.due), meta: `${totals.count} scheduled` },
            { label: 'Overdue', value: formatMoney(totals.overdue), tone: 'negative' },
            { label: 'Settled', value: formatMoney(totals.paid), tone: 'lime' },
            { label: 'Total records', value: filtered.length },
          ]}
        />
      </PageHeader>

      <div className="mb-6">
        <Segmented options={TABS} value={tab} onChange={setTab} />
      </div>

      <Card pad={false} className="overflow-hidden">
        {loading ? (
          <div className="p-6">
            <LoadingBlock rows={6} />
          </div>
        ) : !filtered.length ? (
          <div className="p-6">
            <EmptyState
              icon={CalendarClock}
              title="No payments here"
              description="Schedule rent, salaries, vendors or subscriptions and they will queue up in this list."
              action={
                <Button size="sm" icon={Plus} onClick={() => open('payment')}>
                  Record a payment
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem]">
              <thead className="bg-surface/50">
                <tr>
                  <th className="t-head">Name</th>
                  <th className="t-head">Contact</th>
                  <th className="t-head">Due Date</th>
                  <th className="t-head text-right">Amount</th>
                  <th className="t-head">Status</th>
                  <th className="t-head text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const shown = effectiveStatus(p);
                  const status = PAYMENT_STATUS[shown] || PAYMENT_STATUS.upcoming;
                  const days = daysUntil(p.due_date);
                  const settled = p.status === 'paid' || p.status === 'cancelled';

                  return (
                    <tr key={p.id} className="t-row group">
                      <td className="t-cell">
                        <div className="flex items-center gap-2">
                          <span
                            className={cx(
                              'h-8 w-1 shrink-0 rounded-full',
                              shown === 'overdue'
                                ? 'bg-negative'
                                : shown === 'paid'
                                  ? 'bg-lime'
                                  : shown === 'pending'
                                    ? 'bg-negative/60'
                                    : 'bg-warning',
                            )}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-medium">{p.name}</p>
                              {isCombined && <WorkspaceBadge type={workspaceType(p.workspace_id)} />}
                            </div>
                            <p className="mt-0.5 text-[11.5px] text-ink-muted">
                              {p.direction === 'incoming' ? 'Incoming' : 'Outgoing'}
                              {p.method ? ` · ${p.method}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="t-cell text-[13px] text-ink-dim">{p.contact?.name || '—'}</td>

                      <td className="t-cell">
                        <p className="text-[13px] text-ink-dim">{formatDate(p.due_date)}</p>
                        {!settled && (
                          <p
                            className={cx(
                              'mt-0.5 text-[11px]',
                              days < 0 ? 'text-negative' : days <= 3 ? 'text-warning' : 'text-ink-muted',
                            )}
                          >
                            {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `in ${days}d`}
                          </p>
                        )}
                      </td>

                      <td
                        className={cx(
                          't-cell text-right font-semibold tnum',
                          p.direction === 'incoming' ? 'text-accent' : 'text-ink',
                        )}
                      >
                        {p.direction === 'incoming' ? '+ ' : '− '}
                        {formatMoney(p.amount)}
                      </td>

                      <td className="t-cell">
                        <Badge className={status.className} dot>
                          {status.label}
                        </Badge>
                      </td>

                      <td className="t-cell text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!settled && (
                            <button
                              type="button"
                              onClick={() => markPaid(p)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/20"
                            >
                              <Check size={12} strokeWidth={2.6} />
                              Mark paid
                            </button>
                          )}
                          <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={() => open('payment', { record: p })}
                              aria-label="Edit payment"
                              className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirm(p)}
                              aria-label="Delete payment"
                              className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete payment?"
        message={`"${confirm?.name}" will be removed from your schedule.`}
      />
    </div>
  );
}
