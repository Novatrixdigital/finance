import { useState, useEffect, useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Paperclip, X, Loader2 } from 'lucide-react';
import { Modal, Button, Input, Select, Textarea } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { useModals } from '@/context/ModalContext';
import { useFormOptions } from '@/hooks/useFormOptions';
import { supabase, readableError, uploadFile, signedUrl } from '@/lib/supabase';
import { PAYMENT_METHODS, TRANSACTION_STATUSES } from '@/lib/constants';
import { toISODate, formatMoney, currencySymbol, defaultCurrency } from '@/lib/format';
import { cx } from '@/lib/utils';

const TYPES = [
  { id: 'income', label: 'Income', Icon: ArrowDownLeft, tone: 'text-accent' },
  { id: 'expense', label: 'Expense', Icon: ArrowUpRight, tone: 'text-negative' },
  { id: 'transfer', label: 'Transfer', Icon: ArrowLeftRight, tone: 'text-ink-dim' },
];

const blank = (type = 'expense', workspaceId = '') => ({
  type,
  workspace_id: workspaceId,
  amount: '',
  txn_date: toISODate(),
  account_id: '',
  to_account_id: '',
  category_id: '',
  contact_id: '',
  description: '',
  payment_method: 'Bank Transfer',
  status: 'completed',
  reference: '',
  notes: '',
  attachment_url: '',
});

/** Matches the `attachments` bucket policy in the schema. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Create / edit a ledger entry.
 *
 * The workspace picker only appears in Combined mode, where there is no single
 * obvious destination for a new record.
 */
/**
 * `preset` pre-fills a new entry without locking it — the Cash page uses it
 * to open a bank→cash withdrawal with both sides already chosen. It is
 * ignored when editing, so it can never overwrite a saved record.
 */
export function TransactionForm({
  open,
  onClose,
  record = null,
  defaultType = 'expense',
  preset = null,
}) {
  const { user } = useAuth();
  const { writeWorkspace, workspaces, isCombined } = useWorkspace();
  const toast = useToast();
  const { notifySaved } = useModals();

  const [form, setForm] = useState(() => blank(defaultType, writeWorkspace?.id));
  const [saving, setSaving] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [errors, setErrors] = useState({});

  const isEdit = Boolean(record?.id);
  const { accounts, categoriesByKind, contacts, loading } = useFormOptions(form.workspace_id);

  /* Reset whenever the modal opens or the record changes. */
  useEffect(() => {
    if (!open) return;
    if (record) {
      setForm({
        ...blank(record.type, record.workspace_id),
        ...record,
        amount: String(record.amount ?? ''),
        txn_date: record.txn_date || toISODate(),
        account_id: record.account_id || '',
        to_account_id: record.to_account_id || '',
        category_id: record.category_id || '',
        contact_id: record.contact_id || '',
        payment_method: record.payment_method || 'Bank Transfer',
        reference: record.reference || '',
        notes: record.notes || '',
        attachment_url: record.attachment_url || '',
      });
    } else {
      setForm({ ...blank(defaultType, writeWorkspace?.id), ...(preset || {}) });
    }
    setErrors({});
    // `preset` is a fresh object literal at every call site, so it is compared
    // by its contents rather than identity — otherwise the form would reset
    // itself on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record, defaultType, writeWorkspace?.id, JSON.stringify(preset || null)]);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const setType = (type) => {
    // Category lists differ per type, so drop a now-invalid selection.
    setForm((f) => ({ ...f, type, category_id: '', to_account_id: '' }));
  };

  const categories = categoriesByKind[form.type] || [];

  /* ── Cash ───────────────────────────────────────────────────────────────
     Cash is an ordinary account of type 'cash', so an entry booked against
     it moves cash in hand AND lands in the month's spend — the ledger
     triggers do both. What used to go wrong was booking a cash payment
     against a bank account: the spend counted, but the cash never left. */
  const cashAccount = useMemo(() => accounts.find((a) => a.type === 'cash') || null, [accounts]);
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === form.account_id) || null,
    [accounts, form.account_id],
  );
  const paidInCash = String(form.payment_method || '').toLowerCase() === 'cash';
  const cashMismatch =
    paidInCash && form.type !== 'transfer' && selectedAccount && selectedAccount.type !== 'cash';

  /* Choosing "Cash" points the entry at the cash account, so physical money
     is actually debited. Only on an explicit change — never on load, which
     would quietly re-book a saved record the moment it was opened. */
  const setPaymentMethod = (e) => {
    const value = e.target.value;
    setForm((f) => {
      const next = { ...f, payment_method: value };
      if (
        value.toLowerCase() === 'cash' &&
        f.type !== 'transfer' &&
        cashAccount &&
        f.account_id !== cashAccount.id
      ) {
        next.account_id = cashAccount.id;
      }
      return next;
    });
    setErrors((prev) => (prev.account_id ? { ...prev, account_id: undefined } : prev));
  };
  const workspaceCurrency = useMemo(
    () => accounts.find((a) => a.id === form.account_id)?.currency || defaultCurrency(),
    [accounts, form.account_id],
  );

  const validate = () => {
    const next = {};
    const amount = Number(form.amount);

    if (!form.workspace_id) next.workspace_id = 'Choose a workspace.';
    if (!form.amount || Number.isNaN(amount) || amount <= 0) next.amount = 'Enter an amount greater than zero.';
    if (!form.txn_date) next.txn_date = 'Pick a date.';
    if (!form.account_id) next.account_id = 'Choose an account.';
    if (form.type === 'transfer') {
      if (!form.to_account_id) next.to_account_id = 'Choose a destination account.';
      else if (form.to_account_id === form.account_id) next.to_account_id = 'Pick a different account.';
    }
    if (!form.description.trim()) next.description = 'Add a short description.';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  /*
    Receipts.

    The schema has carried `transactions.attachment_url` and a private
    `attachments` bucket — with uid-scoped RLS policies — since the first
    migration, and nothing in the app ever wrote to either. This is the control
    that was missing, not new infrastructure.
  */
  const onAttach = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error('That file is over 10 MB — the bucket will reject it.');
      e.target.value = '';
      return;
    }

    setAttaching(true);
    try {
      // The storage PATH is what gets saved, not the signed URL that comes
      // back with it: signed URLs expire, and a column full of expired links
      // is worse than an empty one. `signedUrl` mints a fresh link on demand.
      const { path } = await uploadFile('attachments', user.id, file, 'receipt-');
      setForm((f) => ({ ...f, attachment_url: path }));
      toast.success('Receipt attached.');
    } catch (err) {
      toast.error(readableError(err));
    } finally {
      setAttaching(false);
      e.target.value = '';
    }
  };

  /** Opens the receipt through a link minted at click time. */
  const openReceipt = async () => {
    try {
      const url = await signedUrl('attachments', form.attachment_url);
      if (url) window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast.error(readableError(err));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate() || !user) return;

    setSaving(true);

    const payload = {
      user_id: user.id,
      workspace_id: form.workspace_id,
      type: form.type,
      status: form.status,
      amount: Number(form.amount),
      txn_date: form.txn_date,
      description: form.description.trim(),
      account_id: form.account_id || null,
      to_account_id: form.type === 'transfer' ? form.to_account_id : null,
      category_id: form.category_id || null,
      contact_id: form.contact_id || null,
      payment_method: form.payment_method || null,
      reference: form.reference?.trim() || null,
      notes: form.notes?.trim() || null,
      attachment_url: form.attachment_url || null,
    };

    const { error } = isEdit
      ? await supabase.from('transactions').update(payload).eq('id', record.id)
      : await supabase.from('transactions').insert(payload);

    setSaving(false);

    if (error) {
      toast.error(readableError(error));
      return;
    }

    toast.success(
      isEdit
        ? 'Transaction updated.'
        : `${form.type === 'income' ? 'Income' : form.type === 'expense' ? 'Expense' : 'Transfer'} of ${formatMoney(
            form.amount,
          )} recorded.`,
    );
    notifySaved();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Transaction' : 'Add Transaction'}
      subtitle={isEdit ? 'Update this ledger entry.' : 'Record money moving in, out, or across accounts.'}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={saving} type="submit" form="txn-form">
            {isEdit ? 'Save changes' : 'Add transaction'}
          </Button>
        </>
      }
    >
      <form id="txn-form" onSubmit={submit} className="space-y-5">
        {/* Type */}
        <div className="grid grid-cols-3 gap-2">
          {TYPES.map(({ id, label, Icon, tone }) => {
            const active = form.type === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setType(id)}
                className={cx(
                  'flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 transition-all duration-300 ease-premium',
                  active
                    ? 'border-accent/45 bg-lime/[0.07]'
                    : 'border-hair bg-surface hover:border-hair-strong',
                )}
              >
                <Icon size={18} className={active ? tone : 'text-ink-muted'} strokeWidth={2} />
                <span className={cx('text-[12.5px] font-semibold', active ? 'text-ink' : 'text-ink-muted')}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Amount — the hero field */}
        <div>
          <label htmlFor="amount" className="field-label">
            Amount
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-2xl font-semibold text-ink-muted">
              {currencySymbol(workspaceCurrency)}
            </span>
            <input
              id="amount"
              name="amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={set('amount')}
              placeholder="0"
              className={cx(
                'field tnum h-[4.5rem] pl-14 text-3xl font-bold tracking-tight',
                errors.amount && 'border-negative/50',
              )}
            />
          </div>
          {errors.amount && <p className="mt-1.5 text-[12px] text-negative">{errors.amount}</p>}
        </div>

        {isCombined && (
          <Select
            label="Workspace"
            name="workspace_id"
            value={form.workspace_id}
            onChange={(e) => setForm((f) => ({ ...f, workspace_id: e.target.value, account_id: '', to_account_id: '', category_id: '', contact_id: '' }))}
            error={errors.workspace_id}
            hint="Personal and business records stay separate."
          >
            <option value="">Select workspace…</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={form.type === 'transfer' ? 'From account' : 'Account'}
            name="account_id"
            value={form.account_id}
            onChange={set('account_id')}
            error={errors.account_id}
            disabled={loading}
          >
            <option value="">{loading ? 'Loading…' : 'Select account…'}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {formatMoney(a.current_balance, { currency: a.currency })}
              </option>
            ))}
          </Select>

          {form.type === 'transfer' ? (
            <Select
              label="To account"
              name="to_account_id"
              value={form.to_account_id}
              onChange={set('to_account_id')}
              error={errors.to_account_id}
              disabled={loading}
            >
              <option value="">Select account…</option>
              {accounts
                .filter((a) => a.id !== form.account_id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          ) : (
            <Select label="Category" name="category_id" value={form.category_id} onChange={set('category_id')}>
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </div>

        <Input
          label="Description"
          name="description"
          value={form.description}
          onChange={set('description')}
          placeholder="e.g. Client Payment - ABC Tech"
          error={errors.description}
          maxLength={140}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Date"
            name="txn_date"
            type="date"
            value={form.txn_date}
            onChange={set('txn_date')}
            error={errors.txn_date}
          />
          <Select
            label="Payment method"
            name="payment_method"
            value={form.payment_method}
            onChange={setPaymentMethod}
            hint={
              paidInCash && cashAccount && selectedAccount?.type === 'cash'
                ? 'Comes out of cash in hand.'
                : undefined
            }
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>

        {cashMismatch && (
          <div className="rounded-2xl border border-warning/30 bg-warning/[0.06] px-4 py-3">
            <p className="text-[12.5px] leading-relaxed text-ink-dim">
              Paid in cash but booked against{' '}
              <span className="font-medium text-ink">{selectedAccount.name}</span>. The spend will
              count, but cash in hand will not drop.
              {cashAccount && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, account_id: cashAccount.id }))}
                    className="font-medium text-accent underline underline-offset-2"
                  >
                    Book it to {cashAccount.name} instead
                  </button>
                </>
              )}
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {contacts.length > 0 && form.type !== 'transfer' && (
            <Select label="Contact" name="contact_id" value={form.contact_id} onChange={set('contact_id')}>
              <option value="">None</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company ? ` — ${c.company}` : ''}
                </option>
              ))}
            </Select>
          )}
          <Select label="Status" name="status" value={form.status} onChange={set('status')} hint="Only completed entries move balances.">
            {TRANSACTION_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>

        <Input
          label="Reference"
          name="reference"
          value={form.reference}
          onChange={set('reference')}
          placeholder="UTR, cheque no. or invoice ref (optional)"
        />

        <Textarea label="Notes" name="notes" value={form.notes} onChange={set('notes')} placeholder="Optional" />

        {/* Receipt */}
        <div>
          <span className="field-label">Receipt</span>
          {form.attachment_url ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-hair bg-surface px-4 py-3">
              <Paperclip size={15} className="shrink-0 text-accent" />
              <button
                type="button"
                onClick={openReceipt}
                className="min-w-0 flex-1 truncate text-left text-[13px] text-ink underline-offset-2 hover:underline"
              >
                View attached receipt
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, attachment_url: '' }))}
                className="shrink-0 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                aria-label="Remove receipt"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <label className="btn-secondary btn-md w-full cursor-pointer sm:w-auto">
              {attaching ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
              {attaching ? 'Uploading…' : 'Attach receipt'}
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={onAttach}
                className="hidden"
                disabled={attaching}
              />
            </label>
          )}
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Image or PDF, up to 10 MB. Stored privately — only you can open it.
          </p>
        </div>
      </form>
    </Modal>
  );
}

export default TransactionForm;
