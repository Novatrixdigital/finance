/**
 * NOVATRIX DIGITAL — edge Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Sits in front of the static bundle and does the few things a static file
 * cannot:
 *
 *   GET  /healthz              uptime probe
 *   POST /api/reminders/run    send due reminders through Resend
 *   scheduled()                the same job, on a cron trigger
 *   *                          SPA fallback so deep links do not 404
 *
 * WHY RUNTIME SECRETS LIVE HERE
 * This file runs on Cloudflare's servers, never in the browser. That makes it
 * the correct home for RESEND_API_KEY and SUPABASE_SERVICE_ROLE_KEY — unlike a
 * BUILD variable, which Vite would inline into the public bundle.
 *
 * Bindings (dashboard → Settings → Variables and Secrets, type "Secret"):
 *   SUPABASE_URL                https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   bypasses RLS — server only, never public
 *   RESEND_API_KEY              re_…
 *   RESEND_FROM                 "Novatrix Digital <reminders@novatrixdigital.in>"
 *   APP_URL                     https://finance.novatrixdigital.in
 *   REMINDER_SECRET             long random string; authorises the HTTP route
 *
 * Locally: copy .dev.vars.example to .dev.vars and run `npm run cf:dev`.
 */

/* ── Small helpers ────────────────────────────────────────────────────────── */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function money(amount, currency = 'INR') {
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

function prettyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const escapeHtml = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const DEEP_LINK = {
  subscription: '/subscriptions',
  payment: '/payments',
  invoice: '/invoices',
  goal: '/goals',
  budget: '/budgets',
  custom: '/dashboard',
};

/* ── Email template ───────────────────────────────────────────────────────── */
/*
 * Table-based with inline styles: Gmail and Outlook strip <style> blocks and
 * ignore flex/grid. The dark ground is baked in rather than left to
 * prefers-color-scheme, which most clients do not honour.
 */
function renderEmail(r, appUrl) {
  const link = `${appUrl}${DEEP_LINK[r.kind] ?? '/dashboard'}`;
  const amount = money(r.amount, r.currency);
  const due = prettyDate(r.due_on);

  const row = (label, value, bold) => `
      <tr>
        <td style="padding:6px 0;color:#9CA3AF;font-size:13px;">${label}</td>
        <td style="padding:6px 0;color:#F5F5F5;font-size:15px;font-weight:${bold};text-align:right;">${escapeHtml(value)}</td>
      </tr>`;

  const rows = [amount ? row('Amount', amount, 700) : '', due ? row('Due', due, 600) : ''].join('');

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

        ${rows ? `
        <tr><td style="padding:22px 28px 0 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="background:#111416;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px 16px;">
            ${rows}
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
            <a href="${appUrl}/settings" style="color:#C8FF00;text-decoration:none;">Manage reminders</a>.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

function renderText(r, appUrl) {
  const lines = [r.title];
  if (r.body) lines.push('', r.body);
  if (r.amount != null) lines.push('', `Amount: ${money(r.amount, r.currency)}`);
  if (r.due_on) lines.push(`Due: ${prettyDate(r.due_on)}`);
  lines.push('', `Open Novatrix: ${appUrl}${DEEP_LINK[r.kind] ?? '/dashboard'}`);
  return lines.join('\n');
}

/* ── Supabase RPC over plain fetch (no SDK needed at the edge) ─────────────── */

async function rpc(env, fn, body = {}) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  if (!url) throw new Error('SUPABASE_URL is not bound to this Worker');

  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} → ${res.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

async function sendViaResend(env, to, subject, html, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM || 'Novatrix Digital <reminders@novatrixdigital.in>',
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 240)}`);
  }
  return res.json();
}

/* ── The reminder job ─────────────────────────────────────────────────────── */

async function runReminders(env, options = {}) {
  const missing = ['RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !env[k]);
  if (missing.length) {
    return { ok: false, error: `Missing secret(s): ${missing.join(', ')}` };
  }

  const appUrl = (env.APP_URL || 'https://finance.novatrixdigital.in').replace(/\/+$/, '');

  let generated = 0;
  if (options.generate !== false) {
    generated = Number(await rpc(env, 'generate_all_reminders')) || 0;
  }

  const batch =
    (await rpc(env, 'pending_reminder_batch', {
      p_limit: Math.min(Math.max(Number(options.limit) || 100, 1), 500),
    })) || [];

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const r of batch) {
    if (options.dryRun) {
      sent += 1;
      continue;
    }
    try {
      await sendViaResend(env, r.email, r.title, renderEmail(r, appUrl), renderText(r, appUrl));
      await rpc(env, 'mark_reminder_sent', { p_id: r.reminder_id, p_ok: true });
      sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await rpc(env, 'mark_reminder_sent', {
        p_id: r.reminder_id,
        p_ok: false,
        p_error: message.slice(0, 500),
      }).catch(() => {});
      failed += 1;
      if (errors.length < 5) errors.push(message.slice(0, 200));
    }
  }

  return {
    ok: true,
    generated,
    queued: batch.length,
    sent,
    failed,
    dryRun: Boolean(options.dryRun),
    ...(errors.length ? { errors } : {}),
  };
}

/* ── Handler ──────────────────────────────────────────────────────────────── */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // ── Uptime probe ──────────────────────────────────────────────────────
    if (pathname === '/healthz') {
      return json({
        ok: true,
        app: 'novatrix-digital',
        time: new Date().toISOString(),
        // Presence only — never the values.
        bindings: {
          supabase: Boolean(env.SUPABASE_URL || env.VITE_SUPABASE_URL),
          serviceRole: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
          resend: Boolean(env.RESEND_API_KEY),
        },
      });
    }

    // ── Reminder run ──────────────────────────────────────────────────────
    if (pathname === '/api/reminders/run') {
      if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);

      const secret =
        request.headers.get('x-reminder-secret') ||
        (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

      if (!env.REMINDER_SECRET || secret !== env.REMINDER_SECRET) {
        return json({ error: 'Unauthorized' }, 401);
      }

      let options = {};
      try {
        options = await request.json();
      } catch {
        /* empty body is fine */
      }

      try {
        const result = await runReminders(env, options);
        return json(result, result.ok ? 200 : 500);
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    // ── Static assets, then SPA fallback ──────────────────────────────────
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;

    // A real file that is missing must stay a 404 — returning HTML in place of
    // a .js file is the classic white-screen bug.
    if (/\.[a-z0-9]{2,5}$/i.test(pathname)) return asset;

    // Fetch the shell WITHOUT forwarding the caller's headers.
    //
    // This used to pass `request` through, which carried its If-None-Match
    // along with it. dist/_headers marks /index.html `no-cache,
    // must-revalidate`, so every refresh of a deep link revalidated, the
    // assets binding answered 304 with a null body, and the line below forced
    // that empty body out as a 200 — a blank white page on refresh that a
    // fresh tab never reproduced. A bare GET can never come back 304.
    const shell = await env.ASSETS.fetch(new URL('/index.html', url));
    if (!shell.ok) return shell;

    return new Response(shell.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // The shell is route-agnostic and points at hashed assets, so it must
        // be revalidated rather than replayed from cache after a deploy. No
        // ETag is copied across: one shared by every route is exactly what let
        // the conditional request go wrong.
        'Cache-Control': 'no-cache, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },

  /** Cron trigger — see [triggers] in wrangler.toml. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runReminders(env)
        .then((r) => console.log('[reminders]', JSON.stringify(r)))
        .catch((e) => console.error('[reminders] failed:', e?.message || e)),
    );
  },
};
