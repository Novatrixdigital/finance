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
├── wrangler.toml               Cloudflare Workers + static assets config
├── .github/workflows/ci.yml    Lint · tests · SQL · worker · build, on every push
├── scripts/                    check-env · gen-headers · push-secrets · check-sql
├── worker/index.js             Edge worker (SPA fallback, /healthz, daily cron)
├── public/
│   ├── _redirects              SPA fallback
│   ├── _headers                Base headers (regenerated into dist at build)
│   └── logo.svg                Favicon / brand mark
├── supabase/
│   ├── novatrix_complete.sql   THE WHOLE DATABASE — run this one file
│   │                           Part 0  enum catch-up (no-op when new)
│   │                           Part 1  schema, balance + invoice triggers
│   │                           Part 2  row level security
│   │                           Part 3  functions & RPCs
│   │                           Part 4  storage buckets
│   │                           Part 5  maintenance
│   │                           Part 6  subscriptions, reminders, email
│   │                           Part 7  cash, one primary account, ledger
│   │                           Part 8  shared rows, automation, reminders
│   │                           Part 9  weekly digest
│   └── functions/
│       └── send-reminders/     Edge Function — Resend email delivery
└── src/
    ├── main.jsx  App.jsx  index.css
    ├── lib/         supabase · config · format · constants · icons · utils
    │                format.test.js · utils.test.js (vitest)
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
   and press **Run**.

   That is the entire database setup. There is no second file and no migration
   order to get right — schema, RLS, functions, storage buckets, the cash
   system, shared accounts, subscription automation, reminders and the weekly
   digest are Parts 0 through 9 of that one script, in the order they have to
   run. (It used to be four files applied in sequence, which left the database
   half-built if one was skipped.)

   It is idempotent throughout — `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF
   EXISTS` before each `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`,
   `ADD COLUMN IF NOT EXISTS` — so running it again is safe, and running it on
   a database that already holds real data is safe. Nothing in it deletes a
   transaction, an invoice, a payment or an account, and no balance is
   recomputed behind your back.

   **One caveat.** Part 0 adds an enum label and must commit before the later
   parts use it, so it sits outside any transaction on purpose. On a new
   database it does nothing at all. If your SQL client wraps the whole script
   in a single transaction and objects with *"unsafe use of new value of enum
   type"*, run Part 0 on its own first and then the rest — the file is
   idempotent, so nothing is harmed by that.

   Verify:

   ```sql
   select count(*) from information_schema.tables where table_schema = 'public';  -- 12
   select tablename, rowsecurity from pg_tables where schemaname = 'public';      -- all true

   -- accounts may be shared (NULL workspace = both)   → Part 8
   select is_nullable from information_schema.columns
    where table_name = 'accounts' and column_name = 'workspace_id';               -- YES

   -- exactly one primary account per user             → Part 7
   select user_id, count(*) from public.accounts
    where is_primary group by user_id having count(*) <> 1;                       -- 0 rows

   -- the digest functions exist                       → Part 9
   select count(*) from pg_proc
    where proname in ('weekly_digest_for', 'weekly_digest_batch',
                      'mark_weekly_digest_sent', 'my_weekly_digest');             -- 4
   ```

   The script's own footer carries a fuller checklist.

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

### How much data a page loads

A finance screen that silently drops rows reports a wrong number with total
confidence, which is the worst failure this product has. Every list page states
which of three modes it is in, and `useCollection` enforces it:

| Mode | Behaviour | Used by |
| --- | --- | --- |
| `limit: n` | One bounded window, nothing more | Dashboard panels — "the latest 6" |
| `pageSize: n` | First window, then `loadMore()`, with `hasMore` | Transactions ledger |
| `all: true` | Every matching row, paged transparently, `truncated` if it hits the 50 000 cap | Reports, and the Transactions totals pass |

Reports previously fetched `txn_date >= from` **ordered descending** with
`limit: 1000`. Past a thousand transactions in a period it therefore kept the
*newest* thousand, discarded the oldest, and summed what was left into the
statement — no warning, no "showing 1000 of N". Transactions had the same shape
at 400 rows, where "All time" meant "the newest 400". Both now page, and a
period that exceeds the cap says so in the page rather than under-reporting.

Two supporting details:

- Paged reads add `id` as a second sort key. Without a unique tie-breaker, two
  rows sharing a date can swap places between requests, which duplicates one
  row across pages and loses another.
- Export pulls the remaining pages before writing the file (`loadAll()`), so a
  CSV covers the whole filtered set rather than whichever pages are on screen.

### Currency

There is **no exchange rate anywhere in this product.** Balances are summed as
plain numbers — in `dashboard_summary`, on Accounts, everywhere — so the totals
are only meaningful while one currency is in play. When more than one is, the
Accounts page says so plainly instead of printing a confident wrong number.

The Settings "Default currency" picker now actually drives formatting:
`setMoneyDefaults()` is fed from the profile by `AuthContext`, and grouping
follows the currency rather than the symbol alone (en-IN lakh-grouping applied
to dollars gives `$10,00,000`, which is nobody's convention). It previously
wrote `profiles.currency` and was read by nothing — every formatter took its
default from a *build-time* env var, so the app was INR-only whatever the
setting said.

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

### 6.1 · One account used by both — "use in both"

Most people run a single bank account for personal spending and for the business. Modelling
that as two rows gives you two balances that drift apart and a Combined total that counts the
same money twice, so instead an **account or contact can belong to both**: `workspace_id` is
`NULL`, which is the convention categories have always used.

| | Personal view | Business view | Combined |
| --- | --- | --- | --- |
| Personal account | ✅ | — | ✅ |
| Business account | — | ✅ | ✅ |
| **Both** account | ✅ | ✅ | ✅ **counted once** |

Pick **Both — Personal & Business** in the Belongs-to field on the Account or Contact form.
Rows carry a blue `BOTH` badge, and the Net Worth card grows a third *Shared by both* line so
Personal + Business + Shared still reconciles to the total rather than quietly overstating
one side.

What is *not* shared, on purpose: transactions, invoices, payments, budgets and goals stay
owned by one workspace. Those are real financial events, and they have to land on one side of
the books for reporting and tax to mean anything. Only the containers you pick *from* are
shared — so a Business expense paid from the shared account is still a Business expense.

Client side this is `scopeQuery(query, column, { includeShared: true })` and the matching
`includeShared` option on `useCollection`; server side it is `in_scope(workspace_id, ids)`.

### 6.2 · What gets created for you

Adding one record now sets up everything that record implies, instead of leaving you to type
the same thing into three pages:

| You add | Also created |
| --- | --- |
| **Subscription** | A reminder before each renewal (plus a trial-ending warning), **and** a linked row on Recurring |
| **Payment** | A reminder on its due date, and an overdue nudge if it passes |
| **Invoice** | A due-soon reminder and an overdue reminder |
| **Goal** | A reminder as the target date approaches, plus a monthly contribution nudge |
| **Budget** | An alert when you cross your threshold, and again at 100% |

These are database triggers, so they fire on save — not on the next page load, and not only
when the nightly job happens to run.

> **Only one thing ever posts to the ledger.** A subscription that mirrors onto Recurring
> would be charged twice if both halves posted, so the subscription owns the posting and the
> mirror is the visible schedule. Two independent guards enforce it: the mirror is forced to
> `auto_post = false` on every sync, and `run_due_recurring()` skips any row carrying a
> `subscription_id` outright. Mirrors are read-only on the Recurring page — they show a
> **Manage** link back to the subscription rather than a second set of controls that could
> disagree with it.

Reminders are also created **as soon as the record exists**, anywhere in the next 400 days,
with `remind_at` set to when the email should actually leave. Previously a subscription
renewing in 30 days produced nothing visible for 27 of them, which reads as "it did not
work". Nothing is emailed any earlier than before — `pending_reminder_batch` still only picks
up rows whose `remind_at` has arrived.

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

**Weekly digest** (Part 9 of the schema) is the Monday email: what you earned and
spent last week against the week before, your five biggest expense categories,
what falls due in the next seven days, and a count of anything overdue. It
skips a week with no activity — an empty digest is spam that happens to be
accurate — and `weekly_digest_sent_on` guards against a cron firing twice.

The Settings toggle for it has existed since the beginning and wrote
`profiles.weekly_digest`; nothing anywhere read the column. Turning it on gave
a success toast and then silence, indistinguishable from the feature being off.
Migration 004 and the Worker are the other half.

**Receipts.** `transactions.attachment_url` and a private, uid-scoped
`attachments` bucket have been in the schema since the first migration with
nothing in the app writing to either. The transaction form now has the upload
control that was missing, and the ledger shows a paperclip on rows that carry
one. What is stored on the row is the storage **path**, not a signed URL:
signed URLs expire, and a column full of week-old dead links is worse than an
empty one, so the link is minted at the moment somebody clicks.

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

## 8 · Deploying to Cloudflare

The connected build runs two commands:

```
Executing user build command:  npm run build
Executing user deploy command: npx wrangler deploy
```

That is the **Workers** flow, so `wrangler.toml` is configured for Workers with
static assets:

```toml
name = "novatrix-digital"
compatibility_date = "2024-11-01"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```

There is no `main`. With none set, Cloudflare serves the assets straight from its edge and
`not_found_handling` handles SPA routing, so no custom code sits in the request path — a deep
link like `/invoices` returns `index.html` with a 200 instead of a 404.

`npm run build` runs three steps:

| Step | What it does |
| --- | --- |
| `prebuild` | `check-env.mjs` — fails the build if a secret has a `VITE_` prefix |
| `build` | `vite build` → `dist/` |
| `postbuild` | `gen-headers.mjs` — writes `dist/_headers` |

### Environment variables

Set these in the dashboard under **Settings → Variables**, for both production and preview.
Vite inlines `VITE_*` at **build** time, so they must exist before the build runs.

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the anon / publishable key |

`VITE_APP_URL`, `VITE_APP_NAME` and `VITE_DEFAULT_CURRENCY` are already in `wrangler.toml`.

**Never** add `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` or `REMINDER_SECRET` here — a build
environment feeds the client bundle. Those belong to the Edge Function (`npm run secrets:push`).

### Headers

`dist/_headers` is generated rather than checked in, because `connect-src` is narrowed to the
Supabase project the build was made against:

```
connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co
```

It also sets HSTS, `X-Content-Type-Options`, `frame-ancestors`, `object-src 'none'`, one-year
immutable caching for `/assets/*`, and `no-cache` on `index.html` so a deploy never keeps serving
stale asset links.

### The Worker

`worker/index.js` sits in front of the static bundle and is **wired up** —
`main = "worker/index.js"` in `wrangler.toml`, with `binding = "ASSETS"` and
`not_found_handling = "none"` under `[assets]` so it sees unmatched paths and
can route them itself. It does four things a static file cannot:

| Route | Job |
| --- | --- |
| `GET /healthz` | Uptime probe; reports which secrets are *bound*, never their values |
| `POST /api/reminders/run` | Manual trigger, behind `REMINDER_SECRET` |
| `scheduled()` | The daily cron — see below |
| `*` | SPA fallback so deep links do not 404 |

**The SPA fallback carries the security headers.** It used to build a bare
header set of its own, so the generated CSP, HSTS, frame and referrer policies
from `dist/_headers` were dropped on every fallback response — which is to say
on every deep-link *refresh*, the common case, while a cold load of the same
URL was fine. It now starts from the asset response's own headers and
overrides only content type, caching and `nosniff`, then drops the shared
`ETag` (one ETag across every route is what caused the white-screen-on-refresh
bug documented in the source).

It lives in `worker/`, not `public/` — anything in `public/` is copied into `dist/` and would be
served as a readable static file.

### The daily cron

`crons = ["0 1 * * *"]` — 01:00 UTC, 06:30 IST — runs, in order:

1. `run_due_recurring()` — rent, payroll, posted to the ledger
2. `run_due_subscriptions()` — renewals, posted to the ledger
3. Reminder generation, then delivery through Resend
4. On Mondays, the weekly digest

Steps 1 and 2 previously ran **only in the browser**, on the first page load of
the day. "Auto-posted" therefore meant "posted whenever somebody next signs
in": leave the app shut for a fortnight and the rent was never booked, so every
balance, budget and report was wrong until someone opened it. The browser still
runs them on load as a harmless catch-up — both functions are idempotent — but
nothing now depends on a human being logged in.

To run the whole pass by hand:

```bash
curl -X POST https://finance.novatrixdigital.in/api/reminders/run \
     -H "x-reminder-secret: $REMINDER_SECRET" \
     -H "content-type: application/json" \
     -d '{"jobs": true}'
```

`{"digest": true}` runs only the weekly digest; `{"dryRun": true}` renders and
counts without sending or marking anything done, so it is safe to repeat.

### If the project is on Pages instead

Either set the deploy command to

```bash
npx wrangler pages deploy dist --project-name novatrix-digital
```

or deploy from your machine:

```bash
npm run deploy:pages
```

### Local commands

```bash
npm run build          # check env → build → generate headers
npm run deploy         # build + wrangler deploy      (Workers)
npm run deploy:pages   # build + wrangler pages deploy (Pages)
npx wrangler deploy --dry-run   # validate config without deploying
```

### Custom domain

Add `finance.novatrixdigital.in` under the project's **Settings → Domains**. If
`novatrixdigital.in` is on Cloudflare DNS the record is created for you; otherwise add
`CNAME finance → <project>.workers.dev`.

---

## 9 · Responsive behaviour

| Breakpoint | Navigation | Layout |
| --- | --- | --- |
| `< 768px` (phone) | Bottom bar with a raised lime **+**, plus a hamburger drawer | Single column, summary cards two-across, tables collapse into one card per row, modals become bottom sheets |
| `768 – 1024px` (tablet) | **Persistent icon rail**, 4.75rem | Two-column Bento, tables return, one low-value column per table steps aside |
| `1024 – 1536px` (laptop) | Full sidebar with labels, 17rem | Three-column summary grid, all table columns |
| `> 1536px` (desktop) | Full sidebar | Hero beside the right rail, six-column summary, three-column Bento |

**The tablet band used to be the weak one.** Persistent navigation started at
1024px, so an iPad in portrait — 768 to 834px — got the phone layout: a
hamburger over a bottom bar, on a screen with room to spare, and 7rem of
bottom padding reserved for a bar that had nothing to clear. From 768px it is
now an icon rail (`.nav-rail` in `index.css`), with the labels returning at
1024px. The rail rules are scoped to that element rather than written as
breakpoint utilities, because the phone drawer renders the same markup — a
plain `hidden lg:inline` on a label would have blanked the drawer's labels too.

**Nothing is hidden to make it fit.** Four rules carry that:

- **Row actions are not hover-gated.** Edit and delete used to be
  `opacity-0 group-hover:opacity-100`, which is a desktop flourish and a dead
  end anywhere without a mouse: on a phone or tablet the buttons never
  appeared, so those records could not be edited or deleted at all. They now
  use `.reveal-actions`, which hides them until hover *only* under
  `@media (hover: hover) and (pointer: fine)`.
- Wide tables (Transactions, Invoices, Payments, and the dashboard payments
  panel) use `.table-stack`. Below 640px each row becomes a labelled card, so
  the amount, the status and the row actions are on screen instead of parked
  off the right edge where a horizontal scroll never reaches them.
- Through the tablet band, one column per wide table carries `.col-wide` and
  steps aside (Account, Balance, Contact) so the rest fits without a sideways
  scroll. Below 640px the stacked card shows every field anyway, so it returns.
- Figures are fluid (`text-figure-fluid`) and are never truncated. The
  six-across stat row used to clip a full rupee amount to its first few digits
  on a laptop; it now shrinks the type and, failing that, wraps — it does not
  drop digits. Six-across waits for `2xl`, where the cards are genuinely wide
  enough for it.

The phone "More" sheet carries the rest of the navigation plus the workspace and theme switches.

**Touch.** The expense donut responds to a tap as well as a hover — with only
`onMouseEnter` wired up, the whole ring was inert on a phone and the centre
readout never left "Total Expenses".

**Print.** `@media print` drops the sidebar, header, bottom bar and every
control, and renders the page as ink on white in either theme. Reports has a
**Print** button beside its exports.

---

## 10 · Keyboard & accessibility

| Shortcut | Action |
| --- | --- |
| `Tab` (first press) | **Skip to content** — jumps past the sixteen-item sidebar |
| `Ctrl/⌘ + K` | Command palette — search transactions, invoices, contacts, accounts |
| `↑ ↓` | Move through results |
| `Tab` / `Shift + Tab` | Cycle controls **within** an open dialog; focus cannot leave it |
| `Enter` | Open |
| `Esc` | Close any modal or the palette |

**Modals trap focus and give it back.** Tabbing past the last field used to
walk straight out of the dialog and into the page behind it — still scrolled,
still interactive, and to a screen-reader user indistinguishable from the
dialog: the modal looked closed while the form was still open underneath.
Closing now also returns focus to whatever opened it, rather than dropping it
on `<body>` where the next `Tab` restarts from the top of the page.

The expense donut's legend is a list of real buttons, each carrying the
category, amount and share as its accessible name, and focusing one highlights
its slice.

---

## 11 · Verification

Run the whole gate with one command:

```bash
npm run verify     # lint · tests · SQL structure · worker routing
npm run build      # and the bundle
```

| Check | Command | What it catches |
| --- | --- | --- |
| Lint | `npm run lint` | Unused vars and dead `eslint-disable` directives are **errors**, not warnings — `--max-warnings 0` means a warning was only ever a slower failure |
| Unit tests | `npm run test` | 44 tests over `lib/format.js` and `lib/utils.js` — money rounding, Indian vs Western grouping, local-time dates, overdue arithmetic, CSV formula injection |
| SQL structure | `npm run check:sql` | Unterminated dollar quotes and stray `$` across the schema file |
| Worker routing | `npm run check:worker` | Deep-link refresh returns a body, a missing `.js` stays a 404, `/healthz` answers |
| Build | `npm run build` | Compiles, then regenerates `dist/_headers` with a CSP scoped to this build's Supabase project |

`.github/workflows/ci.yml` runs all of it on every push and pull request, and
additionally greps the built `dist/_headers` for the CSP and HSTS lines — if
the `postbuild` step ever stopped emitting them, every deployed page would
quietly lose its headers.

**Why tests exist now.** The suite covers the two things this product cannot
afford to get wrong — money and dates — and every case in it is either a
boundary the code reasons about explicitly or a bug that reached production.
Writing them surfaced one live discrepancy: `formatCompact`'s doc comment
claimed `2485000 → "₹24.9L"` when the code has always produced `₹25L`. The
comment was wrong; the behaviour (one decimal below 10, none above) is
deliberate and was left alone.

**Bundle.** Largest chunk is `charts` at 422 kB (113 kB gzip), lazy-loaded. The
icon layer uses an explicit registry (`src/lib/icons.js`) rather than
`import * as Icons from 'lucide-react'` — that alone cut the icon chunk from
**780 kB to 49 kB**. Adding a new selectable icon means registering it there.

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
