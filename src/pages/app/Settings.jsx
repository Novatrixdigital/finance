import { useState, useEffect } from 'react';
import {
  Shield,
  Bell,
  Send,
  DatabaseZap,
  Trash2,
  LogOut,
  Check,
  Sun,
  Moon,
  Upload,
  Loader2,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, Button, Input, Select, Avatar, ConfirmDialog, Badge } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { supabase, readableError, uploadFile } from '@/lib/supabase';
import { CURRENCIES, SCOPE_LIST } from '@/lib/constants';
import { cx } from '@/lib/utils';

export default function Settings() {
  const { profile, user, updateProfile, signOut, refresh } = useAuth();
  const { theme, setTheme } = useTheme();
  const { workspaces, scope, setScope } = useWorkspace();
  const toast = useToast();

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    company_name: '',
    currency: 'INR',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [password, setPassword] = useState({ next: '', confirm: '' });
  const [changing, setChanging] = useState(false);

  const [notify, setNotify] = useState({
    email_reminders: true,
    reminder_lead_days: 3,
    weekly_digest: false,
    notify_email: '',
  });
  const [savingNotify, setSavingNotify] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setForm({
      full_name: profile.full_name || '',
      phone: profile.phone || '',
      company_name: profile.company_name || '',
      currency: profile.currency || 'INR',
    });
    setNotify({
      email_reminders: profile.email_reminders ?? true,
      reminder_lead_days: profile.reminder_lead_days ?? 3,
      weekly_digest: profile.weekly_digest ?? false,
      notify_email: profile.notify_email || '',
    });
  }, [profile]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const saveProfile = async () => {
    setSaving(true);
    const { error } = await updateProfile(form);
    setSaving(false);
    if (error) toast.error(error);
    else toast.success('Profile updated.');
  };

  const onAvatar = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    try {
      const { url } = await uploadFile('avatars', user.id, file, 'avatar-');
      await updateProfile({ avatar_url: url });
      toast.success('Photo updated.');
    } catch (err) {
      toast.error(readableError(err));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const changePassword = async () => {
    if (password.next.length < 8) return toast.error('Use at least 8 characters.');
    if (password.next !== password.confirm) return toast.error('The two passwords do not match.');

    setChanging(true);
    const { error } = await supabase.auth.updateUser({ password: password.next });
    setChanging(false);

    if (error) toast.error(readableError(error));
    else {
      toast.success('Password changed.');
      setPassword({ next: '', confirm: '' });
    }
  };

  const saveNotify = async () => {
    setSavingNotify(true);
    const { error } = await updateProfile({
      email_reminders: Boolean(notify.email_reminders),
      reminder_lead_days: Math.min(Math.max(Number(notify.reminder_lead_days) || 0, 0), 30),
      weekly_digest: Boolean(notify.weekly_digest),
      notify_email: notify.notify_email?.trim() || null,
    });
    setSavingNotify(false);
    if (error) toast.error(error);
    else toast.success('Notification preferences saved.');
  };

  /**
   * Queues a reminder addressed to this user only. It goes out on the next
   * send-reminders run — which also proves the Resend key, the From domain
   * and the schedule are all wired up.
   */
  const sendTest = async () => {
    setTesting(true);
    const { data, error } = await supabase.rpc('send_test_reminder');
    setTesting(false);

    if (error) return toast.error(readableError(error));
    if (data?.ok === false) return toast.error(data.error);

    toast.success(
      `Test reminder queued for ${data.email}. It sends on the next reminder run.`,
      7000,
    );
  };

  const loadDemo = async () => {
    setSeeding(true);
    const { data, error } = await supabase.rpc('seed_demo_data');
    setSeeding(false);

    if (error) return toast.error(readableError(error));
    if (data?.ok === false) return toast.error(data.error);

    toast.success('Demo data loaded.');
    refresh();
  };

  const resetData = async () => {
    setResetting(true);
    const { error } = await supabase.rpc('reset_my_data');
    setResetting(false);
    setResetOpen(false);

    if (error) toast.error(readableError(error));
    else {
      toast.success('All financial records cleared.');
      refresh();
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" accent="& preferences." subtitle="Your identity, your workspaces, your data." />

      <div className="space-y-6">
        {/* ── Profile ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader title="Profile" subtitle="How you appear across Novatrix." />

          <div className="mb-6 flex flex-wrap items-center gap-5">
            <Avatar name={form.full_name || 'Novatrix'} src={profile?.avatar_url} size={72} />
            <div>
              <label className="btn-secondary btn-sm cursor-pointer">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Change photo
                <input type="file" accept="image/*" onChange={onAvatar} className="hidden" disabled={uploading} />
              </label>
              <p className="mt-2 text-[11.5px] text-ink-muted">PNG, JPG or WebP. Up to 2 MB.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" value={form.full_name} onChange={set('full_name')} />
            <Input label="Email" value={profile?.email || user?.email || ''} disabled hint="Managed by your sign-in." />
            <Input label="Phone" value={form.phone} onChange={set('phone')} placeholder="+91 98400 11223" />
            <Input label="Company" value={form.company_name} onChange={set('company_name')} placeholder="Novatrix Digital" />
            <Select label="Default currency" value={form.currency} onChange={set('currency')}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>

          <div className="mt-6 flex justify-end">
            <Button size="md" icon={Check} onClick={saveProfile} loading={saving}>
              Save changes
            </Button>
          </div>
        </Card>

        {/* ── Appearance ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader title="Appearance" subtitle="Dark is the house style; light is there when you need it." />

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { id: 'dark', label: 'Dark', desc: 'Charcoal and neon lime', Icon: Moon },
              { id: 'light', label: 'Light', desc: 'Paper and ink', Icon: Sun },
            ].map(({ id, label, desc, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                className={cx(
                  'flex items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-400 ease-premium',
                  theme === id
                    ? 'border-accent/40 bg-lime/[0.07]'
                    : 'border-hair bg-surface hover:border-hair-strong',
                )}
              >
                <span className={cx('icon-tile h-11 w-11', theme === id && 'border-accent/30 text-accent')}>
                  <Icon size={17} strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-ink">{label}</span>
                  <span className="block text-[11.5px] text-ink-muted">{desc}</span>
                </span>
                {theme === id && <Check size={16} className="shrink-0 text-accent" />}
              </button>
            ))}
          </div>
        </Card>

        {/* ── Workspaces ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Workspaces"
            subtitle="Personal and business books stay separate at the database level. Combined only aggregates."
          />

          <div className="mb-5 space-y-2">
            {workspaces.map((w) => (
              <div
                key={w.id}
                className="flex items-center gap-3 rounded-2xl border border-hair bg-surface px-4 py-3.5"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: w.color }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{w.name}</span>
                  <span className="block text-[11.5px] capitalize text-ink-muted">{w.type} workspace</span>
                </span>
                {w.is_default && <Badge tone="lime">Default</Badge>}
              </div>
            ))}
          </div>

          <p className="field-label">Active view</p>
          <div className="grid grid-cols-3 gap-2">
            {SCOPE_LIST.map(({ id, label, hint }) => (
              <button
                key={id}
                type="button"
                onClick={() => setScope(id)}
                className={cx(
                  'rounded-2xl border px-3 py-3 text-center transition-all duration-300',
                  scope === id
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-hair bg-surface text-ink-muted hover:text-ink-dim',
                )}
              >
                <span className="block text-[12.5px] font-semibold">{label}</span>
                <span className="mt-0.5 block text-[10.5px] opacity-70">{hint}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* ── Security ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader title="Security" subtitle="Change the password used to sign in." />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              value={password.next}
              onChange={(e) => setPassword((p) => ({ ...p, next: e.target.value }))}
              placeholder="••••••••"
            />
            <Input
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              value={password.confirm}
              onChange={(e) => setPassword((p) => ({ ...p, confirm: e.target.value }))}
              placeholder="••••••••"
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Shield size={13} className="text-accent" />
              Every record is protected by row-level security — only your session can read it.
            </p>
            <Button variant="secondary" size="md" onClick={changePassword} loading={changing}>
              Update password
            </Button>
          </div>
        </Card>

        {/* ── Notifications ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Reminders & Email"
            subtitle="Renewals, due payments and overdue invoices, delivered before they bite."
          />

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-hair bg-surface px-4 py-3.5">
            <input
              type="checkbox"
              checked={Boolean(notify.email_reminders)}
              onChange={(e) => setNotify((n) => ({ ...n, email_reminders: e.target.checked }))}
              className="mt-0.5 h-4 w-4 accent-[#C8FF00]"
            />
            <span className="text-[13px] leading-relaxed text-ink-dim">
              Email me reminders
              <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                Subscription renewals, trials about to convert, payments falling due and
                invoices going overdue.
              </span>
            </span>
          </label>

          <div className="mt-3 space-y-4">
            <Input
              label="Send to"
              type="email"
              value={notify.notify_email}
              onChange={(e) => setNotify((n) => ({ ...n, notify_email: e.target.value }))}
              placeholder={profile?.email || 'you@company.com'}
              hint="Leave blank to use your sign-in address."
              disabled={!notify.email_reminders}
            />

            <div>
              <label htmlFor="lead" className="field-label">
                Warn me {notify.reminder_lead_days} day
                {Number(notify.reminder_lead_days) === 1 ? '' : 's'} in advance
              </label>
              <input
                id="lead"
                type="range"
                min="0"
                max="30"
                step="1"
                value={notify.reminder_lead_days}
                onChange={(e) => setNotify((n) => ({ ...n, reminder_lead_days: e.target.value }))}
                disabled={!notify.email_reminders}
                className="w-full accent-[#C8FF00] disabled:opacity-40"
              />
              <p className="mt-1.5 text-[11.5px] text-ink-muted">
                Individual subscriptions can override this.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-hair bg-surface px-4 py-3.5">
              <input
                type="checkbox"
                checked={Boolean(notify.weekly_digest)}
                onChange={(e) => setNotify((n) => ({ ...n, weekly_digest: e.target.checked }))}
                disabled={!notify.email_reminders}
                className="mt-0.5 h-4 w-4 accent-[#C8FF00]"
              />
              <span className="text-[13px] leading-relaxed text-ink-dim">
                Weekly summary
                <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                  One Monday email with the week ahead.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Bell size={13} className="text-accent" />
              Delivered by the send-reminders function — your address is never shared.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="md"
                icon={Send}
                onClick={sendTest}
                loading={testing}
                disabled={!notify.email_reminders}
              >
                Send test email
              </Button>
              <Button size="md" icon={Check} onClick={saveNotify} loading={savingNotify}>
                Save preferences
              </Button>
            </div>
          </div>
        </Card>

        {/* ── Data ──────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader title="Data" subtitle="Populate a demo book, or clear everything and start clean." />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-hair bg-surface p-4">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-ink">Load demo data</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                  Six months of transactions, invoices, budgets and goals across both workspaces.
                  Replaces any existing records.
                </p>
              </div>
              <Button variant="secondary" size="sm" icon={DatabaseZap} onClick={loadDemo} loading={seeding}>
                Load demo
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-negative/25 bg-negative/[0.04] p-4">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-ink">Clear all financial data</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                  Deletes every account, transaction, invoice, payment, budget and goal. Your login
                  and workspaces stay.
                </p>
              </div>
              <Button variant="danger" size="sm" icon={Trash2} onClick={() => setResetOpen(true)}>
                Clear data
              </Button>
            </div>
          </div>
        </Card>

        {/* ── Session ───────────────────────────────────────────────────── */}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-ink">Signed in as {profile?.email || user?.email}</p>
              <p className="mt-1 text-[12px] text-ink-muted">
                Member since {profile?.created_at ? new Date(profile.created_at).getFullYear() : '—'}
              </p>
            </div>
            <Button variant="secondary" size="md" icon={LogOut} onClick={signOut}>
              Sign out
            </Button>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={resetData}
        loading={resetting}
        title="Clear all financial data?"
        confirmLabel="Yes, clear everything"
        message="Every account, transaction, invoice, payment, budget, goal and contact will be permanently deleted. This cannot be undone."
      />
    </div>
  );
}
