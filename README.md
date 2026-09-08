# Novatrix Digital

**Finance. Simplified.**

A premium dark-fintech workspace for managing **personal**, **business**, and **combined** finances
in one place. React + Vite + Tailwind on the front, Supabase (PostgreSQL + RLS) on the back,
deployed to Cloudflare Pages at **https://finance.novatrixdigital.in**.

---

## 1 · What it is

A finance application built around one architectural rule:

> Personal and business money never mix. `COMBINED` is a **read-time aggregation**, never a merge.

Every financial row carries both `user_id` (the hard tenant boundary, enforced by Row Level
Security) and `workspace_id` (the personal/business boundary). Switching the workspace in the
sidebar changes which rows the queries are even allowed to touch.

### Modules

| Module | What it does |
| --- | --- |
| **Dashboard** | Editorial hero, live product visual, net worth, five headline figures, Bento analysis grid |
| **Transactions** | Full ledger — filter by type, category, range; inline edit; CSV export |
| **Accounts** | Bank, cash, card, wallet, investment. Balances derived from the ledger, never hand-edited |
| **Payments** | Scheduled money in/out, with overdue detection and one-click settle |
| **Invoices** | Line-item builder, GST/tax, auto-numbering, payment reconciliation |
| **Budgets** | Per-category ceilings with alert thresholds |
| **Goals** | Savings targets with contribution tracking |
| **Reports** | Period statement (incl. Indian FY Apr–Mar) with summary + statement export |
| **Analytics** | Net position, income vs expenses, savings rate, category concentration |
| **Contacts** | Customers, vendors, employees |
| **Categories** | Shared or workspace-specific, with icon and colour |
| **Subscriptions** | Netflix, insurance, SaaS — renewal + trial tracking, true yearly cost |
| **Reminders** | Auto-built nudges, emailed before anything is due |
| **Recurring** | Rent, payroll — auto-posted or queued |
| **Settings** | Profile, avatar upload, theme, workspaces, password, demo data, reset |

---

## 2 · Design system

Dark is the canonical theme; the light toggle flips surfaces only — the neon lime accent is
identical in both.

| Token | Dark | Purpose |
| --- | --- | --- |
| `base` | `#090B0D` | Page background |
| `surface` | `#111416` | Secondary background |
| `card` | `#15191C` | Bento card |
| `elevated` | `#1A1F22` | Hover / raised card |
| `raised` | `#20262A` | Menus, tooltips |
| `ink` | `#F5F5F5` | Primary text |
| `ink-dim` | `#9CA3AF` | Secondary text |
| `ink-muted` | `#6B7280` | Muted text |
| `hair` | `rgba(255,255,255,0.08)` | Thin borders |
| `lime` | `#C8FF00` | **The** accent |
| `positive` / `negative` / `warning` | `#B6FF00` / `#FF5C6C` / `#FFB547` | Semantics |

Surfaces and ink are CSS custom properties stored as **RGB channel triplets**
(`--c-card: 21 25 28`) and exposed to Tailwind as `rgb(var(--c-card) / <alpha-value>)`. That is
what lets `bg-card/90` and `bg-elevated/60` work while the theme toggle still swaps them.

Reusable primitives live in `src/index.css` under `@layer components`: `.bento`, `.btn-primary`,
`.field`, `.icon-tile`, `.eyebrow`, `.headline`, `.t-row`, `.lime-orb`, `.grid-veil`.

**Type** — Inter for everything, Instrument Serif for the editorial italic annotations.
Money always renders with `.tnum` (tabular numerals) so columns align.

---

## 3 · Project structure

```
├── index.html                  Shell, fonts, canonical + social meta
├── vite.config.js              Aliases, manual chunks
├── tailwind.config.js          The design system
├── wrangler.toml               Cloudflare Pages config
├── public/
│   ├── _worker.js              Pages Advanced Mode worker (SPA routing, CSP, caching)
│   ├── _redirects              SPA fallback (used only if _worker.js is removed)
│   ├── _headers                Static headers (same caveat)
│   └── logo.svg                Favicon / brand mark
├── supabase/
│   ├── novatrix_complete.sql   THE WHOLE DATABASE — run this one file
│   ├── create_account.sql      Optional: provision the owner account
│   └── functions/
│       └── send-reminders/     Edge Function — Resend email delivery
│                               Parts 1-6: schema · RLS · functions ·
│                               storage · demo seed · subscriptions
└── src/
    ├── main.jsx  App.jsx  index.css
    ├── lib/         supabase · config · format · constants · icons · utils
    ├── context/     Auth · Workspace · Theme · Toast · Modal
    ├── hooks/       useCollection · useDashboard · useFormOptions · useNotifications
    ├── components/
    │   ├── ui/        Button, Card, Modal, Badge, Input, EmptyState, …
    │   ├── brand/     Logo, WaveViz, BarSpark, ArcField
    │   ├── layout/    AppShell, Sidebar, TopHeader, MobileNav, CommandPalette, PageHeader
    │   ├── charts/    CashFlowChart, ExpenseDonut
    │   ├── dashboard/ HeroSection, PhoneVisual, NetWorthCard, SummaryCards, Panels
    │   └── forms/     TransactionForm, InvoiceForm, RecordForms, ModalHost
    ├── pages/
    │   ├── auth/    AuthLayout, Login, Signup, PasswordFlows
    │   └── app/     Dashboard, Transactions, Accounts, Payments, Invoices,
    │                Budgets, Goals, Reports, Analytics, Contacts,
    │                Categories, Recurring, Settings, NotFound
    └── routes/      ProtectedRoute
```

---

## 4 · Setup

### 4.1 Install

```bash
npm install
cp .env.example .env
```

### 4.2 Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the whole of **`supabase/novatrix_complete.sql`**,
   and press **Run**. That single file builds everything — schema, RLS, functions, storage
   buckets and the demo-seed routines — in the correct order.

   It is idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` before each
   `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`), so running it again is safe.

   Verify:

   ```sql
   select count(*) from information_schema.tables where table_schema = 'public';  -- 12
   select tablename, rowsecurity from pg_tables where schemaname = 'public';      -- all true
   ```

3. **Settings → API** → copy the Project URL and the `anon` / publishable key into `.env`:

   ```env
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   VITE_APP_URL=https://finance.novatrixdigital.in
   ```

4. **Authentication → URL Configuration**:
   - Site URL: `https://finance.novatrixdigital.in`
   - Redirect URLs: `https://finance.novatrixdigital.in/auth/callback`,
     `https://finance.novatrixdigital.in/reset`, `http://localhost:5173/auth/callback`,
     `http://localhost:5173/reset`

> **Never** put the `service_role` key in `.env`, in `wrangler.toml`, or anywhere under `src/`.
> It bypasses Row Level Security entirely.

### 4.3 Run

```bash
npm run dev      # http://localhost:5173
npm run build    # → dist/
npm run preview
npm run lint
```

### 4.4 First login

Sign up. The `handle_new_user` trigger automatically creates your profile, **both** workspaces
(Personal + Business), starter accounts, and 17 default categories.

The dashboard then offers **Load demo data** — six months of realistic transactions, invoices,
budgets and goals across both workspaces. Also available any time from **Settings → Data**.

---

## 4.5 · Base URL

Auth redirects (email confirmation, OAuth callback, password reset) must be **absolute** URLs.
Deriving them from `window.location.origin` works but silently sends users back to whatever host
they happened to load — a preview deployment, a raw IP, a stale domain.

`src/lib/config.js` pins the canonical origin instead:

```js
import { siteUrl, AUTH_REDIRECTS, SITE_URL } from '@/lib/config';

SITE_URL                  // https://finance.novatrixdigital.in
siteUrl('/invoices')      // https://finance.novatrixdigital.in/invoices
AUTH_REDIRECTS.callback() // …/auth/callback
AUTH_REDIRECTS.reset()    // …/reset
```

| Variable | Purpose |
| --- | --- |
| `VITE_APP_URL` | Canonical origin. Must match Supabase → Authentication → URL Configuration |
| `VITE_BASE_PATH` | Only for subdirectory hosting (`/app/`). Leave unset for root |

**In development the configured value is deliberately ignored** and `window.location.origin` is
used, so a magic link sent from localhost comes back to your machine rather than bouncing to
production.

`VITE_BASE_PATH` feeds both Vite's `base` and React Router's `basename`, so a subdirectory
deploy needs one variable, not two edits.

---

## 5 · Security model

**Row Level Security is on and `FORCE`d for every table.** The `anon` role is revoked from the
entire `public` schema, so the key in the bundle can read nothing without a valid session.

Policy shape, applied to every workspace-scoped table:

```sql
-- read: only your own rows
using (user_id = (select auth.uid()))

-- write: your own rows, into a workspace you actually own
with check (
  user_id = (select auth.uid())
  and public.owns_workspace(workspace_id)
)
```

`(select auth.uid())` rather than a bare `auth.uid()` so Postgres evaluates it once per statement
instead of once per row.

`owns_workspace()` is `SECURITY DEFINER` so referencing it from another table's policy does not
re-enter the `workspaces` policy and recurse.

### Integrity enforced in the database, not the client

- **Account balances** are maintained by trigger from the ledger. Insert, update or delete a
  transaction and the affected balances are corrected — including reversing the old shape on an
  update. Only `status = 'completed'` moves money.
- **Invoice totals** are recomputed from line items on every write. A client cannot forge a total.
- **Payment ↔ invoice** reconciliation updates `amount_paid`, `balance_due` and status.
- **Overdue** is derived on write from the calendar.
- **Transfers** are constrained to a destination account different from the source.

### Storage

| Bucket | Access | Path contract |
| --- | --- | --- |
| `avatars` | public read, owner write | `<uid>/filename` |
| `attachments` | fully private | `<uid>/filename` |

The first path segment must equal `auth.uid()` — that is what the policies check.

---

## 6 · How the workspace switch works

`WorkspaceContext` resolves the active scope to a set of workspace ids and exposes `scopeQuery`:

```js
const { scopeQuery } = useWorkspace();
const { data } = await scopeQuery(supabase.from('transactions').select('*'));
```

- **Personal** → exactly one workspace id
- **Business** → exactly one workspace id
- **Combined** → both ids (aggregation only)

Server side, the same idea lives in `workspace_ids_for_scope(text)`, which every RPC uses. The
client filter is a convenience; RLS is what actually enforces isolation.

Invoices and Contacts are hidden in Personal mode by design — those pages offer a switch to
Business instead of showing an empty screen.

---

## 7 · Database RPCs

| Function | Returns |
| --- | --- |
| `dashboard_summary(scope)` | Every headline figure in one round trip |
| `cash_flow_series(scope, months)` | Income/expense/net per month |
| `expense_breakdown(scope, from, to)` | Category split with percentages |
| `budget_progress(scope)` | Spend vs limit for the current period |
| `next_invoice_number(workspace)` | `NOV-2026-0007` |
| `run_due_recurring()` | Materialises due recurring rules, returns the count |
| `seed_demo_data()` | Loads the demo book into the caller's own workspaces |
| `reset_my_data()` | Clears the caller's financial rows |

All are `SECURITY DEFINER`, uid-scoped, and granted to `authenticated` only.

---

## 7.5 · Subscriptions, reminders & email

### What it does

**Subscriptions** tracks anything billed on a cycle. Every plan is normalised to a
monthly-equivalent cost (`subscription_monthly_cost()`), because a ₹24,000 annual policy and a
₹649 monthly stream are impossible to compare until they are on the same footing. Trials carry an
end date so you are warned *before* they convert.

**Reminders** is a queue, not a table you maintain. `generate_reminders()` builds it from the
live state of the books:

| Source | Reminder |
| --- | --- |
| Subscription renewal within the lead time | "Netflix renews on 11 Sep 2026" |
| Trial ending | "Free trial for Kindle Unlimited ends…" |
| Payment due or overdue | "Office Rent is due on…" |
| Invoice due or overdue | "Invoice NOV-2026-0004 is overdue" |

A `dedupe_key` (`sub:<id>:<date>`) makes generation idempotent — run it hourly if you like, each
event is queued exactly once.

### Email delivery (Resend)

The Resend key is a **secret**, so it can never live in the Vite bundle. Mail is sent by a
Supabase Edge Function that also holds the only service-role credential in the system.

```
supabase/functions/send-reminders/index.ts
```

**1 · Deploy**

```bash
supabase functions deploy send-reminders --no-verify-jwt
```

`--no-verify-jwt` lets pg_cron call it. The function then authorises itself — it requires either
`Authorization: Bearer <SERVICE_ROLE_KEY>` or `x-reminder-secret: <REMINDER_SECRET>`, and returns
401 otherwise.

### Where the Resend key goes

**Not in `.env` as a `VITE_` variable, and not in Cloudflare Pages.** Vite inlines every
`VITE_*` value into the JavaScript it ships, so a key there is readable by anyone who opens
DevTools on the live site — and a Resend key can send mail as your verified domain.

The bottom of `.env` has an un-prefixed block for it. The app never reads those; they exist so
one command can upload them to where they are actually used:

```bash
npm run secrets:push            # upload to the Edge Function
npm run secrets:push -- --dry   # show what would be sent, send nothing
```

`npm run build` runs `scripts/check-env.mjs` first, which **fails the build** if a credential
ever picks up a `VITE_` prefix — caught by name (`RESEND`, `SECRET`, `SERVICE_ROLE`, `API_KEY`)
or by value shape (`re_…`, `sk-…`). Check it any time with `npm run check:env`.

| Where | Holds |
| --- | --- |
| `.env` → `VITE_*` | Supabase URL + anon key. Public by design; RLS is what protects the data |
| `.env` → un-prefixed | Resend key + reminder secret. A staging area for the push script |
| Supabase Edge Function secrets | Where the Resend key actually lives and is used |
| Cloudflare Pages variables | `VITE_*` only — never the Resend key |

### Testing delivery from the app

**Settings → Reminders & Email → Send test email** queues a reminder addressed to you alone
(`send_test_reminder()` is scoped to `auth.uid()`, so it cannot email anyone else). It goes out
on the next reminder run, proving the key, the From domain and the schedule in one step.

**2 · Secrets** (Project Settings → Edge Functions → Secrets)

| Secret | Example |
| --- | --- |
| `RESEND_API_KEY` | `re_xxxxxxxxxxxxxxxx` |
| `RESEND_FROM` | `Novatrix Digital <reminders@novatrixdigital.in>` |
| `APP_URL` | `https://finance.novatrixdigital.in` |
| `REMINDER_SECRET` | a long random string |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected for you.

In Resend, verify `novatrixdigital.in` (or use `onboarding@resend.dev` while testing) and add the
SPF/DKIM records it gives you — without them the mail lands in spam.

**3 · Test**

```bash
# render without sending
curl -X POST https://<ref>.supabase.co/functions/v1/send-reminders      -H "Authorization: Bearer $SERVICE_ROLE_KEY"      -H "Content-Type: application/json"      -d '{"dryRun":true}'

# send for real
curl -X POST https://<ref>.supabase.co/functions/v1/send-reminders      -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```

Returns `{ ok, generated, queued, sent, failed }`.

**4 · Schedule** — the commented pg_cron block at the end of `novatrix_complete.sql` runs
generation at 01:00 UTC and delivery five minutes later. Uncomment it, fill in your project ref
and service-role key, and run it. A Cloudflare Cron Trigger hitting the same URL works equally
well.

### Security notes

- `pending_reminder_batch()`, `mark_reminder_sent()` and `generate_all_reminders()` read across
  **all** users, so they are granted to `service_role` **only** — explicitly revoked from
  `authenticated` and `anon`.
- `subscriptions` and `reminders` carry the same `user_id` + `owns_workspace()` RLS as every
  other financial table.
- Delivery respects `profiles.email_reminders`; a user who switches it off is skipped at the SQL
  level, not just hidden in the UI.
- Failed sends retry twice, then mark `failed` with the error — no infinite loops.

### Email template

Table-based with inline styles, and the dark ground is baked in rather than relying on
`prefers-color-scheme` — Outlook and Gmail strip `<style>` blocks and most clients ignore the
media query. A plain-text alternative ships alongside every message.

---

## 8 · Deploying to Cloudflare Pages

### 8.1 Via the dashboard (recommended)

1. **Workers & Pages → Create → Pages → Connect to Git**.
2. Build settings:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node version: `20` or newer
3. **Settings → Variables and Secrets** — add to **both** Production and Preview:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   Vite inlines `VITE_*` at build time, so these must exist *before* the build runs.
4. **Custom domains → Set up a custom domain → `finance.novatrixdigital.in`**.
   If `novatrixdigital.in` is on Cloudflare DNS the CNAME is created for you; otherwise add
   `CNAME finance → novatrix-digital.pages.dev`.

### 8.2 Via Wrangler

```bash
npm run build
npx wrangler pages deploy dist --project-name novatrix-digital
```

### 8.3 About `public/_worker.js`

Because that file is copied into `dist`, Pages runs in **Advanced Mode** — the worker handles
every request:

- Hashed assets under `/assets/` → `Cache-Control: immutable, max-age=31536000`
- `index.html` → `no-cache` (so a deploy never serves stale asset links)
- Unknown paths → SPA fallback with a **200**, so `/invoices` survives a hard refresh
- A missing asset still 404s rather than returning HTML as JavaScript
- Security headers plus a CSP whose `connect-src` is narrowed to your Supabase origin
- `GET /healthz` for uptime monitoring

In Advanced Mode `_redirects` and `_headers` are ignored. Delete `public/_worker.js` to fall back
to the simple static handler driven by `_redirects`.

---

## 9 · Responsive behaviour

| Breakpoint | Layout |
| --- | --- |
| `< 640px` | Single column, bottom nav with a raised lime **+**, summary cards scroll horizontally, modals become bottom sheets |
| `640 – 1024px` | Two-column Bento, sidebar becomes a drawer |
| `1024 – 1280px` | Fixed sidebar, three-column summary grid |
| `> 1280px` | Full experience — hero beside the right rail, five-column summary, three-column Bento |

The mobile "More" sheet carries the rest of the navigation plus the workspace and theme switches.

---

## 10 · Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl/⌘ + K` | Command palette — search transactions, invoices, contacts, accounts |
| `↑ ↓` | Move through results |
| `Enter` | Open |
| `Esc` | Close any modal or the palette |

---

## 11 · Verification status

| Check | Result |
| --- | --- |
| `npm run build` | Passes — 2481 modules |
| `npx eslint . --ext js,jsx` | Clean — 0 errors, 0 warnings |
| Dev-server module probe | 57/57 modules transform cleanly |
| Largest chunk | `charts` 422 kB (113 kB gzip), lazy-loaded |

The icon layer uses an explicit registry (`src/lib/icons.js`) rather than
`import * as Icons from 'lucide-react'` — that alone cut the icon chunk from **780 kB to 49 kB**.
Adding a new selectable icon means registering it there.

---

## 12 · Notes on the demo figures

`seed_demo_data()` produces numbers that are internally consistent — every figure the dashboard
shows is computed from the seeded rows, not hard-coded:

| Figure | Value |
| --- | --- |
| Personal balance | ₹ 8,75,000 |
| Business balance | ₹ 16,10,000 |
| Net worth | ₹ 24,85,000 |
| Income (month) | ₹ 8,40,000 |
| Expenses (month) | ₹ 5,12,000 |
| Receivables | ₹ 3,45,000 across 5 invoices |

The expense mix matches the donut exactly: Office 28%, Salaries 20%, Rent & Utilities 15%,
Marketing 12%, Travel 10%, Software 8%, Others 7%.

**Upcoming Payments** is the one place the app deliberately disagrees with the original mock-up.
The mock showed a ₹1,28,000 summary above a table whose rows total ₹3,82,499. Novatrix computes
the card from the rows, so it shows the true total — a finance product that contradicts its own
table is broken, not styled.

---

© Novatrix Digital — *Finance. Simplified.*
