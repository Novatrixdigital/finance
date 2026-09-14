import { useState, useMemo, useEffect } from 'react';
import { Plus, Pencil, Trash2, Target, TrendingUp, CalendarDays } from 'lucide-react';
import { PageHeader, StatStrip } from '@/components/layout/PageHeader';
import {
  Card,
  Button,
  Badge,
  EmptyState,
  LoadingBlock,
  ConfirmDialog,
  Modal,
  Input,
  WorkspaceBadge,
} from '@/components/ui';
import { useCollection } from '@/hooks/useCollection';
import { useModals } from '@/context/ModalContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { formatMoney, formatDate, daysUntil } from '@/lib/format';
import { GOAL_STATUS } from '@/lib/constants';
import { cx, icon as resolveIcon, progressOf, sumBy } from '@/lib/utils';

/* ── Quick "add to savings" dialog ───────────────────────────────────────── */
function ContributeDialog({ goal, onClose, onSaved }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset between goals so a previous entry never carries over.
  useEffect(() => setAmount(''), [goal?.id]);
  const { update } = useCollection('financial_goals', { select: '*', enabled: false });
  const toast = useToast();

  const submit = async () => {
    const value = Number(amount);
    if (!value || value <= 0) return;

    setBusy(true);
    const next = Number(goal.current_amount) + value;
    const { error } = await update(goal.id, { current_amount: next });
    setBusy(false);

    if (!error) {
      toast.success(`${formatMoney(value)} added to ${goal.name}.`);
      onSaved();
      onClose();
    }
  };

  return (
    <Modal
      open={Boolean(goal)}
      onClose={onClose}
      title="Add to goal"
      subtitle={goal ? `${goal.name} — ${formatMoney(goal.current_amount)} of ${formatMoney(goal.target_amount)}` : ''}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={busy}>
            Add contribution
          </Button>
        </>
      }
    >
      <Input
        label="Amount"
        type="number"
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="25000"
        autoFocus
      />
    </Modal>
  );
}

export default function Goals() {
  const { open, dirtyToken } = useModals();
  const { workspaceType, isCombined } = useWorkspace();
  const toast = useToast();

  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [contributing, setContributing] = useState(null);

  const { rows, loading, remove, refresh } = useCollection('financial_goals', {
    select: '*',
    orderBy: { column: 'created_at', ascending: true },
  });

  useEffect(() => {
    if (dirtyToken > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyToken]);

  const totals = useMemo(() => {
    const active = rows.filter((g) => g.status === 'active');
    const target = sumBy(rows, (g) => g.target_amount);
    const saved = sumBy(rows, (g) => g.current_amount);
    return {
      target,
      saved,
      remaining: Math.max(target - saved, 0),
      achieved: rows.filter((g) => g.status === 'achieved').length,
      activeCount: active.length,
    };
  }, [rows]);

  const confirmDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    const { error } = await remove(confirm.id);
    setDeleting(false);
    if (!error) toast.success('Goal removed.');
    setConfirm(null);
  };

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="Name it."
        accent="Then reach it."
        subtitle="Targets you are actually saving towards, with the gap made obvious."
        actions={
          <Button size="md" icon={Plus} onClick={() => open('goal')}>
            New Goal
          </Button>
        }
      >
        <StatStrip
          items={[
            { label: 'Active goals', value: totals.activeCount },
            { label: 'Saved', value: formatMoney(totals.saved), tone: 'lime' },
            { label: 'Still to go', value: formatMoney(totals.remaining) },
            { label: 'Achieved', value: totals.achieved, tone: totals.achieved ? 'lime' : undefined },
          ]}
        />
      </PageHeader>

      {loading ? (
        <Card>
          <LoadingBlock rows={3} />
        </Card>
      ) : !rows.length ? (
        <Card>
          <EmptyState
            icon={Target}
            title="No goals yet"
            description="A car, a bigger studio, six months of runway — name the number and start closing the gap."
            action={
              <Button size="sm" icon={Plus} onClick={() => open('goal')}>
                Create your first goal
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((goal) => {
            const Icon = resolveIcon(goal.icon, 'Target');
            const pct = progressOf(goal.current_amount, goal.target_amount);
            const remaining = Math.max(Number(goal.target_amount) - Number(goal.current_amount), 0);
            const status = GOAL_STATUS[goal.status] || GOAL_STATUS.active;
            const days = goal.target_date ? daysUntil(goal.target_date) : null;
            const done = pct >= 100;

            return (
              <Card key={goal.id} hover className="group relative overflow-hidden">
                {done && <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 lime-orb" />}

                <div className="relative">
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="icon-tile h-11 w-11"
                        style={{ borderColor: `${goal.color}33`, backgroundColor: `${goal.color}14` }}
                      >
                        <Icon size={17} strokeWidth={1.9} style={{ color: goal.color }} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[14px] font-semibold text-ink">{goal.name}</p>
                          {isCombined && <WorkspaceBadge type={workspaceType(goal.workspace_id)} />}
                        </div>
                        <Badge className={cx('mt-1', status.className)}>{status.label}</Badge>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 reveal-actions">
                      <button
                        type="button"
                        onClick={() => open('goal', { record: goal })}
                        aria-label="Edit goal"
                        className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirm(goal)}
                        aria-label="Delete goal"
                        className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-figure-sm tnum text-ink">
                        {formatMoney(goal.current_amount)}
                      </p>
                      <p className="mt-1 truncate text-[11.5px] tnum text-ink-muted">
                        of {formatMoney(goal.target_amount)}
                      </p>
                    </div>
                    <p className="shrink-0 text-[22px] font-bold tnum text-accent">{Math.round(pct)}%</p>
                  </div>

                  <div className="h-2 w-full overflow-hidden rounded-full bg-hair">
                    <div
                      className="h-full rounded-full bg-lime transition-all duration-700 ease-premium"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-hair-soft pt-4">
                    <div className="min-w-0">
                      {goal.target_date && (
                        <p className="flex items-center gap-1.5 truncate text-[11.5px] text-ink-muted">
                          <CalendarDays size={12} />
                          {formatDate(goal.target_date)}
                          {days !== null && days > 0 && ` · ${days}d left`}
                        </p>
                      )}
                      {!done && (
                        <p className="mt-0.5 truncate text-[11.5px] tnum text-ink-muted">
                          {formatMoney(remaining)} to go
                        </p>
                      )}
                    </div>

                    {!done && (
                      <button
                        type="button"
                        onClick={() => setContributing(goal)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/20"
                      >
                        <TrendingUp size={12} /> Add
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ContributeDialog
        goal={contributing}
        onClose={() => setContributing(null)}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete goal?"
        message={`"${confirm?.name}" will be removed. Your savings are not affected.`}
      />
    </div>
  );
}
