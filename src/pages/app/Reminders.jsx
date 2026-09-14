import { useState, useMemo, useEffect } from 'react';
import {
  BellRing,
  Trash2,
  Check,
  RefreshCw,
  Mail,
  MailX,
  Plus,
  CalendarClock,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader, StatStrip } from '@/components/layout/PageHeader';
import {
  Card,
  Button,
  Badge,
  EmptyState,
  LoadingBlock,
  Segmented,
  Modal,
  Input,
  Select,
  Textarea,
  ConfirmDialog,
} from '@/components/ui';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { useModals } from '@/context/ModalContext';
import { supabase, readableError } from '@/lib/supabase';
import { formatMoney, formatDate, formatRelativeDate, toISODate } from '@/lib/format';
import { REMINDER_STATUS } from '@/lib/constants';
import { cx } from '@/lib/utils';

const TABS = [
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'sent', label: 'Sent' },
  { id: 'all', label: 'All' },
];

const KIND_TONE = {
  subscription: 'lime',
  payment: 'warning',
  invoice: 'info',
  goal: 'neutral',
  budget: 'negative',
  custom: 'neutral',
};

/* ── Create a one-off reminder ────────────────────────────────────────────── */
function CustomReminderDialog({ open, onClose, onSaved }) {
  const { user } = useAuth();
  const { writeWorkspace, workspaces, isCombined } = useWorkspace();
  const toast = useToast();

  const [form, setForm] = useState({
    title: '',
    body: '',
    amount: '',
    due_on: '',
    remind_on: toISODate(),
    channel: 'email',
    workspace_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    setForm({
      title: '',
      body: '',
      amount: '',
      due_on: '',
      remind_on: toISODate(),
      channel: 'email',
      workspace_id: writeWorkspace?.id || '',
    });
    setErrors({});
  }, [open, writeWorkspace?.id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    const next = {};
    if (!form.title.trim()) next.title = 'What should we remind you about?';
    if (!form.workspace_id) next.workspace_id = 'Choose a workspace.';
    if (!form.remind_on) next.remind_on = 'Pick a date.';
    setErrors(next);
    if (Object.keys(next).length || !user) return;

    setSaving(true);
    const { error } = await supabase.from('reminders').insert({
      user_id: user.id,
      workspace_id: form.workspace_id,
      kind: 'custom',
      title: form.title.trim(),
      body: form.body?.trim() || null,
      amount: form.amount ? Number(form.amount) : null,
      due_on: form.due_on || null,
      // Sent at 07:00 local on the chosen day.
      remind_at: new Date(`${form.remind_on}T07:00:00`).toISOString(),
      channel: form.channel,
      dedupe_key: `custom:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    });
    setSaving(false);

    if (error) return toast.error(readableError(error));
    toast.success('Reminder scheduled.');
    onSaved();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Reminder"
      subtitle="A nudge for anything the app does not already track."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={saving}>
            Schedule
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

        <Input label="Title" value={form.title} onChange={set('title')} placeholder="Renew car insurance" error={errors.title} />
        <Textarea label="Details" value={form.body} onChange={set('body')} placeholder="Optional" />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Remind me on" type="date" value={form.remind_on} onChange={set('remind_on')} error={errors.remind_on} />
          <Input label="Due date" type="date" value={form.due_on} onChange={set('due_on')} hint="Optional" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Amount" type="number" step="0.01" value={form.amount} onChange={set('amount')} placeholder="Optional" />
          <Select label="Send via" value={form.channel} onChange={set('channel')}>
            <option value="email">Email</option>
            <option value="in_app">In-app only</option>
            <option value="both">Both</option>
          </Select>
        </div>
      </div>
    </Modal>
  );
}

export default function Reminders() {
  const { profile, updateProfile } = useAuth();
  const { dirtyToken } = useModals();
  const toast = useToast();

  const [tab, setTab] = useState('scheduled');
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { rows, loading, update, remove, refresh } = useCollection('reminders', {
    select: '*',
    orderBy: { column: 'remind_at', ascending: false },
    limit: 200,
  });

  useEffect(() => {
    if (dirtyToken > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyToken]);

  const filtered = useMemo(() => {
    if (tab === 'all') return rows;
    if (tab === 'sent') return rows.filter((r) => r.status === 'sent');
    return rows.filter((r) => r.status === 'scheduled');
  }, [rows, tab]);

  const counts = useMemo(
    () => ({
      scheduled: rows.filter((r) => r.status === 'scheduled').length,
      sent: rows.filter((r) => r.status === 'sent').length,
      failed: rows.filter((r) => r.status === 'failed').length,
      total: rows.length,
    }),
    [rows],
  );

  /** Rebuilds the queue from current subscriptions, payments and invoices. */
  const rebuild = async () => {
    setRefreshing(true);
    const { data, error } = await supabase.rpc('generate_reminders');
    setRefreshing(false);
    if (error) return toast.error(readableError(error));
    const n = Number(data) || 0;
    toast.success(n ? `Queued ${n} new reminder${n === 1 ? '' : 's'}.` : 'Everything is already queued.');
    refresh();
  };

  const dismiss = async (reminder) => {
    const { error } = await update(reminder.id, { status: 'dismissed' });
    if (!error) toast.success('Reminder dismissed.');
  };

  const confirmDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    const { error } = await remove(confirm.id);
    setDeleting(false);
    if (!error) toast.success('Reminder deleted.');
    setConfirm(null);
  };

  const toggleEmail = async () => {
    const next = !profile?.email_reminders;
    const { error } = await updateProfile({ email_reminders: next });
    if (error) toast.error(error);
    else toast.success(next ? 'Email reminders on.' : 'Email reminders off.');
  };

  const emailOn = Boolean(profile?.email_reminders);

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="Never miss"
        accent="a renewal."
        subtitle="Built automatically from your subscriptions, payments and invoices — and delivered to your inbox."
        actions={
          <>
            <Button variant="secondary" size="md" icon={RefreshCw} onClick={rebuild} loading={refreshing}>
              Rebuild queue
            </Button>
            <Button size="md" icon={Plus} onClick={() => setCreating(true)}>
              New Reminder
            </Button>
          </>
        }
      >
        <StatStrip
          items={[
            { label: 'Scheduled', value: counts.scheduled, tone: 'warning' },
            { label: 'Sent', value: counts.sent, tone: 'lime' },
            { label: 'Failed', value: counts.failed, tone: counts.failed ? 'negative' : undefined },
            { label: 'Total', value: counts.total },
          ]}
        />
      </PageHeader>

      {/* Email delivery state */}
      <Card className={cx('mb-6', emailOn ? 'border-accent/25 bg-accent/[0.04]' : 'border-hair')}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-3">
            <span
              className={cx(
                'icon-tile h-10 w-10 shrink-0',
                emailOn ? 'border-accent/30 bg-accent/10 text-accent' : 'text-ink-muted',
              )}
            >
              {emailOn ? <Mail size={17} strokeWidth={1.9} /> : <MailX size={17} strokeWidth={1.9} />}
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-ink">
                {emailOn ? 'Email reminders are on' : 'Email reminders are off'}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">
                {emailOn ? (
                  <>
                    Sent to{' '}
                    <span className="text-ink">{profile?.notify_email || profile?.email}</span>{' '}
                    {profile?.reminder_lead_days ?? 3} day
                    {(profile?.reminder_lead_days ?? 3) === 1 ? '' : 's'} before something is due.
                  </>
                ) : (
                  'Reminders will still appear here, but nothing will be emailed.'
                )}
              </p>
            </div>
          </div>

          <Button variant="secondary" size="sm" onClick={toggleEmail}>
            {emailOn ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      </Card>

      <div className="mb-6">
        <Segmented options={TABS} value={tab} onChange={setTab} />
      </div>

      {loading ? (
        <Card>
          <LoadingBlock rows={5} />
        </Card>
      ) : !filtered.length ? (
        <Card>
          <EmptyState
            icon={BellRing}
            title={tab === 'sent' ? 'Nothing sent yet' : 'No reminders queued'}
            description="Add a subscription or schedule a payment and Novatrix will queue the nudges for you."
            action={
              <Button variant="secondary" size="sm" icon={RefreshCw} onClick={rebuild} loading={refreshing}>
                Rebuild queue
              </Button>
            }
          />
        </Card>
      ) : (
        <Card pad={false} className="overflow-hidden">
          <ul>
            {filtered.map((r) => {
              const status = REMINDER_STATUS[r.status] || REMINDER_STATUS.scheduled;
              return (
                <li
                  key={r.id}
                  className="group flex items-start gap-4 border-t border-hair-soft px-5 py-4 transition-colors first:border-0 hover:bg-elevated/50"
                >
                  <span
                    className={cx(
                      'icon-tile mt-0.5 h-10 w-10',
                      r.status === 'failed'
                        ? 'border-negative/25 bg-negative/[0.07] text-negative'
                        : r.status === 'sent'
                          ? 'border-accent/25 bg-accent/10 text-accent'
                          : 'text-ink-dim',
                    )}
                  >
                    {r.status === 'failed' ? (
                      <AlertTriangle size={15} strokeWidth={2} />
                    ) : (
                      <CalendarClock size={15} strokeWidth={1.9} />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13.5px] font-medium text-ink">{r.title}</p>
                      <Badge tone={KIND_TONE[r.kind] || 'neutral'} className="capitalize">
                        {r.kind}
                      </Badge>
                    </div>
                    {r.body && <p className="mt-1 truncate text-[12px] text-ink-muted">{r.body}</p>}
                    <p className="mt-1 text-[11.5px] text-ink-muted">
                      {r.status === 'sent' && r.sent_at
                        ? `Sent ${formatRelativeDate(r.sent_at)}`
                        : `Scheduled ${formatRelativeDate(r.remind_at)}`}
                      {r.due_on && <> · due {formatDate(r.due_on)}</>}
                    </p>
                    {r.status === 'failed' && r.last_error && (
                      <p className="mt-1 truncate text-[11px] text-negative">{r.last_error}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {r.amount != null && (
                      <span className="text-[13px] font-semibold tnum text-ink">
                        {formatMoney(r.amount, { currency: r.currency })}
                      </span>
                    )}
                    <Badge className={status.className} dot>
                      {status.label}
                    </Badge>
                    <div className="flex reveal-actions">
                      {r.status === 'scheduled' && (
                        <button
                          type="button"
                          onClick={() => dismiss(r)}
                          aria-label="Dismiss reminder"
                          className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                        >
                          <Check size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirm(r)}
                        aria-label="Delete reminder"
                        className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <CustomReminderDialog open={creating} onClose={() => setCreating(false)} onSaved={refresh} />

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete reminder?"
        message={`"${confirm?.title}" will be removed from the queue.`}
      />
    </div>
  );
}
