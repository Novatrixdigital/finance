import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal, Button, Input, Select, Textarea } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { useModals } from '@/context/ModalContext';
import { useFormOptions } from '@/hooks/useFormOptions';
import { supabase, readableError } from '@/lib/supabase';
import { formatMoney, toISODate } from '@/lib/format';
import { cx } from '@/lib/utils';

const emptyItem = () => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  description: '',
  quantity: 1,
  rate: '',
});

/**
 * Invoice builder.
 *
 * Totals shown here are a live preview — the authoritative subtotal, tax and
 * balance are recomputed by database triggers from the saved line items, so
 * the numbers can never be forged from the client.
 */
export function InvoiceForm({ open, onClose, record }) {
  const { user } = useAuth();
  const { writeWorkspace, business, isCombined, workspaces } = useWorkspace();
  const toast = useToast();
  const { notifySaved } = useModals();

  // Invoices belong to the business books; default there even from Combined.
  const defaultWorkspace = business?.id || writeWorkspace?.id || '';

  const [form, setForm] = useState({
    invoice_number: '',
    contact_id: '',
    issue_date: toISODate(),
    due_date: toISODate(new Date(Date.now() + 15 * 86400000)),
    status: 'draft',
    tax_rate: 18,
    discount: 0,
    notes: '',
    terms: 'Payment due within 15 days. Bank transfer preferred.',
    workspace_id: defaultWorkspace,
  });
  const [items, setItems] = useState([emptyItem()]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const isEdit = Boolean(record?.id);
  const { contacts } = useFormOptions(form.workspace_id);

  /* Seed a fresh number for new invoices; load line items when editing. */
  const seed = useCallback(async () => {
    if (record?.id) {
      setForm({
        invoice_number: record.invoice_number || '',
        contact_id: record.contact_id || '',
        issue_date: record.issue_date || toISODate(),
        due_date: record.due_date || toISODate(),
        status: record.status || 'draft',
        tax_rate: Number(record.tax_rate) || 0,
        discount: Number(record.discount) || 0,
        notes: record.notes || '',
        terms: record.terms || '',
        workspace_id: record.workspace_id,
      });

      const { data } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', record.id)
        .order('sort_order');

      setItems(
        data?.length
          ? data.map((it) => ({
              key: it.id,
              id: it.id,
              description: it.description,
              quantity: Number(it.quantity),
              rate: String(it.rate),
            }))
          : [emptyItem()],
      );
      return;
    }

    setItems([emptyItem()]);
    const ws = defaultWorkspace;
    setForm((f) => ({ ...f, workspace_id: ws, invoice_number: '' }));

    if (ws) {
      const { data } = await supabase.rpc('next_invoice_number', { p_workspace_id: ws });
      if (data) setForm((f) => ({ ...f, invoice_number: data }));
    }
  }, [record, defaultWorkspace]);

  useEffect(() => {
    if (open) {
      setErrors({});
      seed();
    }
  }, [open, seed]);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const setItem = (key, field, value) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, [field]: value } : it)));

  const addItem = () => setItems((list) => [...list, emptyItem()]);
  const removeItem = (key) =>
    setItems((list) => (list.length === 1 ? [emptyItem()] : list.filter((it) => it.key !== key)));

  const totals = useMemo(() => {
    const subtotal = items.reduce(
      (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.rate) || 0),
      0,
    );
    const discount = Number(form.discount) || 0;
    const tax = ((subtotal - discount) * (Number(form.tax_rate) || 0)) / 100;
    return { subtotal, discount, tax, total: subtotal - discount + tax };
  }, [items, form.discount, form.tax_rate]);

  const submit = async () => {
    const next = {};
    if (!form.invoice_number.trim()) next.invoice_number = 'Invoice number is required.';
    if (!form.workspace_id) next.workspace_id = 'Choose a workspace.';
    if (!form.contact_id) next.contact_id = 'Select who this is billed to.';
    if (!items.some((it) => it.description.trim() && Number(it.rate) > 0)) {
      next.items = 'Add at least one line with a description and a rate.';
    }

    setErrors(next);
    if (Object.keys(next).length || !user) return;

    setSaving(true);

    const header = {
      user_id: user.id,
      workspace_id: form.workspace_id,
      contact_id: form.contact_id,
      invoice_number: form.invoice_number.trim(),
      issue_date: form.issue_date,
      due_date: form.due_date,
      status: form.status,
      tax_rate: Number(form.tax_rate) || 0,
      discount: Number(form.discount) || 0,
      notes: form.notes?.trim() || null,
      terms: form.terms?.trim() || null,
    };

    let invoiceId = record?.id;

    if (isEdit) {
      const { error } = await supabase.from('invoices').update(header).eq('id', invoiceId);
      if (error) {
        setSaving(false);
        toast.error(readableError(error));
        return;
      }
      // Replace the lines wholesale — simpler and safer than diffing, and the
      // trigger recomputes totals either way.
      await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId);
    } else {
      const { data, error } = await supabase.from('invoices').insert(header).select('id').single();
      if (error) {
        setSaving(false);
        toast.error(readableError(error));
        return;
      }
      invoiceId = data.id;
    }

    const rows = items
      .filter((it) => it.description.trim() && Number(it.rate) > 0)
      .map((it, index) => ({
        invoice_id: invoiceId,
        user_id: user.id,
        description: it.description.trim(),
        quantity: Number(it.quantity) || 1,
        rate: Number(it.rate) || 0,
        sort_order: index + 1,
      }));

    const { error: itemErr } = await supabase.from('invoice_items').insert(rows);

    setSaving(false);

    if (itemErr) {
      toast.error(readableError(itemErr));
      return;
    }

    toast.success(isEdit ? 'Invoice updated.' : `Invoice ${form.invoice_number} created.`);
    notifySaved();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Edit Invoice' : 'Create Invoice'}
      subtitle="Line items drive the totals; the database recalculates them on save."
      footer={
        <>
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="button" onClick={submit} loading={saving}>
            {isEdit ? 'Save invoice' : 'Create invoice'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {isCombined && (
          <Select label="Workspace" value={form.workspace_id} onChange={set('workspace_id')} error={errors.workspace_id}>
            <option value="">Select workspace…</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Invoice number" value={form.invoice_number} onChange={set('invoice_number')} error={errors.invoice_number} />
          <Select label="Bill to" value={form.contact_id} onChange={set('contact_id')} error={errors.contact_id}>
            <option value="">Select customer…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` — ${c.company}` : ''}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Issue date" type="date" value={form.issue_date} onChange={set('issue_date')} />
          <Input label="Due date" type="date" value={form.due_date} onChange={set('due_date')} />
          <Select label="Status" value={form.status} onChange={set('status')}>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>

        {/* Line items */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] font-medium text-ink-dim">Line items</p>
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1.5 rounded-full border border-hair px-3 py-1.5 text-[12px] font-medium text-ink-dim transition-colors hover:border-accent/40 hover:text-accent"
            >
              <Plus size={13} /> Add line
            </button>
          </div>

          <div className="space-y-2">
            {items.map((it) => (
              <div
                key={it.key}
                className="grid grid-cols-12 items-center gap-2 rounded-2xl border border-hair bg-surface p-2"
              >
                <input
                  value={it.description}
                  onChange={(e) => setItem(it.key, 'description', e.target.value)}
                  placeholder="Description"
                  className="col-span-12 rounded-xl bg-transparent px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted sm:col-span-6"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={it.quantity}
                  onChange={(e) => setItem(it.key, 'quantity', e.target.value)}
                  placeholder="Qty"
                  className="tnum col-span-3 rounded-xl bg-transparent px-3 py-2 text-right text-[13px] text-ink outline-none sm:col-span-2"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={it.rate}
                  onChange={(e) => setItem(it.key, 'rate', e.target.value)}
                  placeholder="Rate"
                  className="tnum col-span-4 rounded-xl bg-transparent px-3 py-2 text-right text-[13px] text-ink outline-none sm:col-span-2"
                />
                <div className="col-span-4 pr-1 text-right text-[13px] font-semibold tnum text-ink sm:col-span-1">
                  {formatMoney((Number(it.quantity) || 0) * (Number(it.rate) || 0), { withSymbol: false })}
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(it.key)}
                  aria-label="Remove line"
                  className="col-span-1 justify-self-end rounded-lg p-2 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {errors.items && <p className="mt-2 text-[12px] text-negative">{errors.items}</p>}
        </div>

        {/* Totals */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-4">
            <Input label="Discount" type="number" step="0.01" value={form.discount} onChange={set('discount')} />
            <Input label="Tax rate (%)" type="number" step="0.01" value={form.tax_rate} onChange={set('tax_rate')} />
          </div>

          <div className="rounded-2xl border border-hair bg-surface p-5">
            {[
              ['Subtotal', totals.subtotal],
              ['Discount', -totals.discount],
              [`Tax (${form.tax_rate || 0}%)`, totals.tax],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between py-1.5 text-[13px]">
                <span className="text-ink-muted">{label}</span>
                <span className="tnum text-ink-dim">{formatMoney(value)}</span>
              </div>
            ))}
            <div className="my-2 hair-x" />
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-ink-dim">Total</span>
              <span className={cx('text-xl font-bold tnum tracking-tight text-accent')}>
                {formatMoney(totals.total)}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Textarea label="Notes" value={form.notes} onChange={set('notes')} placeholder="Visible to the customer" />
          <Textarea label="Terms" value={form.terms} onChange={set('terms')} />
        </div>
      </div>
    </Modal>
  );
}

export default InvoiceForm;
