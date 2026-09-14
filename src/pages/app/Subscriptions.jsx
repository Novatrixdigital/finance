import { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Pause,
  Play,
  ExternalLink,
  CalendarClock,
  Zap,
  Ban,
} from 'lucide-react';
import { PageHeader, StatStrip } from '@/components/layout/PageHeader';
import {
  Card,
  Button,
  Badge,
  EmptyState,
  LoadingBlock,
  Segmented,
  SearchInput,
  ConfirmDialog,
  WorkspaceBadge,
} from '@/components/ui';
import { useCollection, useRpc } from '@/hooks/useCollection';
import { useModals } from '@/context/ModalContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { supabase, readableError } from '@/lib/supabase';
import { formatMoney, formatDate, daysUntil, toISODate } from '@/lib/format';
import { SUBSCRIPTION_STATUS, BILLING_CYCLES } from '@/lib/constants';
import { cx, icon as resolveIcon, sumBy, downloadCSV } from '@/lib/utils';

const TABS = [
  { id: 'active', label: 'Active' },
  { id: 'trial', label: 'Trials' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'all', label: 'All' },
];

/** Mirrors subscription_monthly_cost() so the UI can sort without a round trip. */
function monthlyCost(sub) {
  const cycle = BILLING_CYCLES.find((c) => c.id === sub.billing_cycle);
  const count = Math.max(Number(sub.cycle_count) || 1, 1);
  return (Number(sub.amount) || 0) * (cycle?.perMonth ?? 1) / count;
}

export default function Subscriptions() {
  const { open, dirtyToken } = useModals();
  const { workspaceType, isCombined, scope } = useWorkspace();
  const toast = useToast();

  const [tab, setTab] = useState('active');
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [running, setRunning] = useState(false);

  const { rows, loading, update, remove, refresh } = useCollection('subscriptions', {
    select: '*, category:categories(name, color), account:accounts(name)',
    orderBy: { column: 'next_renewal_date', ascending: true },
  });

  const scopeParam = useMemo(() => ({ p_scope: scope }), [scope]);
  const summary = useRpc('subscription_summary', scopeParam);

  useEffect(() => {
    if (dirtyToken > 0) {
      refresh();
      summary.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyToken]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((s) => {
      if (tab === 'active' && s.status !== 'active') return false;
      if (tab === 'trial' && s.status !== 'trial') return false;
      if (tab === 'inactive' && !['paused', 'cancelled', 'expired'].includes(s.status)) return false;
      if (!term) return true;
      return `${s.name} ${s.vendor || ''} ${s.plan || ''}`.toLowerCase().includes(term);
    });
  }, [rows, tab, search]);

  const stats = summary.data || {};

  const upcoming = useMemo(
    () =>
      rows
        .filter((s) => ['active', 'trial'].includes(s.status))
        .filter((s) => daysUntil(s.next_renewal_date) <= 7)
        .sort((a, b) => a.next_renewal_date.localeCompare(b.next_renewal_date)),
    [rows],
  );

  const togglePause = async (sub) => {
    const next = sub.status === 'paused' ? 'active' : 'paused';
    const { error } = await update(sub.id, { status: next });
    if (!error) {
      toast.success(next === 'paused' ? `${sub.name} paused.` : `${sub.name} resumed.`);
      summary.refresh();
    }
  };

  const cancelSub = async (sub) => {
    const { error } = await update(sub.id, { status: 'cancelled', cancelled_on: toISODate(), auto_renew: false });
    if (!error) {
      toast.success(`${sub.name} marked cancelled.`);
      summary.refresh();
    }
  };

  const runRenewals = async () => {
    setRunning(true);
    const { data, error } = await supabase.rpc('run_due_subscriptions');
    setRunning(false);
    if (error) return toast.error(readableError(error));
    const n = Number(data) || 0;
    toast.success(n ? `Rolled ${n} renewal${n === 1 ? '' : 's'} forward.` : 'Nothing is due yet.');
    refresh();
    summary.refresh();
  };

  const confirmDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    const { error } = await remove(confirm.id);
    setDeleting(false);
    if (!error) {
      toast.success('Subscription removed.');
      summary.refresh();
    }
    setConfirm(null);
  };

  const exportCsv = () => {
    if (!filtered.length) return toast.info('Nothing to export.');
    downloadCSV(
      `novatrix-subscriptions-${toISODate()}`,
      filtered.map((s) => ({
        Name: s.name,
        Provider: s.vendor || '',
        Plan: s.plan || '',
        Amount: s.amount,
        Cycle: s.billing_cycle,
        MonthlyEquivalent: Math.round(monthlyCost(s)),
        Status: s.status,
        NextRenewal: s.next_renewal_date,
        Account: s.account?.name || '',
      })),
    );
    toast.success('Subscriptions exported.');
  };

  const cycleLabel = (id) => BILLING_CYCLES.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="Every quiet"
        accent="monthly leak."
        subtitle="Streaming, insurance, the gym, SaaS — what renews, when, and what it really costs a year."
        actions={
          <>
            <Button variant="secondary" size="md" icon={Zap} onClick={runRenewals} loading={running}>
              Run renewals
            </Button>
            <Button size="md" icon={Plus} onClick={() => open('subscription')}>
              Add Subscription
            </Button>
          </>
        }
      >
        <StatStrip
          items={[
            {
              label: 'Monthly cost',
              value: formatMoney(stats.monthly_cost),
              tone: 'lime',
              meta: `${stats.active_count ?? 0} active`,
            },
            {
              label: 'Yearly cost',
              value: formatMoney(stats.yearly_cost),
              meta: 'at the current mix',
            },
            {
              label: 'Renewing in 7 days',
              value: formatMoney(stats.due_week_amount),
              tone: 'warning',
              meta: `${stats.due_week_count ?? 0} subscription${stats.due_week_count === 1 ? '' : 's'}`,
            },
            {
              label: 'Free trials',
              value: stats.trial_count ?? 0,
              tone: stats.trial_count ? 'info' : undefined,
              meta: stats.trial_count ? 'cancel before they convert' : 'none running',
            },
          ]}
        />
      </PageHeader>

      {/* Renewing this week */}
      {upcoming.length > 0 && (
        <Card className="mb-6 border-warning/25 bg-warning/[0.04]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="icon-tile h-10 w-10 shrink-0 border-warning/30 bg-warning/10">
                <CalendarClock size={17} className="text-warning" strokeWidth={1.9} />
              </span>
              <div>
                <p className="text-[14px] font-semibold text-ink">Renewing within 7 days</p>
                <p className="mt-1 text-[12.5px] text-ink-dim">
                  {upcoming.map((s) => s.name).join(' · ')}
                </p>
              </div>
            </div>
            <p className="text-[17px] font-bold tnum text-ink">
              {formatMoney(sumBy(upcoming, (s) => s.amount))}
            </p>
          </div>
        </Card>
      )}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented options={TABS} value={tab} onChange={setTab} />
        <div className="flex items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or provider…" className="sm:w-64" />
          <Button variant="ghost" size="sm" onClick={exportCsv}>
            Export
          </Button>
        </div>
      </div>

      {loading ? (
        <Card>
          <LoadingBlock rows={5} />
        </Card>
      ) : !filtered.length ? (
        <Card>
          <EmptyState
            icon={RefreshCw}
            title={rows.length ? 'Nothing in this view' : 'No subscriptions tracked'}
            description={
              rows.length
                ? 'Try another tab or clear the search.'
                : 'Add what bills you on a cycle and Novatrix will total the yearly cost and email you before each renewal.'
            }
            action={
              /* "Load examples" used to sit beside this. It called
                 seed_demo_subscriptions(), which deleted every subscription
                 the user owned before inserting its nine samples. */
              <Button size="sm" icon={Plus} onClick={() => open('subscription')}>
                Add subscription
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((sub) => {
            const Icon = resolveIcon(sub.icon, 'Repeat');
            const status = SUBSCRIPTION_STATUS[sub.status] || SUBSCRIPTION_STATUS.active;
            const days = daysUntil(sub.next_renewal_date);
            const live = ['active', 'trial'].includes(sub.status);
            const soon = live && days <= 7;

            return (
              <Card key={sub.id} hover className={cx('group', !live && 'opacity-60')}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="icon-tile h-11 w-11"
                      style={{ borderColor: `${sub.color}33`, backgroundColor: `${sub.color}14` }}
                    >
                      <Icon size={17} strokeWidth={1.9} style={{ color: sub.color }} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[14px] font-semibold text-ink">{sub.name}</p>
                        {isCombined && <WorkspaceBadge type={workspaceType(sub.workspace_id)} />}
                      </div>
                      <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                        {sub.plan || sub.vendor || cycleLabel(sub.billing_cycle)}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 reveal-actions">
                    <button
                      type="button"
                      onClick={() => open('subscription', { record: sub })}
                      aria-label="Edit subscription"
                      className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirm(sub)}
                      aria-label="Delete subscription"
                      className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-figure-sm tnum text-ink">
                      {formatMoney(sub.amount, { currency: sub.currency })}
                    </p>
                    <p className="mt-1 truncate text-[11.5px] text-ink-muted">
                      {cycleLabel(sub.billing_cycle)}
                      {sub.billing_cycle !== 'monthly' && sub.billing_cycle !== 'lifetime' && (
                        <> · {formatMoney(monthlyCost(sub), { currency: sub.currency })}/mo</>
                      )}
                    </p>
                  </div>
                  <Badge className={status.className} dot>
                    {status.label}
                  </Badge>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-hair-soft pt-4">
                  <div className="min-w-0">
                    {live ? (
                      <>
                        <p className="truncate text-[11.5px] text-ink-muted">
                          Renews {formatDate(sub.next_renewal_date)}
                        </p>
                        <p
                          className={cx(
                            'mt-0.5 text-[11px] font-medium',
                            days < 0 ? 'text-negative' : soon ? 'text-warning' : 'text-ink-muted',
                          )}
                        >
                          {days < 0
                            ? `${Math.abs(days)}d overdue`
                            : days === 0
                              ? 'Renews today'
                              : `in ${days} day${days === 1 ? '' : 's'}`}
                          {sub.status === 'trial' && sub.trial_ends_on && (
                            <> · trial ends {formatDate(sub.trial_ends_on)}</>
                          )}
                        </p>
                      </>
                    ) : (
                      <p className="text-[11.5px] text-ink-muted">
                        {sub.status === 'cancelled' && sub.cancelled_on
                          ? `Cancelled ${formatDate(sub.cancelled_on)}`
                          : status.label}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {sub.cancel_url && (
                      <a
                        href={sub.cancel_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        title="Open cancel page"
                        className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                      >
                        <ExternalLink size={13} />
                      </a>
                    )}
                    {live && (
                      <button
                        type="button"
                        onClick={() => cancelSub(sub)}
                        title="Mark cancelled"
                        className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                      >
                        <Ban size={13} />
                      </button>
                    )}
                    {sub.status !== 'cancelled' && (
                      <button
                        type="button"
                        onClick={() => togglePause(sub)}
                        className={cx(
                          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors',
                          sub.status === 'paused'
                            ? 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/20'
                            : 'border-hair text-ink-dim hover:border-warning/40 hover:text-warning',
                        )}
                      >
                        {sub.status === 'paused' ? <Play size={12} /> : <Pause size={12} />}
                        {sub.status === 'paused' ? 'Resume' : 'Pause'}
                      </button>
                    )}
                  </div>
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
        title="Delete subscription?"
        message={`"${confirm?.name}" and its pending reminders will be removed. Transactions already posted are kept.`}
      />
    </div>
  );
}
