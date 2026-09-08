import { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Download,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Pencil,
  Trash2,
  Receipt,
  Filter,
} from 'lucide-react';
import { PageHeader, StatStrip } from '@/components/layout/PageHeader';
import {
  Card,
  Button,
  Badge,
  EmptyState,
  LoadingBlock,
  SearchInput,
  Select,
  ConfirmDialog,
  WorkspaceBadge,
} from '@/components/ui';
import { useCollection } from '@/hooks/useCollection';
import { useFormOptions } from '@/hooks/useFormOptions';
import { useModals } from '@/context/ModalContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { formatMoney, formatDate, toISODate } from '@/lib/format';
import { cx, downloadCSV, sumBy } from '@/lib/utils';

const TYPE_META = {
  income: { Icon: ArrowDownLeft, className: 'border-accent/25 bg-accent/10 text-accent' },
  expense: { Icon: ArrowUpRight, className: 'border-negative/20 bg-negative/[0.07] text-negative' },
  transfer: { Icon: ArrowLeftRight, className: 'text-ink-dim' },
};

export default function Transactions() {
  const { open, dirtyToken } = useModals();
  const { workspaceType, isCombined } = useWorkspace();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [categoryId, setCategoryId] = useState('all');
  const [range, setRange] = useState('30');
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const { rows, loading, remove, refresh } = useCollection('transactions', {
    select:
      'id, description, amount, type, status, txn_date, workspace_id, payment_method, reference, notes, account_id, to_account_id, category_id, contact_id, category:categories(name, color), account:accounts!transactions_account_id_fkey(name), to_account:accounts!transactions_to_account_id_fkey(name), contact:contacts(name)',
    orderBy: { column: 'txn_date', ascending: false },
    limit: 400,
  });

  const { categories } = useFormOptions();

  useEffect(() => {
    if (dirtyToken > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyToken]);

  /* Filtering happens client-side: the page already holds a bounded window of
     rows, and this keeps the controls instant. */
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const cutoff =
      range === 'all'
        ? null
        : toISODate(new Date(Date.now() - Number(range) * 86400000));

    return rows.filter((t) => {
      if (type !== 'all' && t.type !== type) return false;
      if (categoryId !== 'all' && t.category_id !== categoryId) return false;
      if (cutoff && t.txn_date < cutoff) return false;
      if (term) {
        const haystack = [t.description, t.category?.name, t.account?.name, t.contact?.name, t.reference]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rows, search, type, categoryId, range]);

  const totals = useMemo(() => {
    const income = sumBy(filtered.filter((t) => t.type === 'income'), (t) => t.amount);
    const expense = sumBy(filtered.filter((t) => t.type === 'expense'), (t) => t.amount);
    return { income, expense, net: income - expense, count: filtered.length };
  }, [filtered]);

  const exportCsv = () => {
    if (!filtered.length) return toast.info('Nothing to export with these filters.');
    downloadCSV(
      `novatrix-transactions-${toISODate()}`,
      filtered.map((t) => ({
        Date: t.txn_date,
        Description: t.description,
        Type: t.type,
        Amount: t.amount,
        Category: t.category?.name || '',
        Account: t.account?.name || '',
        Contact: t.contact?.name || '',
        Workspace: workspaceType(t.workspace_id) || '',
        Status: t.status,
        Reference: t.reference || '',
      })),
    );
    toast.success(`Exported ${filtered.length} transactions.`);
  };

  const confirmDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    const { error } = await remove(confirm.id);
    setDeleting(false);
    if (!error) toast.success('Transaction deleted. Balances updated.');
    setConfirm(null);
  };

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="Every rupee,"
        accent="accounted for."
        subtitle="Your full ledger — filter it, export it, correct it."
        actions={
          <>
            <Button variant="secondary" size="md" icon={Download} onClick={exportCsv}>
              Export
            </Button>
            <Button size="md" icon={Plus} onClick={() => open('transaction')}>
              Add Transaction
            </Button>
          </>
        }
      >
        <StatStrip
          items={[
            { label: 'Transactions', value: totals.count },
            { label: 'Income', value: formatMoney(totals.income), tone: 'lime' },
            { label: 'Expenses', value: formatMoney(totals.expense), tone: 'negative' },
            {
              label: 'Net',
              value: formatMoney(totals.net),
              tone: totals.net >= 0 ? 'lime' : 'negative',
            },
          ]}
        />
      </PageHeader>

      {/* Filters */}
      <Card className="mb-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
          <SearchInput value={search} onChange={setSearch} placeholder="Search description, category, contact…" />
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
            <option value="transfer">Transfer</option>
          </Select>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
            <option value="all">All time</option>
          </Select>
        </div>
      </Card>

      {/* Ledger */}
      <Card pad={false} className="overflow-hidden">
        {loading ? (
          <div className="p-6">
            <LoadingBlock rows={8} />
          </div>
        ) : !filtered.length ? (
          <div className="p-6">
            <EmptyState
              icon={rows.length ? Filter : Receipt}
              title={rows.length ? 'No matches' : 'No transactions yet'}
              description={
                rows.length
                  ? 'Try widening the date range or clearing a filter.'
                  : 'Record your first transaction and it will appear here instantly.'
              }
              action={
                rows.length ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearch('');
                      setType('all');
                      setCategoryId('all');
                      setRange('all');
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button size="sm" icon={Plus} onClick={() => open('transaction')}>
                    Add transaction
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[54rem]">
              <thead className="bg-surface/50">
                <tr>
                  <th className="t-head">Description</th>
                  <th className="t-head">Category</th>
                  <th className="t-head">Account</th>
                  <th className="t-head">Date</th>
                  <th className="t-head text-right">Amount</th>
                  <th className="t-head text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const meta = TYPE_META[t.type] || TYPE_META.transfer;
                  const { Icon } = meta;
                  const income = t.type === 'income';

                  return (
                    <tr key={t.id} className="t-row group">
                      <td className="t-cell">
                        <div className="flex items-center gap-3">
                          <span className={cx('icon-tile h-9 w-9', meta.className)}>
                            <Icon size={14} strokeWidth={2.1} />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-medium">{t.description || 'Transaction'}</p>
                              {isCombined && <WorkspaceBadge type={workspaceType(t.workspace_id)} />}
                            </div>
                            {t.contact?.name && (
                              <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                                {t.contact.name}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="t-cell">
                        {t.category?.name ? (
                          <span className="inline-flex items-center gap-2 text-[13px] text-ink-dim">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: t.category.color || '#6B7280' }}
                            />
                            {t.category.name}
                          </span>
                        ) : (
                          <span className="text-[13px] text-ink-muted">—</span>
                        )}
                      </td>

                      <td className="t-cell text-[13px] text-ink-dim">{t.account?.name || '—'}</td>

                      <td className="t-cell">
                        <p className="text-[13px] text-ink-dim">{formatDate(t.txn_date)}</p>
                        {t.status !== 'completed' && (
                          <Badge tone="warning" className="mt-1">
                            {t.status}
                          </Badge>
                        )}
                      </td>

                      <td
                        className={cx(
                          't-cell text-right font-semibold tnum',
                          income ? 'text-accent' : t.type === 'expense' ? 'text-ink' : 'text-ink-dim',
                        )}
                      >
                        {income ? '+ ' : t.type === 'expense' ? '− ' : ''}
                        {formatMoney(t.amount)}
                      </td>

                      <td className="t-cell text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => open('transaction', { record: t })}
                            aria-label="Edit transaction"
                            className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirm(t)}
                            aria-label="Delete transaction"
                            className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                          >
                            <Trash2 size={14} />
                          </button>
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
        title="Delete transaction?"
        message={`"${confirm?.description || 'This entry'}" will be removed and the affected account balances will be corrected. This cannot be undone.`}
      />
    </div>
  );
}
