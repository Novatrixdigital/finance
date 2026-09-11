import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Repeat, Play, Pause, Zap, RefreshCw, ArrowUpRight } from 'lucide-react';
import { PageHeader, StatStrip } from '@/components/layout/PageHeader';
import {
  Card,
  Button,
  Badge,
  EmptyState,
  LoadingBlock,
  ConfirmDialog,
  WorkspaceBadge,
} from '@/components/ui';
import { useCollection } from '@/hooks/useCollection';
import { useModals } from '@/context/ModalContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { supabase, readableError } from '@/lib/supabase';
import { formatMoney, formatDate, daysUntil } from '@/lib/format';
import { FREQUENCIES } from '@/lib/constants';
import { cx, sumBy } from '@/lib/utils';

export default function Recurring() {
  const { open, dirtyToken } = useModals();
  const navigate = useNavigate();
  const { workspaceType, isCombined } = useWorkspace();
  const toast = useToast();

  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [running, setRunning] = useState(false);

  const { rows, loading, update, remove, refresh } = useCollection('recurring_transactions', {
    select: '*, category:categories(name, color), account:accounts(name), contact:contacts(name)',
    orderBy: { column: 'next_run_date', ascending: true },
  });

  useEffect(() => {
    if (dirtyToken > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyToken]);

  const totals = useMemo(() => {
    const active = rows.filter((r) => r.is_active);
    /* Normalise every cadence to a monthly figure so the two totals compare. */
    const perMonth = (r) => {
      const amount = Number(r.amount) || 0;
      const n = Number(r.interval_count) || 1;
      switch (r.frequency) {
        case 'daily':
          return (amount * 30) / n;
        case 'weekly':
          return (amount * 4.345) / n;
        case 'biweekly':
          return (amount * 2.17) / n;
        case 'monthly':
          return amount / n;
        case 'quarterly':
          return amount / (3 * n);
        default:
          return amount / (12 * n);
      }
    };

    return {
      active: active.length,
      outflow: sumBy(active.filter((r) => r.type === 'expense'), perMonth),
      inflow: sumBy(active.filter((r) => r.type === 'income'), perMonth),
      automated: active.filter((r) => r.auto_post).length,
    };
  }, [rows]);

  const toggle = async (rule) => {
    const { error } = await update(rule.id, { is_active: !rule.is_active });
    if (!error) toast.success(rule.is_active ? `${rule.name} paused.` : `${rule.name} resumed.`);
  };

  /** Materialises every rule whose next run date has arrived. */
  const runDue = async () => {
    setRunning(true);
    const { data, error } = await supabase.rpc('run_due_recurring');
    setRunning(false);

    if (error) {
      toast.error(readableError(error));
      return;
    }
    const count = Number(data) || 0;
    toast.success(
      count ? `Posted ${count} transaction${count === 1 ? '' : 's'}.` : 'Nothing is due right now.',
    );
    refresh();
  };

  const confirmDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    const { error } = await remove(confirm.id);
    setDeleting(false);
    if (!error) toast.success('Rule removed.');
    setConfirm(null);
  };

  const freqLabel = (id) => FREQUENCIES.find((f) => f.id === id)?.label ?? id;

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="Set once."
        accent="Runs forever."
        subtitle="Rent, payroll and subscriptions posted on schedule — or queued for your approval."
        actions={
          <>
            <Button variant="secondary" size="md" icon={Zap} onClick={runDue} loading={running}>
              Run due now
            </Button>
            <Button size="md" icon={Plus} onClick={() => open('recurring')}>
              New Rule
            </Button>
          </>
        }
      >
        <StatStrip
          items={[
            { label: 'Active rules', value: totals.active },
            { label: 'Monthly outflow', value: formatMoney(totals.outflow), tone: 'negative' },
            { label: 'Monthly inflow', value: formatMoney(totals.inflow), tone: 'lime' },
            { label: 'Auto-posting', value: totals.automated, meta: 'no approval needed' },
          ]}
        />
      </PageHeader>

      {loading ? (
        <Card>
          <LoadingBlock rows={5} />
        </Card>
      ) : !rows.length ? (
        <Card>
          <EmptyState
            icon={Repeat}
            title="No recurring rules"
            description="Anything that repeats — rent, salaries, SaaS — belongs here so you never key it in twice."
            action={
              <Button size="sm" icon={Plus} onClick={() => open('recurring')}>
                Create your first rule
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((rule) => {
            const income = rule.type === 'income';
            const days = daysUntil(rule.next_run_date);
            const due = days <= 0 && rule.is_active;
            // Rows mirrored from a subscription are read-only here: the
            // subscription owns the schedule AND the ledger posting, so
            // editing the copy would only ever drift out of step with it.
            const fromSub = Boolean(rule.subscription_id);

            return (
              <Card
                key={rule.id}
                hover
                className={cx('group', !rule.is_active && 'opacity-55')}
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cx(
                        'icon-tile h-11 w-11',
                        income ? 'border-accent/25 bg-accent/10 text-accent' : 'text-ink-dim',
                      )}
                    >
                      <Repeat size={16} strokeWidth={1.9} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[14px] font-semibold text-ink">{rule.name}</p>
                        {isCombined && <WorkspaceBadge type={workspaceType(rule.workspace_id)} />}
                      </div>
                      <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-ink-muted">
                        {fromSub && (
                          <RefreshCw size={11} className="shrink-0 text-accent" aria-hidden="true" />
                        )}
                        <span className="truncate">
                          {fromSub ? 'From subscription · ' : ''}
                          {freqLabel(rule.frequency)}
                          {rule.category?.name ? ` · ${rule.category.name}` : ''}
                        </span>
                      </p>
                    </div>
                  </div>

                  {fromSub ? (
                    <button
                      type="button"
                      onClick={() => navigate('/subscriptions')}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-hair px-2.5 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:border-accent/35 hover:text-accent"
                    >
                      Manage
                      <ArrowUpRight size={11} />
                    </button>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => open('recurring', { record: rule })}
                        aria-label="Edit rule"
                        className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirm(rule)}
                        aria-label="Delete rule"
                        className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                <p className={cx('text-figure-sm tnum', income ? 'text-accent' : 'text-ink')}>
                  {income ? '+ ' : '− '}
                  {formatMoney(rule.amount)}
                </p>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-hair-soft pt-4">
                  <div className="min-w-0">
                    <p className="truncate text-[11.5px] text-ink-muted">
                      Next: {formatDate(rule.next_run_date)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {due && <Badge tone="warning">Due now</Badge>}
                      {rule.auto_post && <Badge tone="lime">Auto</Badge>}
                      {!rule.is_active && <Badge tone="neutral">Paused</Badge>}
                    </div>
                  </div>

                  {/* A mirror has no pause of its own — pausing the
                      subscription is what stops it, and offering a second
                      switch here would just let the two disagree. */}
                  {!fromSub && (
                    <button
                      type="button"
                      onClick={() => toggle(rule)}
                      aria-label={rule.is_active ? 'Pause rule' : 'Resume rule'}
                      className={cx(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors',
                        rule.is_active
                          ? 'border-hair text-ink-dim hover:border-warning/40 hover:text-warning'
                          : 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/20',
                      )}
                    >
                      {rule.is_active ? <Pause size={12} /> : <Play size={12} />}
                      {rule.is_active ? 'Pause' : 'Resume'}
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete recurring rule?"
        message={`"${confirm?.name}" will stop generating transactions. Entries already posted are kept.`}
      />
    </div>
  );
}
