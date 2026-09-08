import { useState, useEffect, useMemo } from 'react';
import { Modal, Button, Input, Select, Textarea } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { useModals } from '@/context/ModalContext';
import { useFormOptions } from '@/hooks/useFormOptions';
import { supabase, readableError } from '@/lib/supabase';
import {
  BILLING_CYCLES,
  SUBSCRIPTION_ICONS,
  PAYMENT_METHODS,
  CURRENCIES,
} from '@/lib/constants';
import { toISODate, formatMoney } from '@/lib/format';
import { icon as resolveIcon, cx } from '@/lib/utils';

const blank = (workspaceId = '') => ({
  name: '',
  vendor: '',
  plan: '',
  amount: '',
  currency: 'INR',
  billing_cycle: 'monthly',
  cycle_count: 1,
  status: 'active',
  started_on: toISODate(),
  next_renewal_date: toISODate(),
  trial_ends_on: '',
  ends_on: '',
  account_id: '',
  category_id: '',
  payment_method: 'Auto Debit',
  auto_renew: true,
  auto_post: false,
  remind_by_email: true,
  reminder_days_before: '',
  cancel_url: '',
  website: '',
  icon: 'monitor',
  color: '#C8FF00',
  notes: '',
  workspace_id: workspaceId,
});

/**
 * Add or edit a subscription.
 *
 * The live monthly-equivalent readout is the point of this form: a ₹24,000
 * annual policy and a ₹649 monthly stream are impossible to compare until
 * both are expressed per month.
 */
export function SubscriptionForm({ open, onClose, record }) {
  const { user } = useAuth();
  const { writeWorkspace, workspaces, isCombined } = useWorkspace();
  const toast = useToast();
  const { notifySaved } = useModals();

  const [form, setForm] = useState(() => blank(writeWorkspace?.id));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(record?.id);
  const { accounts, categoriesByKind } = useFormOptions(form.workspace_id);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (record) {
      setForm({
        ...blank(record.workspace_id),
        ...record,
        amount: String(record.amount ?? ''),
        account_id: record.account_id || '',
        category_id: record.category_id || '',
        trial_ends_on: record.trial_ends_on || '',
        ends_on: record.ends_on || '',
        reminder_days_before: record.reminder_days_before ?? '',
        vendor: record.vendor || '',
        plan: record.plan || '',
        cancel_url: record.cancel_url || '',
        website: record.website || '',
        notes: record.notes || '',
      });
    } else {
      setForm(blank(writeWorkspace?.id));
    }
  }, [open, record, writeWorkspace?.id]);

  const set = (key) => (e) => {
    const value = e?.target
      ? e.target.type === 'checkbox'
        ? e.target.checked
        : e.target.value
      : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  /* Mirrors subscription_monthly_cost() in Postgres. */
  const monthly = useMemo(() => {
    const amount = Number(form.amount) || 0;
    const count = Math.max(Number(form.cycle_count) || 1, 1);
    const cycle = BILLING_CYCLES.find((c) => c.id === form.billing_cycle);
    return (amount * (cycle?.perMonth ?? 1)) / count;
  }, [form.amount, form.billing_cycle, form.cycle_count]);

  const submit = async () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Name the subscription.';
    if (!form.amount || Number(form.amount) < 0) next.amount = 'Enter the amount charged.';
    if (!form.workspace_id) next.workspace_id = 'Choose a workspace.';
    if (!form.next_renewal_date) next.next_renewal_date = 'When does it renew next?';
    if (form.status === 'trial' && !form.trial_ends_on) {
      next.trial_ends_on = 'A trial needs an end date so you can be warned.';
    }

    setErrors(next);
    if (Object.keys(next).length || !user) return;

    setSaving(true);

    const payload = {
      user_id: user.id,
      workspace_id: form.workspace_id,
      name: form.name.trim(),
      vendor: form.vendor?.trim() || null,
      plan: form.plan?.trim() || null,
      amount: Number(form.amount),
      currency: form.currency,
      billing_cycle: form.billing_cycle,
      cycle_count: Math.max(Number(form.cycle_count) || 1, 1),
      status: form.status,
      started_on: form.started_on || toISODate(),
      next_renewal_date: form.next_renewal_date,
      trial_ends_on: form.trial_ends_on || null,
      ends_on: form.ends_on || null,
      account_id: form.account_id || null,
      category_id: form.category_id || null,
      payment_method: form.payment_method || null,
      auto_renew: Boolean(form.auto_renew),
      auto_post: Boolean(form.auto_post),
      remind_by_email: Boolean(form.remind_by_email),
      reminder_days_before:
        form.reminder_days_before === '' ? null : Number(form.reminder_days_before),
      cancel_url: form.cancel_url?.trim() || null,
      website: form.website?.trim() || null,
      icon: form.icon,
      color: form.color,
      notes: form.notes?.trim() || null,
    };

    const { error } = isEdit
      ? await supabase.from('subscriptions').update(payload).eq('id', record.id)
      : await supabase.from('subscriptions').insert(payload);

    setSaving(false);

    if (error) {
      toast.error(readableError(error));
      return;
    }

    // Refresh this user's reminder queue so the change takes effect tonight.
    await supabase.rpc('generate_reminders').catch(() => {});

    toast.success(isEdit ? 'Subscription updated.' : `${form.name.trim()} is now tracked.`);
    notifySaved();
    onClose();
  };

  const PALETTE = ['#C8FF00', '#A8E600', '#7DD3FC', '#A78BFA', '#FF5C6C', '#FFB547', '#F472B6', '#6B7280'];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Edit Subscription' : 'Add Subscription'}
      subtitle="Netflix, insurance, the gym — anything that bills you on a cycle."
      footer={
        <>
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="button" onClick={submit} loading={saving}>
            {isEdit ? 'Save changes' : 'Track subscription'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
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
          <Input label="Name" value={form.name} onChange={set('name')} placeholder="Netflix" error={errors.name} />
          <Input label="Provider" value={form.vendor} onChange={set('vendor')} placeholder="Netflix Inc." />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Plan" value={form.plan} onChange={set('plan')} placeholder="Premium 4K" />
          <Select label="Payment method" value={form.payment_method} onChange={set('payment_method')}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>

        {/* Cost */}
        <div className="rounded-2xl border border-hair bg-surface p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Amount"
              type="number"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={set('amount')}
              placeholder="649"
              error={errors.amount}
            />
            <Select label="Billed" value={form.billing_cycle} onChange={set('billing_cycle')}>
              {BILLING_CYCLES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
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

          {Number(form.amount) > 0 && form.billing_cycle !== 'lifetime' && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-hair-soft pt-3">
              <span className="text-[12px] text-ink-muted">Works out to</span>
              <span className="text-[13px] font-semibold tnum text-accent">
                {formatMoney(monthly, { currency: form.currency })} / month
                <span className="ml-2 font-normal text-ink-muted">
                  · {formatMoney(monthly * 12, { currency: form.currency })} a year
                </span>
              </span>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Status" value={form.status} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="trial">Free trial</option>
            <option value="paused">Paused</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <Input
            label="Next renewal"
            type="date"
            value={form.next_renewal_date}
            onChange={set('next_renewal_date')}
            error={errors.next_renewal_date}
          />
        </div>

        {form.status === 'trial' && (
          <Input
            label="Trial ends on"
            type="date"
            value={form.trial_ends_on}
            onChange={set('trial_ends_on')}
            error={errors.trial_ends_on}
            hint="You will be emailed before it converts to a paid plan."
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Charged to" value={form.account_id} onChange={set('account_id')}>
            <option value="">No account linked</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select label="Category" value={form.category_id} onChange={set('category_id')}>
            <option value="">Uncategorised</option>
            {(categoriesByKind.expense || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        {/* Reminders */}
        <div className="rounded-2xl border border-hair bg-surface p-4">
          <p className="mb-3 text-[13px] font-medium text-ink">Reminders</p>

          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={Boolean(form.remind_by_email)}
              onChange={set('remind_by_email')}
              className="mt-0.5 h-4 w-4 accent-[#C8FF00]"
            />
            <span className="text-[13px] leading-relaxed text-ink-dim">
              Email me before it renews
              <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                Sent to the address in Settings. Turn all reminder email off there.
              </span>
            </span>
          </label>

          {form.remind_by_email && (
            <div className="mt-4">
              <Input
                label="Days before renewal"
                type="number"
                min="0"
                max="60"
                value={form.reminder_days_before}
                onChange={set('reminder_days_before')}
                placeholder="Use my default"
                hint="Leave blank to use the account-wide lead time."
              />
            </div>
          )}
        </div>

        {/* Automation */}
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-hair bg-surface px-4 py-3">
            <input type="checkbox" checked={Boolean(form.auto_renew)} onChange={set('auto_renew')} className="h-4 w-4 accent-[#C8FF00]" />
            <span className="text-[13px] text-ink-dim">Renews automatically</span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-hair bg-surface px-4 py-3">
            <input type="checkbox" checked={Boolean(form.auto_post)} onChange={set('auto_post')} className="mt-0.5 h-4 w-4 accent-[#C8FF00]" />
            <span className="text-[13px] leading-relaxed text-ink-dim">
              Post the charge to my ledger
              <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                Writes an expense automatically on each renewal date.
              </span>
            </span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Website" value={form.website} onChange={set('website')} placeholder="https://netflix.com" />
          <Input label="Cancel link" value={form.cancel_url} onChange={set('cancel_url')} placeholder="Direct link to cancel" />
        </div>

        {/* Appearance */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="field-label">Icon</p>
            <div className="flex flex-wrap gap-2">
              {SUBSCRIPTION_ICONS.map((name) => {
                const Glyph = resolveIcon(name, 'Repeat');
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => set('icon')(name)}
                    aria-label={name}
                    className={cx(
                      'flex h-10 w-10 items-center justify-center rounded-xl border transition-colors',
                      form.icon === name
                        ? 'border-accent/45 bg-accent/10 text-accent'
                        : 'border-hair bg-surface text-ink-muted hover:text-ink-dim',
                    )}
                  >
                    <Glyph size={16} strokeWidth={1.9} />
                  </button>
                );
              })}
            </div>
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
                  className={cx(
                    'h-9 w-9 rounded-xl border-2 transition-transform duration-200',
                    form.color === hex ? 'scale-110 border-ink' : 'border-transparent hover:scale-105',
                  )}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>
        </div>

        <Textarea label="Notes" value={form.notes} onChange={set('notes')} placeholder="Optional" />
      </div>
    </Modal>
  );
}

export default SubscriptionForm;
