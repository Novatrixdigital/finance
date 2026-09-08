/**
 * NOVATRIX DIGITAL — send-reminders
 * ─────────────────────────────────────────────────────────────────────────────
 * Supabase Edge Function (Deno). Picks up due reminders and emails them via
 * Resend.
 *
 * WHY THIS RUNS ON THE SERVER
 * The Resend API key is a secret. Anything in the Vite bundle is public, so the
 * key can never live in the browser. This function holds it, and is the only
 * thing that ever touches the service-role key.
 *
 * DEPLOY
 *   supabase functions deploy send-reminders --no-verify-jwt
 *
 * SECRETS  (Project Settings → Edge Functions → Secrets)
 *   RESEND_API_KEY   re_xxxxxxxxxxxx
 *   RESEND_FROM      "Novatrix Digital <reminders@novatrixdigital.in>"
 *   APP_URL          https://finance.novatrixdigital.in
 *   REMINDER_SECRET  a long random string (see AUTH below)
 *
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
 *
 * AUTH
 * Deployed with --no-verify-jwt so pg_cron can call it. It therefore checks a
 * shared secret itself: send `Authorization: Bearer <SERVICE_ROLE_KEY>` or
 * `x-reminder-secret: <REMINDER_SECRET>`. Without one of those it returns 401.
 *
 * INVOKE
 *   curl -X POST https://<ref>.supabase.co/functions/v1/send-reminders \
 *        -H "Authorization: Bearer $SERVICE_ROLE_KEY"
 *
 * Body options: { "generate": true }  regenerate reminders first
 *               { "limit": 50 }       cap the batch (default 100)
 *               { "dryRun": true }    render but do not send
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM =
  Deno.env.get('RESEND_FROM') ?? 'Novatrix Digital <reminders@novatrixdigital.in>';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finance.novatrixdigital.in';
const REMINDER_SECRET = Deno.env.get('REMINDER_SECRET') ?? '';

const BATCH_DEFAULT = 100;

interface ReminderRow {
  reminder_id: string;
  user_id: string;
  email: string;
  full_name: string;
  title: string;
  body: string | null;
  amount: number | null;
  currency: string;
  due_on: string | null;
  kind: string;
}

/* ── Formatting ───────────────────────────────────────────────────────────── */

function money(amount: number | null, currency = 'INR') {
  if (amount === null || amount === undefined) return '';
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function prettyDate(iso: string | null) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function escapeHtml(text: string) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const DEEP_LINK: Record<string, string> = {
  subscription: '/subscriptions',
  payment: '/payments',
  invoice: '/invoices',
  goal: '/goals',
  budget: '/budgets',
  custom: '/dashboard',
};

/* ── Email template ───────────────────────────────────────────────────────── */
/*
 * Table-based and inline-styled on purpose: Outlook and Gmail strip <style>
 * blocks and ignore flex/grid. The dark ground is baked in rather than relying
 * on prefers-color-scheme, which most clients do not honour.
 */
function renderEmail(r: ReminderRow) {
  const link = `${APP_URL}${DEEP_LINK[r.kind] ?? '/dashboard'}`;
  const amount = money(r.amount, r.currency);
  const due = prettyDate(r.due_on);

  const rows: string[] = [];
  if (amount) {
    rows.push(`
      <tr>
        <td style="padding:6px 0;color:#9CA3AF;font-size:13px;">Amount</td>
        <td style="padding:6px 0;color:#F5F5F5;font-size:15px;font-weight:700;text-align:right;">${escapeHtml(amount)}</td>
      </tr>`);
  }
  if (due) {
    rows.push(`
      <tr>
        <td style="padding:6px 0;color:#9CA3AF;font-size:13px;">Due</td>
        <td style="padding:6px 0;color:#F5F5F5;font-size:15px;font-weight:600;text-align:right;">${escapeHtml(due)}</td>
      </tr>`);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#090B0D;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(r.title)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#090B0D;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#15191C;border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

        <tr><td style="padding:26px 28px 0 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:34px;vertical-align:middle;">
              <div style="width:34px;height:34px;border-radius:10px;background:#1A1F22;text-align:center;line-height:34px;color:#C8FF00;font-size:19px;font-weight:800;">N</div>
            </td>
            <td style="padding-left:11px;vertical-align:middle;">
              <div style="color:#F5F5F5;font-size:14px;font-weight:700;">Novatrix Digital</div>
              <div style="color:#6B7280;font-size:11px;">Finance. Simplified.</div>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:26px 28px 0 28px;">
          <div style="color:#6B7280;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;">Reminder</div>
          <h1 style="margin:12px 0 0 0;color:#F5F5F5;font-size:23px;line-height:1.28;font-weight:800;letter-spacing:-0.4px;">
            ${escapeHtml(r.title)}
          </h1>
          ${r.body ? `<p style="margin:12px 0 0 0;color:#9CA3AF;font-size:14px;line-height:1.6;">${escapeHtml(r.body)}</p>` : ''}
        </td></tr>

        ${rows.length ? `
        <tr><td style="padding:22px 28px 0 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="background:#111416;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px 16px;">
            ${rows.join('')}
          </table>
        </td></tr>` : ''}

        <tr><td style="padding:24px 28px 0 28px;">
          <a href="${link}" style="display:inline-block;background:#C8FF00;color:#000000;text-decoration:none;font-size:14px;font-weight:700;padding:13px 24px;border-radius:999px;">
            Open Novatrix
          </a>
        </td></tr>

        <tr><td style="padding:26px 28px 28px 28px;">
          <div style="height:1px;background:rgba(255,255,255,0.08);margin-bottom:16px;"></div>
          <p style="margin:0;color:#6B7280;font-size:11.5px;line-height:1.6;">
            You are getting this because reminders are switched on for your Novatrix account.
            <a href="${APP_URL}/settings" style="color:#C8FF00;text-decoration:none;">Manage reminders</a>.
          </p>
        </td></tr>

      </table>
      <p style="max-width:520px;margin:16px auto 0 auto;color:#4B5563;font-size:11px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
        © ${new Date().getFullYear()} Novatrix Digital
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function renderText(r: ReminderRow) {
  const lines = [r.title];
  if (r.body) lines.push('', r.body);
  if (r.amount != null) lines.push('', `Amount: ${money(r.amount, r.currency)}`);
  if (r.due_on) lines.push(`Due: ${prettyDate(r.due_on)}`);
  lines.push('', `Open Novatrix: ${APP_URL}${DEEP_LINK[r.kind] ?? '/dashboard'}`);
  lines.push('', `Manage reminders: ${APP_URL}/settings`);
  return lines.join('\n');
}

/* ── Resend ───────────────────────────────────────────────────────────────── */

async function sendViaResend(to: string, subject: string, html: string, text: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html, text }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/* ── Handler ──────────────────────────────────────────────────────────────── */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reminder-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  // Deployed with --no-verify-jwt, so authorise here.
  const auth = req.headers.get('Authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const secret = req.headers.get('x-reminder-secret') ?? '';
  const authorised =
    (bearer && bearer === SERVICE_KEY) ||
    (REMINDER_SECRET && secret === REMINDER_SECRET);

  if (!authorised) return json({ error: 'Unauthorized' }, 401);

  if (!RESEND_API_KEY) {
    return json({ error: 'RESEND_API_KEY is not set on this function.' }, 500);
  }

  let opts: { generate?: boolean; limit?: number; dryRun?: boolean } = {};
  try {
    opts = await req.json();
  } catch {
    /* an empty body is fine */
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let generated = 0;
  if (opts.generate !== false) {
    const { data, error } = await supabase.rpc('generate_all_reminders');
    if (error) return json({ error: `generate_all_reminders: ${error.message}` }, 500);
    generated = Number(data) || 0;
  }

  const { data: batch, error: batchError } = await supabase.rpc('pending_reminder_batch', {
    p_limit: Math.min(Math.max(Number(opts.limit) || BATCH_DEFAULT, 1), 500),
  });
  if (batchError) return json({ error: `pending_reminder_batch: ${batchError.message}` }, 500);

  const rows = (batch ?? []) as ReminderRow[];
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const r of rows) {
    if (opts.dryRun) {
      sent += 1;
      continue;
    }
    try {
      await sendViaResend(r.email, r.title, renderEmail(r), renderText(r));
      await supabase.rpc('mark_reminder_sent', { p_id: r.reminder_id, p_ok: true });
      sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase.rpc('mark_reminder_sent', {
        p_id: r.reminder_id,
        p_ok: false,
        p_error: message.slice(0, 500),
      });
      failed += 1;
      if (errors.length < 5) errors.push(message.slice(0, 200));
    }
  }

  return json({
    ok: true,
    generated,
    queued: rows.length,
    sent,
    failed,
    dryRun: Boolean(opts.dryRun),
    ...(errors.length ? { errors } : {}),
  });
});
