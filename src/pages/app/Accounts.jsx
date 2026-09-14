import { useState, useMemo, useEffect } from 'react';
import { Plus, Pencil, Trash2, Landmark, Star, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { PageHeader, StatStrip } from '@/components/layout/PageHeader';
import { Card, Button, Badge, EmptyState, LoadingBlock, ConfirmDialog, WorkspaceBadge } from '@/components/ui';
import { useCollection } from '@/hooks/useCollection';
import { useModals } from '@/context/ModalContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { formatMoney } from '@/lib/format';
import { ACCOUNT_TYPES } from '@/lib/constants';
import { cx, icon as resolveIcon, sumBy } from '@/lib/utils';

export default function Accounts() {
  const { open, dirtyToken } = useModals();
  const { workspaceType, isCombined } = useWorkspace();
  const toast = useToast();

  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const { rows, loading, remove, refresh } = useCollection('accounts', {
    select: '*',
    orderBy: { column: 'is_primary', ascending: false },
    // Accounts marked "use in both" carry a NULL workspace and belong on this
    // list whichever side you are viewing.
    includeShared: true,
  });

  useEffect(() => {
    if (dirtyToken > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyToken]);

  const active = useMemo(() => rows.filter((a) => a.is_active), [rows]);

  const totals = useMemo(() => {
    const assets = sumBy(active.filter((a) => Number(a.current_balance) >= 0), (a) => a.current_balance);
    const liabilities = Math.abs(
      sumBy(active.filter((a) => Number(a.current_balance) < 0), (a) => a.current_balance),
    );
    const cash = sumBy(active.filter((a) => a.type === 'cash'), (a) => a.current_balance);
    return { assets, liabilities, cash, net: assets - liabilities, count: active.length };
  }, [active]);

  /*
    Balances are added together as plain numbers — here, in dashboard_summary,
    everywhere. There is no exchange rate anywhere in the product, so a dollar
    account and a rupee account sum as if a dollar were a rupee. The totals are
    only meaningful while one currency is in play; when it is not, say so
    rather than print a confident wrong number.
  */
  const mixedCurrencies = useMemo(() => {
    const seen = new Set(active.map((a) => a.currency).filter(Boolean));
    return seen.size > 1 ? [...seen] : null;
  }, [active]);

  const confirmDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    const { error } = await remove(confirm.id);
    setDeleting(false);
    if (!error) toast.success(`${confirm.name} removed.`);
    setConfirm(null);
  };

  const typeLabel = (id) => ACCOUNT_TYPES.find((t) => t.id === id)?.label ?? id;

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="Where your"
        accent="money lives."
        subtitle="Every bank, card, wallet and investment, with balances kept in step with the ledger."
        actions={
          <Button size="md" icon={Plus} onClick={() => open('account')}>
            Add Account
          </Button>
        }
      >
        <StatStrip
          items={[
            { label: 'Accounts', value: totals.count },
            { label: 'Assets', value: formatMoney(totals.assets), tone: 'lime' },
            { label: 'Liabilities', value: formatMoney(totals.liabilities), tone: 'negative' },
            {
              label: 'Cash in hand',
              value: formatMoney(totals.cash),
              meta: 'Notes and coins',
            },
            { label: 'Net position', value: formatMoney(totals.net) },
          ]}
        />
      </PageHeader>

      {mixedCurrencies && (
        <Card className="mb-6 border-warning/30 bg-warning/[0.06]">
          <div className="flex items-start gap-3">
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warning" />
            <p className="text-[13px] leading-relaxed text-ink-dim">
              Your accounts are held in {mixedCurrencies.join(', ')}. Novatrix does not convert
              between currencies, so the totals above — and net worth on the dashboard — add the
              balances as plain numbers.{' '}
              <span className="text-ink">Read each account&apos;s own balance</span> as the accurate
              figure.
            </p>
          </div>
        </Card>
      )}

      {loading ? (
        <Card>
          <LoadingBlock rows={4} />
        </Card>
      ) : !rows.length ? (
        <Card>
          <EmptyState
            icon={Landmark}
            title="No accounts yet"
            description="Add the accounts you actually use — balances update automatically as you record transactions."
            action={
              <Button size="sm" icon={Plus} onClick={() => open('account')}>
                Add your first account
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((account) => {
            const Icon = resolveIcon(account.icon, 'Landmark');
            const balance = Number(account.current_balance);
            const negative = balance < 0;
            const utilisation =
              account.type === 'credit_card' && account.credit_limit
                ? Math.min((Math.abs(balance) / Number(account.credit_limit)) * 100, 100)
                : null;

            return (
              <Card key={account.id} hover className={cx('group', !account.is_active && 'opacity-55')}>
                <div className="mb-6 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="icon-tile h-11 w-11"
                      style={{
                        borderColor: `${account.color}33`,
                        backgroundColor: `${account.color}14`,
                      }}
                    >
                      <Icon size={17} strokeWidth={1.9} style={{ color: account.color }} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-[14px] font-semibold text-ink">{account.name}</p>
                        {/* Exactly one account carries this, app-wide — the
                            accounts_single_primary trigger guarantees it. */}
                        {account.is_primary && (
                          <Star
                            size={12}
                            className="shrink-0 fill-accent text-accent"
                            aria-label="Primary account"
                          />
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                        {typeLabel(account.type)}
                        {account.institution ? ` · ${account.institution}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 reveal-actions">
                    <button
                      type="button"
                      onClick={() => open('account', { record: account })}
                      aria-label="Edit account"
                      className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirm(account)}
                      aria-label="Delete account"
                      className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <p className="eyebrow mb-1.5">Current Balance</p>
                <p
                  className={cx(
                    'truncate text-figure-md tnum',
                    negative ? 'text-negative' : 'text-ink',
                  )}
                >
                  {formatMoney(balance, { currency: account.currency })}
                </p>

                {utilisation !== null && (
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-[11px]">
                      <span className="text-ink-muted">Credit used</span>
                      <span className="tnum text-ink-dim">{Math.round(utilisation)}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-hair">
                      <div
                        className={cx(
                          'h-full rounded-full transition-all duration-700 ease-premium',
                          utilisation > 80 ? 'bg-negative' : utilisation > 50 ? 'bg-warning' : 'bg-lime',
                        )}
                        style={{ width: `${utilisation}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-5 flex items-center justify-between gap-2 border-t border-hair-soft pt-4">
                  <div className="flex items-center gap-2">
                    {(isCombined || account.workspace_id === null) && (
                      <WorkspaceBadge type={workspaceType(account.workspace_id)} />
                    )}
                    {account.account_number && (
                      <span className="font-mono text-[11px] text-ink-muted">{account.account_number}</span>
                    )}
                    {!account.is_active && <Badge tone="neutral">Inactive</Badge>}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      open('transaction', {
                        defaultType: 'expense',
                        // Pre-point the entry at this account, so "Add entry"
                        // on a cash card actually debits cash rather than
                        // opening a blank form on whatever comes first.
                        preset: {
                          type: 'expense',
                          workspace_id: account.workspace_id,
                          account_id: account.id,
                          ...(account.type === 'cash' ? { payment_method: 'Cash' } : {}),
                        },
                      })
                    }
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ink-muted transition-colors hover:text-accent"
                  >
                    Add entry
                    <ArrowUpRight size={12} />
                  </button>
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
        title="Delete account?"
        message={`"${confirm?.name}" will be removed. Transactions that referenced it are kept, but they will no longer be linked to an account.`}
      />
    </div>
  );
}
