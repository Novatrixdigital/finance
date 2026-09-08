import { useState, useMemo, useEffect } from 'react';
import { Plus, Pencil, Trash2, PieChart, AlertTriangle } from 'lucide-react';
import { PageHeader, StatStrip } from '@/components/layout/PageHeader';
import { Card, Button, Badge, EmptyState, LoadingBlock, ConfirmDialog } from '@/components/ui';
import { useCollection, useRpc } from '@/hooks/useCollection';
import { useModals } from '@/context/ModalContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { formatMoney } from '@/lib/format';
import { cx, sumBy } from '@/lib/utils';

export default function Budgets() {
  const { open, dirtyToken } = useModals();
  const { scope } = useWorkspace();
  const toast = useToast();

  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const scopeParam = useMemo(() => ({ p_scope: scope }), [scope]);
  const progress = useRpc('budget_progress', scopeParam);
  const { rows, remove, refresh } = useCollection('budgets', { select: '*' });

  useEffect(() => {
    if (dirtyToken > 0) {
      refresh();
      progress.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyToken]);

  const budgets = useMemo(() => progress.data || [], [progress.data]);

  const totals = useMemo(
    () => ({
      allocated: sumBy(budgets, (b) => b.amount),
      spent: sumBy(budgets, (b) => b.spent),
      remaining: sumBy(budgets, (b) => b.remaining),
      breached: budgets.filter((b) => Number(b.percentage) >= 100).length,
    }),
    [budgets],
  );

  const confirmDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    const { error } = await remove(confirm.id);
    setDeleting(false);
    if (!error) {
      toast.success('Budget removed.');
      progress.refresh();
    }
    setConfirm(null);
  };

  const toneFor = (pct) => (pct >= 100 ? 'negative' : pct >= 80 ? 'warning' : 'lime');

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="Spend with"
        accent="intent."
        subtitle="Set a ceiling per category and see exactly how much room is left."
        actions={
          <Button size="md" icon={Plus} onClick={() => open('budget')}>
            New Budget
          </Button>
        }
      >
        <StatStrip
          items={[
            { label: 'Allocated', value: formatMoney(totals.allocated) },
            { label: 'Spent', value: formatMoney(totals.spent), tone: 'warning' },
            { label: 'Remaining', value: formatMoney(totals.remaining), tone: 'lime' },
            {
              label: 'Over limit',
              value: totals.breached,
              tone: totals.breached ? 'negative' : undefined,
              meta: totals.breached ? 'needs attention' : 'all within limits',
            },
          ]}
        />
      </PageHeader>

      {progress.loading ? (
        <Card>
          <LoadingBlock rows={4} />
        </Card>
      ) : !budgets.length ? (
        <Card>
          <EmptyState
            icon={PieChart}
            title="No budgets yet"
            description="Cap a category — marketing, travel, dining — and Novatrix will warn you before you cross it."
            action={
              <Button size="sm" icon={Plus} onClick={() => open('budget')}>
                Create your first budget
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {budgets.map((b) => {
            const pct = Number(b.percentage) || 0;
            const tone = toneFor(pct);
            const record = rows.find((r) => r.id === b.id);

            return (
              <Card key={b.id} hover className="group">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="icon-tile h-11 w-11"
                      style={{
                        borderColor: `${b.category_color}33`,
                        backgroundColor: `${b.category_color}14`,
                      }}
                    >
                      <PieChart size={16} strokeWidth={1.9} style={{ color: b.category_color }} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-ink">{b.name}</p>
                      <p className="mt-0.5 truncate text-[11.5px] capitalize text-ink-muted">
                        {b.category_name} · {b.period}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => record && open('budget', { record })}
                      aria-label="Edit budget"
                      className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirm(b)}
                      aria-label="Delete budget"
                      className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-figure-sm tnum text-ink">{formatMoney(b.spent)}</p>
                    <p className="mt-1 text-[11.5px] tnum text-ink-muted">of {formatMoney(b.amount)}</p>
                  </div>
                  <p
                    className={cx(
                      'text-[20px] font-bold tnum',
                      tone === 'negative' ? 'text-negative' : tone === 'warning' ? 'text-warning' : 'text-accent',
                    )}
                  >
                    {Math.round(pct)}%
                  </p>
                </div>

                {/* Track with the alert threshold marked */}
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-hair">
                  <div
                    className={cx(
                      'h-full rounded-full transition-all duration-700 ease-premium',
                      tone === 'negative' ? 'bg-negative' : tone === 'warning' ? 'bg-warning' : 'bg-lime',
                    )}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                  <span
                    className="absolute top-0 h-full w-px bg-ink/30"
                    style={{ left: `${b.alert_threshold}%` }}
                    aria-hidden="true"
                  />
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-hair-soft pt-4">
                  <p className="text-[12px] text-ink-muted">
                    {Number(b.remaining) > 0 ? (
                      <>
                        <span className="tnum text-ink-dim">{formatMoney(b.remaining)}</span> left
                      </>
                    ) : (
                      <span className="text-negative">
                        Over by {formatMoney(Number(b.spent) - Number(b.amount))}
                      </span>
                    )}
                  </p>

                  {pct >= b.alert_threshold && (
                    <Badge tone={tone === 'negative' ? 'negative' : 'warning'}>
                      <AlertTriangle size={11} />
                      {pct >= 100 ? 'Exceeded' : 'Near limit'}
                    </Badge>
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
        title="Delete budget?"
        message={`"${confirm?.name}" will stop tracking. Your transactions are not affected.`}
      />
    </div>
  );
}
