import { useState, useMemo, useEffect } from 'react';
import { Plus, Pencil, Trash2, FileText, Send, IndianRupee, Download, Briefcase } from 'lucide-react';
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
} from '@/components/ui';
import { useCollection } from '@/hooks/useCollection';
import { useModals } from '@/context/ModalContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { supabase, readableError } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { formatMoney, formatDate, daysUntil, toISODate } from '@/lib/format';
import { INVOICE_STATUS, SCOPES } from '@/lib/constants';
import { cx, sumBy, downloadCSV } from '@/lib/utils';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'paid', label: 'Paid' },
  { id: 'draft', label: 'Drafts' },
];

export default function Invoices() {
  const { open, dirtyToken, notifySaved } = useModals();
  const { isPersonal, setScope, business } = useWorkspace();
  const { user } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const { rows, loading, update, remove, refresh } = useCollection('invoices', {
    select: '*, contact:contacts(name, company, email)',
    orderBy: { column: 'issue_date', ascending: false },
    enabled: !isPersonal,
  });

  useEffect(() => {
    if (dirtyToken > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyToken]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((inv) => {
      if (tab === 'outstanding' && !['sent', 'partial', 'overdue'].includes(inv.status)) return false;
      if (tab === 'paid' && inv.status !== 'paid') return false;
      if (tab === 'draft' && inv.status !== 'draft') return false;
      if (term) {
        const hay = `${inv.invoice_number} ${inv.contact?.name || ''} ${inv.contact?.company || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, tab, search]);

  const totals = useMemo(() => {
    const outstanding = rows.filter((i) => ['sent', 'partial', 'overdue'].includes(i.status));
    return {
      billed: sumBy(rows, (i) => i.total),
      due: sumBy(outstanding, (i) => i.balance_due),
      dueCount: outstanding.length,
      overdue: sumBy(rows.filter((i) => i.status === 'overdue'), (i) => i.balance_due),
      collected: sumBy(rows, (i) => i.amount_paid),
    };
  }, [rows]);

  /* Personal mode has no invoices by design — offer the switch instead. */
  if (isPersonal) {
    return (
      <div className="mx-auto max-w-[1560px]">
        <PageHeader title="Invoices are a" accent="business thing." />
        <Card>
          <EmptyState
            icon={Briefcase}
            title="Switch to your Business workspace"
            description="Invoicing, customers and receivables live in the business books. Personal stays deliberately simple."
            action={
              <Button size="sm" onClick={() => setScope(business ? SCOPES.BUSINESS : SCOPES.COMBINED)}>
                Switch to Business
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const markSent = async (invoice) => {
    const { error } = await update(invoice.id, { status: 'sent' });
    if (!error) toast.success(`${invoice.invoice_number} marked as sent.`);
  };

  /** Records a full payment against the invoice; triggers reconcile the totals. */
  const recordPayment = async (invoice) => {
    const { error } = await supabase.from('payments').insert({
      user_id: user.id,
      workspace_id: invoice.workspace_id,
      invoice_id: invoice.id,
      contact_id: invoice.contact_id,
      name: `${invoice.invoice_number} — payment received`,
      direction: 'incoming',
      status: 'paid',
      amount: invoice.balance_due,
      due_date: toISODate(),
      paid_date: toISODate(),
      method: 'Bank Transfer',
    });

    if (error) {
      toast.error(readableError(error));
      return;
    }
    toast.success(`${formatMoney(invoice.balance_due)} recorded against ${invoice.invoice_number}.`);
    refresh();
    notifySaved();
  };

  const confirmDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    const { error } = await remove(confirm.id);
    setDeleting(false);
    if (!error) toast.success('Invoice deleted.');
    setConfirm(null);
  };

  const exportCsv = () => {
    if (!filtered.length) return toast.info('Nothing to export.');
    downloadCSV(
      `novatrix-invoices-${toISODate()}`,
      filtered.map((i) => ({
        Number: i.invoice_number,
        Customer: i.contact?.name || '',
        Issued: i.issue_date,
        Due: i.due_date,
        Status: i.status,
        Subtotal: i.subtotal,
        Tax: i.tax_amount,
        Total: i.total,
        Paid: i.amount_paid,
        Balance: i.balance_due,
      })),
    );
    toast.success('Invoices exported.');
  };

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="Get paid,"
        accent="on time."
        subtitle="Raise invoices, track what is owed, and reconcile payments against them."
        actions={
          <>
            <Button variant="secondary" size="md" icon={Download} onClick={exportCsv}>
              Export
            </Button>
            <Button size="md" icon={Plus} onClick={() => open('invoice')}>
              Create Invoice
            </Button>
          </>
        }
      >
        <StatStrip
          items={[
            { label: 'Receivables', value: formatMoney(totals.due), tone: 'warning', meta: `${totals.dueCount} open` },
            { label: 'Overdue', value: formatMoney(totals.overdue), tone: 'negative' },
            { label: 'Collected', value: formatMoney(totals.collected), tone: 'lime' },
            { label: 'Total billed', value: formatMoney(totals.billed) },
          ]}
        />
      </PageHeader>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented options={TABS} value={tab} onChange={setTab} />
        <SearchInput value={search} onChange={setSearch} placeholder="Search number or customer…" className="sm:w-80" />
      </div>

      <Card pad={false} className="overflow-hidden">
        {loading ? (
          <div className="p-6">
            <LoadingBlock rows={6} />
          </div>
        ) : !filtered.length ? (
          <div className="p-6">
            <EmptyState
              icon={FileText}
              title={rows.length ? 'No invoices match' : 'No invoices yet'}
              description={
                rows.length
                  ? 'Try another tab or clear the search.'
                  : 'Create your first invoice — the totals and status update themselves as payments land.'
              }
              action={
                <Button size="sm" icon={Plus} onClick={() => open('invoice')}>
                  Create invoice
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-stack w-full sm:min-w-[44rem]">
              <thead className="bg-surface/50">
                <tr>
                  <th className="t-head">Invoice</th>
                  <th className="t-head">Customer</th>
                  <th className="t-head">Due</th>
                  <th className="t-head text-right">Total</th>
                  <th className="t-head col-wide text-right">Balance</th>
                  <th className="t-head">Status</th>
                  <th className="t-head text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const status = INVOICE_STATUS[inv.status] || INVOICE_STATUS.draft;
                  const days = daysUntil(inv.due_date);
                  const settled = inv.status === 'paid' || inv.status === 'cancelled';

                  return (
                    <tr key={inv.id} className="t-row group">
                      <td className="t-cell" data-primary>
                        <p className="font-mono text-[13px] font-medium text-ink">{inv.invoice_number}</p>
                        <p className="mt-0.5 text-[11.5px] text-ink-muted">
                          Issued {formatDate(inv.issue_date)}
                        </p>
                      </td>

                      <td className="t-cell" data-label="Customer">
                        <p className="truncate text-[13px] text-ink">{inv.contact?.name || '—'}</p>
                        {inv.contact?.company && (
                          <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">{inv.contact.company}</p>
                        )}
                      </td>

                      <td className="t-cell" data-label="Due">
                        <p className="text-[13px] text-ink-dim">{formatDate(inv.due_date)}</p>
                        {!settled && (
                          <p className={cx('mt-0.5 text-[11px]', days < 0 ? 'text-negative' : 'text-ink-muted')}>
                            {days < 0 ? `${Math.abs(days)}d overdue` : `in ${days}d`}
                          </p>
                        )}
                      </td>

                      <td className="t-cell text-right tnum text-ink-dim" data-label="Total">
                        {formatMoney(inv.total)}
                      </td>

                      <td
                        data-label="Balance"
                        className={cx(
                          't-cell col-wide text-right font-semibold tnum',
                          Number(inv.balance_due) > 0 ? 'text-ink' : 'text-accent',
                        )}
                      >
                        {formatMoney(inv.balance_due)}
                      </td>

                      <td className="t-cell" data-label="Status">
                        <Badge className={status.className} dot>
                          {status.label}
                        </Badge>
                      </td>

                      <td className="t-cell text-right" data-actions>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {inv.status === 'draft' && (
                            <button
                              type="button"
                              onClick={() => markSent(inv)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-hair px-3 py-1.5 text-[11.5px] font-medium text-ink-dim transition-colors hover:border-info/40 hover:text-info"
                            >
                              <Send size={12} /> Send
                            </button>
                          )}
                          {!settled && Number(inv.balance_due) > 0 && (
                            <button
                              type="button"
                              onClick={() => recordPayment(inv)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/20"
                            >
                              <IndianRupee size={12} /> Record
                            </button>
                          )}
                          <div className="flex reveal-actions">
                            <button
                              type="button"
                              onClick={() => open('invoice', { record: inv })}
                              aria-label="Edit invoice"
                              className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirm(inv)}
                              aria-label="Delete invoice"
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
        title="Delete invoice?"
        message={`${confirm?.invoice_number} and its line items will be permanently removed.`}
      />
    </div>
  );
}
