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

/* ── Weekly digest ────────────────────────────────────────────────────────── */

/**
 * The weekly digest email.
 *
 * Settings has offered a "Weekly digest" switch since the beginning; it wrote
 * `profiles.weekly_digest` and nothing anywhere read the column. Turning it on
 * produced a success toast and then silence, which is indistinguishable from
 * the feature being off. This is the other half.
 *
 * Same table-and-inline-styles discipline as the reminder mail: Gmail and
 * Outlook drop <style> blocks and ignore flex and grid.
 */
function renderDigest(row, appUrl) {
  const d = row.digest || {};
  const cur = row.currency || 'INR';
  const m = (v) => money(Number(v) || 0, cur);

  const spentLastWeek = Number(d.prev_expense) || 0;
  const spent = Number(d.expense) || 0;
  const delta = spentLastWeek > 0 ? Math.round(((spent - spentLastWeek) / spentLastWeek) * 100) : null;
  const direction =
    delta === null ? '' : delta > 0 ? `${delta}% more than the week before` : `${Math.abs(delta)}% less than the week before`;

  const figure = (label, value, colour) => `
      <td style="padding:0 6px;" width="33%">
        <div style="background:#111416;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px 12px;text-align:center;">
          <div style="color:#6B7280;font-size:10.5px;letter-spacing:0.08em;text-transform:uppercase;">${label}</div>
          <div style="margin-top:6px;color:${colour};font-size:17px;font-weight:800;">${escapeHtml(value)}</div>
        </div>
      </td>`;

  const listRows = (items, right) =>
    (items || [])
      .map(
        (i) => `
        <tr>
          <td style="padding:7px 0;color:#9CA3AF;font-size:13px;">${escapeHtml(i.name || '')}</td>
          <td style="padding:7px 0;color:#F5F5F5;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(right(i))}</td>
        </tr>`,
      )
      .join('');

  const categories = listRows(d.top_categories, (i) => m(i.amount));
  const upcoming = listRows(d.upcoming, (i) => `${m(i.amount)} · ${prettyDate(i.due_on)}`);

  const section = (title, body) =>
    body
      ? `
        <tr><td style="padding:24px 28px 0 28px;">
          <div style="color:#6B7280;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">${title}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${body}</table>
        </td></tr>`
      : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#090B0D;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your week: ${escapeHtml(m(d.income))} in, ${escapeHtml(m(d.expense))} out.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#090B0D;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#15191C;border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

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
          <div style="color:#6B7280;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;">Your week</div>
          <h1 style="margin:12px 0 0 0;color:#F5F5F5;font-size:23px;line-height:1.28;font-weight:800;letter-spacing:-0.4px;">
            ${escapeHtml(prettyDate(d.from))} — ${escapeHtml(prettyDate(d.to))}
          </h1>
          <p style="margin:10px 0 0 0;color:#9CA3AF;font-size:14px;line-height:1.6;">
            ${escapeHtml(String(d.txn_count || 0))} ${Number(d.txn_count) === 1 ? 'entry' : 'entries'} recorded${direction ? `. You spent ${escapeHtml(direction)}` : ''}.
          </p>
        </td></tr>

        <tr><td style="padding:20px 22px 0 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${figure('In', m(d.income), '#C8FF00')}
            ${figure('Out', m(d.expense), '#FF5C6C')}
            ${figure('Net', m(d.net), Number(d.net) >= 0 ? '#C8FF00' : '#FF5C6C')}
          </tr></table>
        </td></tr>

        ${section('Where it went', categories)}
        ${section('Due in the next 7 days', upcoming)}

        ${
          Number(d.overdue_count) > 0
            ? `<tr><td style="padding:22px 28px 0 28px;">
                 <div style="background:rgba(255,92,108,0.08);border:1px solid rgba(255,92,108,0.25);border-radius:14px;padding:13px 16px;color:#FF5C6C;font-size:13px;font-weight:600;">
                   ${escapeHtml(String(d.overdue_count))} payment${Number(d.overdue_count) === 1 ? ' is' : 's are'} overdue.
                 </div>
               </td></tr>`
            : ''
        }

        <tr><td style="padding:24px 28px 0 28px;">
          <a href="${appUrl}/dashboard" style="display:inline-block;background:#C8FF00;color:#000000;text-decoration:none;font-size:14px;font-weight:700;padding:13px 24px;border-radius:999px;">
            Open Novatrix
          </a>
        </td></tr>

        <tr><td style="padding:26px 28px 28px 28px;">
          <div style="height:1px;background:rgba(255,255,255,0.08);margin-bottom:16px;"></div>
          <p style="margin:0;color:#6B7280;font-size:11.5px;line-height:1.6;">
            You are getting this because the weekly digest is switched on for your Novatrix account.
            <a href="${appUrl}/settings" style="color:#C8FF00;text-decoration:none;">Turn it off</a>.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

function renderDigestText(row, appUrl) {
  const d = row.digest || {};
  const cur = row.currency || 'INR';
  const m = (v) => money(Number(v) || 0, cur);

  const lines = [
    `Your week — ${prettyDate(d.from)} to ${prettyDate(d.to)}`,
    '',
    `In:  ${m(d.income)}`,
    `Out: ${m(d.expense)}`,
    `Net: ${m(d.net)}`,
    '',
    `${d.txn_count || 0} entries recorded.`,
  ];

  if (d.top_categories?.length) {
    lines.push('', 'Where it went:');
    d.top_categories.forEach((c) => lines.push(`  ${c.name}: ${m(c.amount)}`));
  }
  if (d.upcoming?.length) {
    lines.push('', 'Due in the next 7 days:');
    d.upcoming.forEach((u) => lines.push(`  ${u.name}: ${m(u.amount)} on ${prettyDate(u.due_on)}`));
  }
  if (Number(d.overdue_count) > 0) {
    lines.push('', `${d.overdue_count} payment(s) overdue.`);
  }

  lines.push('', `Open Novatrix: ${appUrl}/dashboard`);
  return lines.join('\n');
}

async function runWeeklyDigest(env, options = {}) {
  const missing = ['RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !env[k]);
  if (missing.length) {
    return { ok: false, error: `Missing secret(s): ${missing.join(', ')}` };
  }

  const appUrl = (env.APP_URL || 'https://finance.novatrixdigital.in').replace(/\/+$/, '');
  const batch =
    (await rpc(env, 'weekly_digest_batch', {
      p_limit: Math.min(Math.max(Number(options.limit) || 200, 1), 500),
    })) || [];

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const row of batch) {
    // A dry run renders and counts but neither sends nor marks anyone done,
    // so it can be repeated while testing the wiring.
    if (options.dryRun) {
      renderDigest(row, appUrl);
      sent += 1;
      continue;
    }
    try {
      await sendViaResend(
        env,
        row.email,
        'Your week with Novatrix',
        renderDigest(row, appUrl),
        renderDigestText(row, appUrl),
      );
      // Marked only after Resend accepts it. Marking first would drop the
      // digest silently for a week whenever a send failed.
      await rpc(env, 'mark_weekly_digest_sent', { p_user: row.user_id });
      sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed += 1;
      if (errors.length < 5) errors.push(message.slice(0, 200));
    }
  }

  return {
    ok: true,
    queued: batch.length,
    sent,
    failed,
    dryRun: Boolean(options.dryRun),
    ...(errors.length ? { errors } : {}),
  };
}

/* ── Posting jobs ─────────────────────────────────────────────────────────── */

/**
 * Rolls forward everything that is due today: recurring rules and subscription
 * renewals.
 *
 * These used to run only from the browser, on the first page load of the day.
 * That made "auto-posted" mean "posted whenever somebody next signs in" — a
 * fortnight away and the rent had not been booked, so every balance, budget and
 * report was wrong until the app was opened. They belong on the cron, where
 * nobody has to be watching.
 */
async function runPostingJobs(env) {
  const out = {};
  for (const fn of ['run_due_recurring', 'run_due_subscriptions']) {
    try {
      out[fn] = await rpc(env, fn);
    } catch (err) {
      out[fn] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return out;
}

/** Everything the daily trigger does, in the order it has to happen. */
async function runDailyJobs(env, options = {}) {
  // Posting runs first: a renewal booked today is a reminder worth sending
  // today, and the reminder generator reads what posting just wrote.
  const posted = await runPostingJobs(env);
  const reminders = await runReminders(env, options);

  const out = { posted, reminders };

  /*
    Monday also carries the weekly digest, in the same invocation rather than
    on a second cron. The digest reads the week that posting has just closed
    out, and `weekly_digest_batch` skips anyone already sent today, so a retry
    or an overlapping trigger cannot produce two copies.
  */
  const monday = new Date().getUTCDay() === 1;
  if (options.digest === true || (options.digest !== false && monday)) {
    out.digest = await runWeeklyDigest(env, options);
  }

  return out;
}

/* ── Handler ──────────────────────────────────────────────────────────────── */

export default {
  async fetch(request, env, _ctx) {
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
        /*
          Three shapes, so each piece can be exercised on its own:
            {}                 reminders only — the original behaviour
            {"jobs": true}     the full daily pass, digest included on a Monday
            {"digest": true}   the weekly digest on its own
          `dryRun` applies to all three.
        */
        let result;
        let ok;
        if (options.jobs) {
          result = await runDailyJobs(env, options);
          ok = result.reminders?.ok !== false && result.digest?.ok !== false;
        } else if (options.digest) {
          result = await runWeeklyDigest(env, options);
          ok = result.ok;
        } else {
          result = await runReminders(env, options);
          ok = result.ok;
        }
        return json(result, ok ? 200 : 500);
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

    // Start from the asset response's own headers so everything dist/_headers
    // applies — the generated CSP, HSTS, frame and referrer policy — survives
    // the fallback. Building a bare header set here instead meant every
    // deep-link refresh, which is the common case, was served unprotected
    // while a cold load of the same URL was fine.
    const headers = new Headers(shell.headers);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    // The shell is route-agnostic and points at hashed assets, so it must be
    // revalidated rather than replayed from cache after a deploy.
    headers.set('Cache-Control', 'no-cache, must-revalidate');
    headers.set('X-Content-Type-Options', 'nosniff');
    // One ETag shared by every route is exactly what made the conditional
    // request go wrong; drop it rather than hand it back.
    headers.delete('ETag');
    headers.delete('Last-Modified');

    // Belt and braces: if the assets binding served no CSP (an older Wrangler,
    // or a build whose postbuild step did not run), fall back to a policy that
    // still blocks framing and inline object embeds.
    if (!headers.has('Content-Security-Policy')) {
      headers.set('X-Frame-Options', 'SAMEORIGIN');
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    }

    return new Response(shell.body, { status: 200, headers });
  },

  /** Cron trigger — see [triggers] in wrangler.toml. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runDailyJobs(env)
        .then((r) => console.log('[cron]', JSON.stringify(r)))
        .catch((e) => console.error('[cron] failed:', e?.message || e)),
    );
  },
};
