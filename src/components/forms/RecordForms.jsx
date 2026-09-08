import { useState, useEffect } from 'react';
import { Modal, Button, Input, Select, Textarea } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { useModals } from '@/context/ModalContext';
import { useFormOptions } from '@/hooks/useFormOptions';
import { supabase, readableError } from '@/lib/supabase';
import {
  ACCOUNT_TYPES,
  CONTACT_TYPES,
  BUDGET_PERIODS,
  FREQUENCIES,
  PAYMENT_METHODS,
  CURRENCIES,
} from '@/lib/constants';
import { toISODate } from '@/lib/format';
import { GOAL_ICONS, CATEGORY_ICONS } from '@/lib/icons';
import { icon as resolveIcon } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   SHARED PLUMBING
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every record form follows the same shape: seed state when the modal opens,
 * validate, then insert or update. This hook holds that shared behaviour so
 * each form below is only its fields and its rules.
 */
function useRecordForm({ open, record, table, initial, onClose, successText }) {
  const { user } = useAuth();
  const { writeWorkspace } = useWorkspace();
  const toast = useToast();
  const { notifySaved } = useModals();

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(record?.id);

  useEffect(() => {
    if (!open) return;
    setForm(record ? { ...initial, ...record } : initial);
    setErrors({});
    // `initial` is rebuilt on every render by design — only re-seed on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record]);

  const set = (key) => (e) => {
    const value = e?.target
      ? e.target.type === 'checkbox'
        ? e.target.checked
        : e.target.value
      : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const save = async (buildPayload, validate) => {
    const found = validate ? validate(form) : {};
    setErrors(found);
    if (Object.keys(found).length || !user) return;

    setSaving(true);
    // The workspace default comes first so a form that returns its own
    // `workspace_id` — categories use null to mean "shared" — can override it.
    const payload = {
      workspace_id: form.workspace_id || writeWorkspace?.id,
      ...buildPayload(form),
      user_id: user.id,
    };

    const { error } = isEdit
      ? await supabase.from(table).update(payload).eq('id', record.id)
      : await supabase.from(table).insert(payload);

    setSaving(false);

    if (error) {
      toast.error(readableError(error));
      return;
    }
    toast.success(isEdit ? 'Changes saved.' : successText);
    notifySaved();
    onClose();
  };

  return { form, setForm, set, errors, setErrors, saving, isEdit, save };
}

/** Consistent footer for every record modal. */
function Footer({ onClose, onSave, saving, isEdit, label }) {
  return (
    <>
      <Button variant="secondary" size="sm" type="button" onClick={onClose}>
        Cancel
      </Button>
      <Button size="sm" type="button" onClick={onSave} loading={saving}>
        {isEdit ? 'Save changes' : label}
      </Button>
    </>
  );
}

/** Workspace picker, shown only when Combined mode leaves the target ambiguous. */
function WorkspaceField({ value, onChange, error }) {
  const { isCombined, workspaces } = useWorkspace();
  if (!isCombined) return null;
  return (
    <Select label="Workspace" value={value || ''} onChange={onChange} error={error}>
      <option value="">Select workspace…</option>
      {workspaces.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </Select>
  );
}

const required = (value, message) => (String(value ?? '').trim() ? null : message);
const positive = (value, message) =>
  Number(value) > 0 && !Number.isNaN(Number(value)) ? null : message;

function collect(pairs) {
  return Object.fromEntries(Object.entries(pairs).filter(([, v]) => Boolean(v)));
}

/* ══════════════════════════════════════════════════════════════════════════
   ACCOUNT
   ══════════════════════════════════════════════════════════════════════════ */
export function AccountForm({ open, onClose, record }) {
  const { writeWorkspace } = useWorkspace();
  const initial = {
    name: '',
    type: 'bank',
    institution: '',
    account_number: '',
    currency: 'INR',
    opening_balance: '',
    credit_limit: '',
    notes: '',
    is_primary: false,
    workspace_id: writeWorkspace?.id || '',
  };

  const { form, set, errors, saving, isEdit, save } = useRecordForm({
    open,
    record,
    table: 'accounts',
    initial,
    onClose,
    successText: 'Account added.',
  });

  const onSave = () =>
    save(
      (f) => ({
        name: f.name.trim(),
        type: f.type,
        institution: f.institution?.trim() || null,
        account_number: f.account_number?.trim() || null,
        currency: f.currency,
        // Opening balance seeds the ledger only on creation; editing it later
        // would silently rewrite history, so it is left alone on update.
        ...(isEdit ? {} : { opening_balance: Number(f.opening_balance) || 0 }),
        credit_limit: f.credit_limit ? Number(f.credit_limit) : null,
        notes: f.notes?.trim() || null,
        is_primary: Boolean(f.is_primary),
      }),
      (f) =>
        collect({
          name: required(f.name, 'Give the account a name.'),
          workspace_id: required(f.workspace_id, 'Choose a workspace.'),
        }),
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Account' : 'Add Account'}
      subtitle="Bank, cash, card or investment — every balance in one place."
      footer={<Footer onClose={onClose} onSave={onSave} saving={saving} isEdit={isEdit} label="Add account" />}
    >
      <div className="space-y-5">
        <WorkspaceField value={form.workspace_id} onChange={set('workspace_id')} error={errors.workspace_id} />

        <Input label="Account name" value={form.name} onChange={set('name')} placeholder="HDFC Savings" error={errors.name} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Type" value={form.type} onChange={set('type')}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select label="Currency" value={form.currency} onChange={set('currency')}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Institution" value={form.institution} onChange={set('institution')} placeholder="HDFC Bank" />
          <Input
            label="Account number"
            value={form.account_number}
            onChange={set('account_number')}
            placeholder="XXXX 4421"
            hint="Store the masked digits only."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {!isEdit && (
            <Input
              label="Opening balance"
              type="number"
              step="0.01"
              value={form.opening_balance}
              onChange={set('opening_balance')}
              placeholder="0"
            />
          )}
          {form.type === 'credit_card' && (
            <Input
              label="Credit limit"
              type="number"
              step="0.01"
              value={form.credit_limit}
              onChange={set('credit_limit')}
              placeholder="500000"
            />
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-hair bg-surface px-4 py-3">
          <input
            type="checkbox"
            checked={Boolean(form.is_primary)}
            onChange={set('is_primary')}
            className="h-4 w-4 accent-[#C8FF00]"
          />
          <span className="text-[13px] text-ink-dim">Make this the primary account for the workspace</span>
        </label>

        <Textarea label="Notes" value={form.notes || ''} onChange={set('notes')} placeholder="Optional" />
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PAYMENT
   ══════════════════════════════════════════════════════════════════════════ */
export function PaymentForm({ open, onClose, record, direction = 'outgoing' }) {
  const { writeWorkspace } = useWorkspace();
  const initial = {
    name: '',
    direction,
    status: 'upcoming',
    amount: '',
    due_date: toISODate(),
    paid_date: '',
    method: 'Bank Transfer',
    reference: '',
    notes: '',
    contact_id: '',
    account_id: '',
    workspace_id: writeWorkspace?.id || '',
  };

  const { form, set, errors, saving, isEdit, save } = useRecordForm({
    open,
    record,
    table: 'payments',
    initial,
    onClose,
    successText: 'Payment scheduled.',
  });

  const { accounts, contacts } = useFormOptions(form.workspace_id);

  const onSave = () =>
    save(
      (f) => ({
        name: f.name.trim(),
        direction: f.direction,
        status: f.status,
        amount: Number(f.amount),
        due_date: f.due_date,
        paid_date: f.status === 'paid' ? f.paid_date || toISODate() : null,
        method: f.method || null,
        reference: f.reference?.trim() || null,
        notes: f.notes?.trim() || null,
        contact_id: f.contact_id || null,
        account_id: f.account_id || null,
      }),
      (f) =>
        collect({
          name: required(f.name, 'Name this payment.'),
          amount: positive(f.amount, 'Enter an amount greater than zero.'),
          due_date: required(f.due_date, 'Pick a due date.'),
          workspace_id: required(f.workspace_id, 'Choose a workspace.'),
        }),
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Payment' : 'Record Payment'}
      subtitle="Track money leaving or arriving on a schedule."
      footer={<Footer onClose={onClose} onSave={onSave} saving={saving} isEdit={isEdit} label="Save payment" />}
    >
      <div className="space-y-5">
        <WorkspaceField value={form.workspace_id} onChange={set('workspace_id')} error={errors.workspace_id} />

        <Input label="Payment name" value={form.name} onChange={set('name')} placeholder="Dell Technologies" error={errors.name} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Amount" type="number" step="0.01" value={form.amount} onChange={set('amount')} placeholder="0" error={errors.amount} />
          <Input label="Due date" type="date" value={form.due_date} onChange={set('due_date')} error={errors.due_date} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Direction" value={form.direction} onChange={set('direction')}>
            <option value="outgoing">Outgoing — money leaves</option>
            <option value="incoming">Incoming — money arrives</option>
          </Select>
          <Select label="Status" value={form.status} onChange={set('status')}>
            <option value="upcoming">Upcoming</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>

        {form.status === 'paid' && (
          <Input label="Paid on" type="date" value={form.paid_date || toISODate()} onChange={set('paid_date')} />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Account" value={form.account_id} onChange={set('account_id')}>
            <option value="">None</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select label="Contact" value={form.contact_id} onChange={set('contact_id')}>
            <option value="">None</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <Select label="Method" value={form.method} onChange={set('method')}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>

        <Textarea label="Notes" value={form.notes || ''} onChange={set('notes')} placeholder="Optional" />
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   GOAL
   ══════════════════════════════════════════════════════════════════════════ */
export function GoalForm({ open, onClose, record }) {
  const { writeWorkspace } = useWorkspace();
  const initial = {
    name: '',
    description: '',
    icon: 'target',
    color: '#C8FF00',
    target_amount: '',
    current_amount: '',
    target_date: '',
    status: 'active',
    workspace_id: writeWorkspace?.id || '',
  };

  const { form, set, errors, saving, isEdit, save } = useRecordForm({
    open,
    record,
    table: 'financial_goals',
    initial,
    onClose,
    successText: 'Goal created.',
  });

  const onSave = () =>
    save(
      (f) => ({
        name: f.name.trim(),
        description: f.description?.trim() || null,
        icon: f.icon,
        color: f.color,
        target_amount: Number(f.target_amount),
        current_amount: Number(f.current_amount) || 0,
        target_date: f.target_date || null,
        status: f.status,
      }),
      (f) =>
        collect({
          name: required(f.name, 'Name your goal.'),
          target_amount: positive(f.target_amount, 'Set a target above zero.'),
          workspace_id: required(f.workspace_id, 'Choose a workspace.'),
        }),
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Goal' : 'New Goal'}
      subtitle="Name the target, then watch the bar fill."
      footer={<Footer onClose={onClose} onSave={onSave} saving={saving} isEdit={isEdit} label="Create goal" />}
    >
      <div className="space-y-5">
        <WorkspaceField value={form.workspace_id} onChange={set('workspace_id')} error={errors.workspace_id} />

        <Input label="Goal name" value={form.name} onChange={set('name')} placeholder="New Car" error={errors.name} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Target amount" type="number" step="0.01" value={form.target_amount} onChange={set('target_amount')} placeholder="1000000" error={errors.target_amount} />
          <Input label="Saved so far" type="number" step="0.01" value={form.current_amount} onChange={set('current_amount')} placeholder="0" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Target date" type="date" value={form.target_date || ''} onChange={set('target_date')} />
          <Select label="Status" value={form.status} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="achieved">Achieved</option>
            <option value="archived">Archived</option>
          </Select>
        </div>

        <div>
          <p className="field-label">Icon</p>
          <div className="flex flex-wrap gap-2">
            {GOAL_ICONS.map((name) => {
              const Glyph = resolveIcon(name, 'Target');
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => set('icon')(name)}
                  aria-label={name}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
                    form.icon === name
                      ? 'border-accent/45 bg-accent/10 text-accent'
                      : 'border-hair bg-surface text-ink-muted hover:text-ink-dim'
                  }`}
                >
                  <Glyph size={16} strokeWidth={1.9} />
                </button>
              );
            })}
          </div>
        </div>

        <Textarea label="Description" value={form.description || ''} onChange={set('description')} placeholder="Optional" />
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   BUDGET
   ══════════════════════════════════════════════════════════════════════════ */
export function BudgetForm({ open, onClose, record }) {
  const { writeWorkspace } = useWorkspace();
  const initial = {
    name: '',
    amount: '',
    period: 'monthly',
    category_id: '',
    alert_threshold: 80,
    rollover: false,
    is_active: true,
    start_date: toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    workspace_id: writeWorkspace?.id || '',
  };

  const { form, set, errors, saving, isEdit, save } = useRecordForm({
    open,
    record,
    table: 'budgets',
    initial,
    onClose,
    successText: 'Budget created.',
  });

  const { categoriesByKind } = useFormOptions(form.workspace_id);

  const onSave = () =>
    save(
      (f) => ({
        name: f.name.trim(),
        amount: Number(f.amount),
        period: f.period,
        category_id: f.category_id || null,
        alert_threshold: Number(f.alert_threshold) || 80,
        rollover: Boolean(f.rollover),
        is_active: Boolean(f.is_active),
        start_date: f.start_date,
      }),
      (f) =>
        collect({
          name: required(f.name, 'Name this budget.'),
          amount: positive(f.amount, 'Set a limit above zero.'),
          workspace_id: required(f.workspace_id, 'Choose a workspace.'),
        }),
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Budget' : 'New Budget'}
      subtitle="Cap a category, get warned before you cross it."
      footer={<Footer onClose={onClose} onSave={onSave} saving={saving} isEdit={isEdit} label="Create budget" />}
    >
      <div className="space-y-5">
        <WorkspaceField value={form.workspace_id} onChange={set('workspace_id')} error={errors.workspace_id} />

        <Input label="Budget name" value={form.name} onChange={set('name')} placeholder="Marketing Spend" error={errors.name} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Limit" type="number" step="0.01" value={form.amount} onChange={set('amount')} placeholder="75000" error={errors.amount} />
          <Select label="Period" value={form.period} onChange={set('period')}>
            {BUDGET_PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>

        <Select label="Category" value={form.category_id} onChange={set('category_id')} hint="Leave blank to cap all spending in the workspace.">
          <option value="">All categories</option>
          {(categoriesByKind.expense || []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>

        <div>
          <label htmlFor="alert" className="field-label">
            Alert me at {form.alert_threshold}% of the limit
          </label>
          <input
            id="alert"
            type="range"
            min="10"
            max="100"
            step="5"
            value={form.alert_threshold}
            onChange={set('alert_threshold')}
            className="w-full accent-[#C8FF00]"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-hair bg-surface px-4 py-3">
          <input type="checkbox" checked={Boolean(form.rollover)} onChange={set('rollover')} className="h-4 w-4 accent-[#C8FF00]" />
          <span className="text-[13px] text-ink-dim">Roll unused budget into the next period</span>
        </label>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CONTACT
   ══════════════════════════════════════════════════════════════════════════ */
export function ContactForm({ open, onClose, record }) {
  const { writeWorkspace } = useWorkspace();
  const initial = {
    name: '',
    type: 'customer',
    company: '',
    email: '',
    phone: '',
    gstin: '',
    address: '',
    city: '',
    country: 'India',
    notes: '',
    is_active: true,
    workspace_id: writeWorkspace?.id || '',
  };

  const { form, set, errors, saving, isEdit, save } = useRecordForm({
    open,
    record,
    table: 'contacts',
    initial,
    onClose,
    successText: 'Contact added.',
  });

  const onSave = () =>
    save(
      (f) => ({
        name: f.name.trim(),
        type: f.type,
        company: f.company?.trim() || null,
        email: f.email?.trim() || null,
        phone: f.phone?.trim() || null,
        gstin: f.gstin?.trim() || null,
        address: f.address?.trim() || null,
        city: f.city?.trim() || null,
        country: f.country?.trim() || null,
        notes: f.notes?.trim() || null,
        is_active: Boolean(f.is_active),
      }),
      (f) =>
        collect({
          name: required(f.name, 'Enter a name.'),
          email:
            f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) ? 'That email does not look right.' : null,
          workspace_id: required(f.workspace_id, 'Choose a workspace.'),
        }),
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Contact' : 'Add Contact'}
      subtitle="Customers, vendors and everyone you bill."
      footer={<Footer onClose={onClose} onSave={onSave} saving={saving} isEdit={isEdit} label="Add contact" />}
    >
      <div className="space-y-5">
        <WorkspaceField value={form.workspace_id} onChange={set('workspace_id')} error={errors.workspace_id} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" value={form.name} onChange={set('name')} placeholder="ABC Tech Solutions" error={errors.name} />
          <Select label="Type" value={form.type} onChange={set('type')}>
            {CONTACT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>

        <Input label="Company" value={form.company || ''} onChange={set('company')} placeholder="ABC Tech Pvt Ltd" />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Email" type="email" value={form.email || ''} onChange={set('email')} placeholder="accounts@abctech.in" error={errors.email} />
          <Input label="Phone" value={form.phone || ''} onChange={set('phone')} placeholder="+91 98400 11223" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="GSTIN" value={form.gstin || ''} onChange={set('gstin')} placeholder="33AABCU9603R1ZM" />
          <Input label="City" value={form.city || ''} onChange={set('city')} placeholder="Chennai" />
        </div>

        <Textarea label="Address" value={form.address || ''} onChange={set('address')} placeholder="Optional" />
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CATEGORY
   ══════════════════════════════════════════════════════════════════════════ */
export function CategoryForm({ open, onClose, record }) {
  const initial = {
    name: '',
    kind: 'expense',
    icon: 'tag',
    color: '#C8FF00',
    workspace_id: '', // null ⇒ shared across both workspaces
    sort_order: 50,
  };

  const { form, set, errors, saving, isEdit, save } = useRecordForm({
    open,
    record,
    table: 'categories',
    initial,
    onClose,
    successText: 'Category added.',
  });

  const { workspaces } = useWorkspace();
  const PALETTE = ['#C8FF00', '#A8E600', '#89BF00', '#FFB547', '#7DD3FC', '#A78BFA', '#F472B6', '#FF5C6C', '#6B7280'];

  const onSave = () =>
    save(
      (f) => ({
        name: f.name.trim(),
        kind: f.kind,
        icon: f.icon || 'tag',
        color: f.color,
        sort_order: Number(f.sort_order) || 50,
        // Explicit null keeps the category shared; useRecordForm would
        // otherwise fall back to the active workspace.
        workspace_id: f.workspace_id || null,
      }),
      (f) => collect({ name: required(f.name, 'Name the category.') }),
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Category' : 'New Category'}
      subtitle="Group transactions so reports mean something."
      footer={<Footer onClose={onClose} onSave={onSave} saving={saving} isEdit={isEdit} label="Add category" />}
    >
      <div className="space-y-5">
        <Input label="Name" value={form.name} onChange={set('name')} placeholder="Client Entertainment" error={errors.name} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Kind" value={form.kind} onChange={set('kind')}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </Select>
          <Select label="Available in" value={form.workspace_id || ''} onChange={set('workspace_id')}>
            <option value="">Both workspaces</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} only
              </option>
            ))}
          </Select>
        </div>

        <div>
          <p className="field-label">Colour</p>
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => set('color')(hex)}
                aria-label={`Colour ${hex}`}
                className={`h-9 w-9 rounded-xl border-2 transition-transform duration-200 ${
                  form.color === hex ? 'scale-110 border-ink' : 'border-transparent hover:scale-105'
                }`}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="field-label">Icon</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_ICONS.map((name) => {
              const Glyph = resolveIcon(name, 'Tag');
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => set('icon')(name)}
                  aria-label={name}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
                    form.icon === name
                      ? 'border-accent/45 bg-accent/10 text-accent'
                      : 'border-hair bg-surface text-ink-muted hover:text-ink-dim'
                  }`}
                >
                  <Glyph size={16} strokeWidth={1.9} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   RECURRING
   ══════════════════════════════════════════════════════════════════════════ */
export function RecurringForm({ open, onClose, record }) {
  const { writeWorkspace } = useWorkspace();
  const initial = {
    name: '',
    type: 'expense',
    amount: '',
    frequency: 'monthly',
    interval_count: 1,
    start_date: toISODate(),
    next_run_date: toISODate(),
    end_date: '',
    account_id: '',
    category_id: '',
    contact_id: '',
    description: '',
    auto_post: false,
    is_active: true,
    workspace_id: writeWorkspace?.id || '',
  };

  const { form, set, errors, saving, isEdit, save } = useRecordForm({
    open,
    record,
    table: 'recurring_transactions',
    initial,
    onClose,
    successText: 'Recurring rule created.',
  });

  const { accounts, categoriesByKind, contacts } = useFormOptions(form.workspace_id);
  const categories = categoriesByKind[form.type] || [];

  const onSave = () =>
    save(
      (f) => ({
        name: f.name.trim(),
        type: f.type,
        amount: Number(f.amount),
        frequency: f.frequency,
        interval_count: Number(f.interval_count) || 1,
        start_date: f.start_date,
        next_run_date: f.next_run_date || f.start_date,
        end_date: f.end_date || null,
        account_id: f.account_id || null,
        category_id: f.category_id || null,
        contact_id: f.contact_id || null,
        description: f.description?.trim() || null,
        auto_post: Boolean(f.auto_post),
        is_active: Boolean(f.is_active),
      }),
      (f) =>
        collect({
          name: required(f.name, 'Name this rule.'),
          amount: positive(f.amount, 'Enter an amount above zero.'),
          workspace_id: required(f.workspace_id, 'Choose a workspace.'),
        }),
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Recurring' : 'New Recurring Rule'}
      subtitle="Rent, salaries, subscriptions — set once, posted on schedule."
      footer={<Footer onClose={onClose} onSave={onSave} saving={saving} isEdit={isEdit} label="Create rule" />}
    >
      <div className="space-y-5">
        <WorkspaceField value={form.workspace_id} onChange={set('workspace_id')} error={errors.workspace_id} />

        <Input label="Name" value={form.name} onChange={set('name')} placeholder="Office Rent" error={errors.name} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Type" value={form.type} onChange={(e) => { set('type')(e); set('category_id')(''); }}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </Select>
          <Input label="Amount" type="number" step="0.01" value={form.amount} onChange={set('amount')} placeholder="60000" error={errors.amount} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Frequency" value={form.frequency} onChange={set('frequency')}>
            {FREQUENCIES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
          <Input label="Next run" type="date" value={form.next_run_date} onChange={set('next_run_date')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Account" value={form.account_id} onChange={set('account_id')}>
            <option value="">None</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select label="Category" value={form.category_id} onChange={set('category_id')}>
            <option value="">Uncategorised</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        {contacts.length > 0 && (
          <Select label="Contact" value={form.contact_id} onChange={set('contact_id')}>
            <option value="">None</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}

        <Input label="Ends on" type="date" value={form.end_date || ''} onChange={set('end_date')} hint="Leave blank to repeat indefinitely." />

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-hair bg-surface px-4 py-3">
          <input type="checkbox" checked={Boolean(form.auto_post)} onChange={set('auto_post')} className="mt-0.5 h-4 w-4 accent-[#C8FF00]" />
          <span className="text-[13px] leading-relaxed text-ink-dim">
            Post automatically
            <span className="mt-0.5 block text-[11.5px] text-ink-muted">
              Creates the transaction on its due date. Leave off to be reminded instead.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
