-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║                                                                          ║
-- ║                        N O V A T R I X   D I G I T A L                   ║
-- ║                          Finance. Simplified.                            ║
-- ║                                                                          ║
-- ║                     THE COMPLETE DATABASE — ONE FILE                     ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
--  HOW TO RUN
--  ──────────
--  1. Supabase project → SQL Editor → New query.
--  2. Paste this entire file and press Run.
--  3. Copy Project URL + anon key from Settings → API into your .env.
--
--  There is nothing else to run. This file was previously four —
--  novatrix_complete.sql plus migrations 002, 003 and 004 — which had to be
--  applied in the right order, and silently left the database half-built if
--  one was skipped. They are folded in here as Parts 7, 8 and 9, in the order
--  they were always meant to run.
--
--  SAFE ON A DATABASE THAT ALREADY HOLDS REAL DATA
--  ───────────────────────────────────────────────
--  Idempotent throughout: every table is CREATE TABLE IF NOT EXISTS, every
--  policy is dropped before it is recreated, every function is CREATE OR
--  REPLACE, and every column add is IF NOT EXISTS. Running it twice is safe.
--  Running it on a database that already has parts of this applied is safe.
--
--  Nothing in this file deletes a transaction, an invoice, a payment or an
--  account, and no balance is recomputed behind your back. The three places
--  that change what you already see are called out where they happen:
--  Part 8 §1 (accounts and contacts may belong to BOTH workspaces), §4 (the
--  Personal/Business split reports the truth rather than echoing the selected
--  scope) and §5 (every subscription gains a mirror row on Recurring, which
--  never posts to the ledger, so nothing can be charged twice).
--
--  Target: Supabase / PostgreSQL 15+
--
--  CONTENTS
--  ────────
--    Part 0  Enum catch-up ..... no-op on a new database; see the note there
--    Part 1  Schema ............ tables, enums, balance + invoice triggers
--    Part 2  Row Level Security  policies, ownership helper, grants
--    Part 3  Functions & RPCs .. signup bootstrap, dashboard aggregations
--    Part 4  Storage ........... avatars + attachments buckets
--    Part 5  Maintenance ....... reset_my_data()
--    Part 6  Subscriptions ..... renewals, reminders, Resend email support
--    Part 7  Cash .............. cash accounts, one primary account,
--                                paid payments reach the ledger
--    Part 8  Shared & automation shared accounts/contacts, subscription
--                                automation, reminders for everything
--    Part 9  Weekly digest ..... the Monday summary email
--
--  DATA ISOLATION CONTRACT
--  ───────────────────────
--  Every financial row carries user_id AND workspace_id.
--    user_id      → hard tenant boundary, enforced by RLS
--    workspace_id → personal / business separation inside one account
--  COMBINED mode is a read-time aggregation only; it never merges rows.
--
--  SECURITY NOTE
--  ─────────────
--  The anon role is revoked from the public schema. The anon key shipped in
--  the browser bundle can read nothing without a valid session. Never expose
--  the service_role key to any client.
--
-- ============================================================================


-- ============================================================================
-- ============================================================================
--
--  PART 0 — ENUM CATCH-UP
--
--  Runs first, on its own, and does nothing at all on a new database.
--
--  Postgres will not let a newly added enum label be USED in the transaction
--  that adds it. Part 1 already creates `reminder_kind` with every label it
--  needs, so a fresh install skips this entirely — the guard finds no type and
--  exits. It is here for a database created before 'budget' joined that enum,
--  where the label has to be added and committed before Part 8 refers to it.
--
--  This is also the one part that must not be wrapped in a transaction. If
--  your SQL client wraps the whole file in one and objects with "unsafe use of
--  new value of enum type", run this part on its own first and then the rest —
--  the file is idempotent, so nothing is harmed by that.
--
-- ============================================================================
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_type where typname = 'reminder_kind')
     and not exists (
       select 1
         from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'reminder_kind'
          and e.enumlabel = 'budget'
     )
  then
    alter type reminder_kind add value 'budget';
  end if;
end $$;


-- ============================================================================
-- ============================================================================
--
--  PART 1 — SCHEMA
--
--  Extensions, enums, tables, indexes and the integrity triggers that keep
--  account balances and invoice totals honest.
--
--  (was 01_schema.sql)
-- ============================================================================
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  NOVATRIX DIGITAL — 01 SCHEMA                                            ║
-- ║  Finance. Simplified.                                                    ║
-- ║                                                                          ║
-- ║  Run order:  01_schema → 02_rls → 03_functions → 04_storage → 05_seed    ║
-- ║  Target:     Supabase / PostgreSQL 15+                                    ║
-- ║                                                                          ║
-- ║  Data isolation contract                                                 ║
-- ║  ─────────────────────────                                               ║
-- ║  Every financial row carries `user_id` AND `workspace_id`.               ║
-- ║  `user_id`      → hard tenant boundary, enforced by RLS.                 ║
-- ║  `workspace_id` → personal / business separation inside one account.     ║
-- ║  COMBINED mode is a read-time aggregation only; it never merges rows.    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════════════════
--  ENUMS
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_type where typname = 'workspace_type') then
    create type workspace_type as enum ('personal', 'business');
  end if;

  if not exists (select 1 from pg_type where typname = 'account_type') then
    create type account_type as enum
      ('bank', 'cash', 'credit_card', 'wallet', 'investment', 'loan', 'savings');
  end if;

  if not exists (select 1 from pg_type where typname = 'category_kind') then
    create type category_kind as enum ('income', 'expense', 'transfer');
  end if;

  if not exists (select 1 from pg_type where typname = 'transaction_type') then
    create type transaction_type as enum ('income', 'expense', 'transfer');
  end if;

  if not exists (select 1 from pg_type where typname = 'transaction_status') then
    create type transaction_status as enum ('completed', 'pending', 'failed', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'contact_type') then
    create type contact_type as enum ('customer', 'vendor', 'employee', 'personal', 'other');
  end if;

  if not exists (select 1 from pg_type where typname = 'invoice_status') then
    create type invoice_status as enum
      ('draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_direction') then
    create type payment_direction as enum ('incoming', 'outgoing');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum
      ('upcoming', 'pending', 'paid', 'overdue', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'goal_status') then
    create type goal_status as enum ('active', 'achieved', 'paused', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'budget_period') then
    create type budget_period as enum ('weekly', 'monthly', 'quarterly', 'yearly');
  end if;

  if not exists (select 1 from pg_type where typname = 'recurrence_frequency') then
    create type recurrence_frequency as enum
      ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  SHARED TRIGGER — updated_at
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  1. PROFILES  — 1:1 with auth.users
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text        not null,
  full_name     text        not null default '',
  avatar_url    text,
  phone         text,
  company_name  text,
  currency      text        not null default 'INR',
  locale        text        not null default 'en-IN',
  timezone      text        not null default 'Asia/Kolkata',
  theme         text        not null default 'dark' check (theme in ('dark', 'light')),
  onboarded     boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is 'User profile mirroring auth.users; created automatically on signup.';

-- ═══════════════════════════════════════════════════════════════════════════
--  2. WORKSPACES  — the personal / business boundary
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  type        workspace_type not null,
  description text,
  color       text not null default '#C8FF00',
  icon        text not null default 'wallet',
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Exactly one personal and one business workspace per user keeps COMBINED
  -- aggregation unambiguous.
  constraint workspaces_user_type_unique unique (user_id, type)
);

create index if not exists workspaces_user_idx on public.workspaces (user_id);

-- ═══════════════════════════════════════════════════════════════════════════
--  3. ACCOUNTS
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  name             text not null,
  type             account_type not null default 'bank',
  institution      text,
  account_number   text,                       -- store masked only, e.g. 'XXXX 4421'
  currency         text not null default 'INR',
  opening_balance  numeric(16, 2) not null default 0,
  current_balance  numeric(16, 2) not null default 0,
  credit_limit     numeric(16, 2),
  color            text not null default '#C8FF00',
  icon             text not null default 'landmark',
  notes            text,
  is_active        boolean not null default true,
  is_primary       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists accounts_user_idx      on public.accounts (user_id);
create index if not exists accounts_workspace_idx on public.accounts (workspace_id);

-- ═══════════════════════════════════════════════════════════════════════════
--  4. CATEGORIES
--  workspace_id NULL ⇒ available to every workspace of that user.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.categories (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  parent_id    uuid references public.categories(id) on delete set null,
  name         text not null,
  kind         category_kind not null default 'expense',
  icon         text not null default 'tag',
  color        text not null default '#C8FF00',
  is_system    boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists categories_user_idx      on public.categories (user_id);
create index if not exists categories_workspace_idx on public.categories (workspace_id);

-- ═══════════════════════════════════════════════════════════════════════════
--  5. CONTACTS  — customers, vendors, employees
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.contacts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  type          contact_type not null default 'customer',
  company       text,
  email         text,
  phone         text,
  gstin         text,
  address       text,
  city          text,
  country       text default 'India',
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists contacts_user_idx      on public.contacts (user_id);
create index if not exists contacts_workspace_idx on public.contacts (workspace_id);

-- ═══════════════════════════════════════════════════════════════════════════
--  6. RECURRING TRANSACTIONS  (declared before transactions for the FK)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.recurring_transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  account_id     uuid references public.accounts(id) on delete set null,
  category_id    uuid references public.categories(id) on delete set null,
  contact_id     uuid references public.contacts(id) on delete set null,
  name           text not null,
  type           transaction_type not null default 'expense',
  amount         numeric(16, 2) not null check (amount >= 0),
  currency       text not null default 'INR',
  description    text,
  frequency      recurrence_frequency not null default 'monthly',
  interval_count integer not null default 1 check (interval_count > 0),
  start_date     date not null default current_date,
  next_run_date  date not null default current_date,
  end_date       date,
  last_run_date  date,
  run_count      integer not null default 0,
  auto_post      boolean not null default false,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists recurring_user_idx      on public.recurring_transactions (user_id);
create index if not exists recurring_workspace_idx on public.recurring_transactions (workspace_id);
create index if not exists recurring_next_run_idx  on public.recurring_transactions (next_run_date)
  where is_active;

-- ═══════════════════════════════════════════════════════════════════════════
--  7. TRANSACTIONS  — the ledger
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  account_id     uuid references public.accounts(id) on delete set null,
  to_account_id  uuid references public.accounts(id) on delete set null,
  category_id    uuid references public.categories(id) on delete set null,
  contact_id     uuid references public.contacts(id) on delete set null,
  recurring_id   uuid references public.recurring_transactions(id) on delete set null,

  type           transaction_type not null,
  status         transaction_status not null default 'completed',
  amount         numeric(16, 2) not null check (amount >= 0),
  currency       text not null default 'INR',
  txn_date       date not null default current_date,
  description    text not null default '',
  notes          text,
  payment_method text,
  reference      text,
  tags           text[] not null default '{}',
  attachment_url text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A transfer must name a destination and it must differ from the source.
  constraint transactions_transfer_target check (
    (type <> 'transfer')
    or (to_account_id is not null and to_account_id is distinct from account_id)
  )
);

create index if not exists transactions_user_idx       on public.transactions (user_id);
create index if not exists transactions_workspace_idx  on public.transactions (workspace_id);
create index if not exists transactions_date_idx       on public.transactions (txn_date desc);
create index if not exists transactions_account_idx    on public.transactions (account_id);
create index if not exists transactions_category_idx   on public.transactions (category_id);
create index if not exists transactions_ws_date_idx    on public.transactions (workspace_id, txn_date desc);

-- ═══════════════════════════════════════════════════════════════════════════
--  8. INVOICES + INVOICE ITEMS
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  contact_id     uuid references public.contacts(id) on delete set null,

  invoice_number text not null,
  status         invoice_status not null default 'draft',
  issue_date     date not null default current_date,
  due_date       date not null default (current_date + 15),

  subtotal       numeric(16, 2) not null default 0,
  discount       numeric(16, 2) not null default 0,
  tax_rate       numeric(6, 3)  not null default 0,
  tax_amount     numeric(16, 2) not null default 0,
  total          numeric(16, 2) not null default 0,
  amount_paid    numeric(16, 2) not null default 0,
  balance_due    numeric(16, 2) not null default 0,

  currency       text not null default 'INR',
  notes          text,
  terms          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint invoices_number_unique unique (user_id, invoice_number)
);

create index if not exists invoices_user_idx      on public.invoices (user_id);
create index if not exists invoices_workspace_idx on public.invoices (workspace_id);
create index if not exists invoices_status_idx    on public.invoices (status);
create index if not exists invoices_due_idx       on public.invoices (due_date);

create table if not exists public.invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  description text not null default '',
  quantity    numeric(12, 3) not null default 1,
  rate        numeric(16, 2) not null default 0,
  amount      numeric(16, 2) not null default 0,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index if not exists invoice_items_user_idx    on public.invoice_items (user_id);

-- ═══════════════════════════════════════════════════════════════════════════
--  9. PAYMENTS  — scheduled money in / out
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id   uuid references public.invoices(id) on delete set null,
  contact_id   uuid references public.contacts(id) on delete set null,
  account_id   uuid references public.accounts(id) on delete set null,

  name         text not null,
  direction    payment_direction not null default 'outgoing',
  status       payment_status not null default 'upcoming',
  amount       numeric(16, 2) not null check (amount >= 0),
  currency     text not null default 'INR',
  due_date     date not null default current_date,
  paid_date    date,
  method       text,
  reference    text,
  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists payments_user_idx      on public.payments (user_id);
create index if not exists payments_workspace_idx on public.payments (workspace_id);
create index if not exists payments_due_idx       on public.payments (due_date);
create index if not exists payments_status_idx    on public.payments (status);

-- ═══════════════════════════════════════════════════════════════════════════
--  10. FINANCIAL GOALS
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.financial_goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  account_id     uuid references public.accounts(id) on delete set null,

  name           text not null,
  description    text,
  icon           text not null default 'target',
  color          text not null default '#C8FF00',
  target_amount  numeric(16, 2) not null check (target_amount > 0),
  current_amount numeric(16, 2) not null default 0,
  target_date    date,
  status         goal_status not null default 'active',

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists goals_user_idx      on public.financial_goals (user_id);
create index if not exists goals_workspace_idx on public.financial_goals (workspace_id);

-- ═══════════════════════════════════════════════════════════════════════════
--  11. BUDGETS
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.budgets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  category_id     uuid references public.categories(id) on delete set null,

  name            text not null,
  amount          numeric(16, 2) not null check (amount > 0),
  period          budget_period not null default 'monthly',
  start_date      date not null default date_trunc('month', current_date)::date,
  end_date        date,
  alert_threshold integer not null default 80 check (alert_threshold between 1 and 100),
  rollover        boolean not null default false,
  is_active       boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists budgets_user_idx      on public.budgets (user_id);
create index if not exists budgets_workspace_idx on public.budgets (workspace_id);

-- ═══════════════════════════════════════════════════════════════════════════
--  UPDATED_AT TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'workspaces', 'accounts', 'categories', 'contacts',
    'transactions', 'invoices', 'payments', 'financial_goals',
    'budgets', 'recurring_transactions'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$I;', t);
    execute format(
      'create trigger set_updated_at_%1$s before update on public.%1$I
       for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  BALANCE INTEGRITY
--  Account balances are derived from the ledger, never edited by the client.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.apply_txn_to_balances(
  p_type          transaction_type,
  p_status        transaction_status,
  p_account_id    uuid,
  p_to_account_id uuid,
  p_amount        numeric,
  p_sign          integer            -- +1 apply, -1 reverse
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only settled money moves a balance.
  if p_status <> 'completed' or p_amount is null or p_amount = 0 then
    return;
  end if;

  if p_type = 'income' and p_account_id is not null then
    update public.accounts
       set current_balance = current_balance + (p_amount * p_sign)
     where id = p_account_id;

  elsif p_type = 'expense' and p_account_id is not null then
    update public.accounts
       set current_balance = current_balance - (p_amount * p_sign)
     where id = p_account_id;

  elsif p_type = 'transfer' then
    if p_account_id is not null then
      update public.accounts
         set current_balance = current_balance - (p_amount * p_sign)
       where id = p_account_id;
    end if;
    if p_to_account_id is not null then
      update public.accounts
         set current_balance = current_balance + (p_amount * p_sign)
       where id = p_to_account_id;
    end if;
  end if;
end;
$$;

create or replace function public.transactions_balance_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.apply_txn_to_balances(
      new.type, new.status, new.account_id, new.to_account_id, new.amount, 1);
    return new;

  elsif tg_op = 'UPDATE' then
    -- Reverse the previous shape, then apply the new one.
    perform public.apply_txn_to_balances(
      old.type, old.status, old.account_id, old.to_account_id, old.amount, -1);
    perform public.apply_txn_to_balances(
      new.type, new.status, new.account_id, new.to_account_id, new.amount, 1);
    return new;

  elsif tg_op = 'DELETE' then
    perform public.apply_txn_to_balances(
      old.type, old.status, old.account_id, old.to_account_id, old.amount, -1);
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists transactions_balance_sync on public.transactions;
create trigger transactions_balance_sync
  after insert or update or delete on public.transactions
  for each row execute function public.transactions_balance_sync();

-- Opening balance seeds current balance on account creation.
create or replace function public.accounts_seed_balance()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' and (new.current_balance is null or new.current_balance = 0) then
    new.current_balance := coalesce(new.opening_balance, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_seed_balance on public.accounts;
create trigger accounts_seed_balance
  before insert on public.accounts
  for each row execute function public.accounts_seed_balance();

-- ═══════════════════════════════════════════════════════════════════════════
--  INVOICE TOTALS — recomputed from line items, never trusted from the client
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.recalc_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric(16, 2);
  v_inv      public.invoices%rowtype;
  v_tax      numeric(16, 2);
  v_total    numeric(16, 2);
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then
    return;
  end if;

  select coalesce(sum(round(quantity * rate, 2)), 0)
    into v_subtotal
    from public.invoice_items
   where invoice_id = p_invoice_id;

  v_tax   := round((v_subtotal - coalesce(v_inv.discount, 0)) * coalesce(v_inv.tax_rate, 0) / 100.0, 2);
  v_total := round(v_subtotal - coalesce(v_inv.discount, 0) + v_tax, 2);

  update public.invoices
     set subtotal    = v_subtotal,
         tax_amount  = v_tax,
         total       = v_total,
         balance_due = greatest(v_total - coalesce(amount_paid, 0), 0),
         status      = case
                         when status in ('draft', 'cancelled') then status
                         when coalesce(amount_paid, 0) >= v_total and v_total > 0 then 'paid'::invoice_status
                         when coalesce(amount_paid, 0) > 0 then 'partial'::invoice_status
                         when due_date < current_date then 'overdue'::invoice_status
                         else 'sent'::invoice_status
                       end
   where id = p_invoice_id;
end;
$$;

create or replace function public.invoice_items_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_invoice_totals(old.invoice_id);
    return old;
  end if;

  -- Line amount is always derived.
  perform public.recalc_invoice_totals(new.invoice_id);
  return new;
end;
$$;

create or replace function public.invoice_items_amount()
returns trigger
language plpgsql
as $$
begin
  new.amount := round(coalesce(new.quantity, 0) * coalesce(new.rate, 0), 2);
  return new;
end;
$$;

drop trigger if exists invoice_items_amount on public.invoice_items;
create trigger invoice_items_amount
  before insert or update on public.invoice_items
  for each row execute function public.invoice_items_amount();

drop trigger if exists invoice_items_sync on public.invoice_items;
create trigger invoice_items_sync
  after insert or update or delete on public.invoice_items
  for each row execute function public.invoice_items_sync();

-- Keep balance_due honest when the invoice header itself changes.
create or replace function public.invoices_derive()
returns trigger
language plpgsql
as $$
begin
  new.tax_amount  := round((coalesce(new.subtotal, 0) - coalesce(new.discount, 0))
                           * coalesce(new.tax_rate, 0) / 100.0, 2);
  new.total       := round(coalesce(new.subtotal, 0) - coalesce(new.discount, 0) + new.tax_amount, 2);
  new.balance_due := greatest(new.total - coalesce(new.amount_paid, 0), 0);

  if new.status not in ('draft', 'cancelled') then
    if new.total > 0 and coalesce(new.amount_paid, 0) >= new.total then
      new.status := 'paid';
    elsif coalesce(new.amount_paid, 0) > 0 then
      new.status := 'partial';
    elsif new.due_date < current_date then
      new.status := 'overdue';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_derive on public.invoices;
create trigger invoices_derive
  before insert or update on public.invoices
  for each row execute function public.invoices_derive();

-- ═══════════════════════════════════════════════════════════════════════════
--  PAYMENT ↔ INVOICE RECONCILIATION
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.payments_sync_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_paid       numeric(16, 2);
begin
  if tg_op = 'DELETE' then
    v_invoice_id := old.invoice_id;
  else
    -- An UPDATE may have moved the payment off an invoice; reconcile both.
    v_invoice_id := coalesce(new.invoice_id, case when tg_op = 'UPDATE' then old.invoice_id end);
  end if;

  if v_invoice_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select coalesce(sum(amount), 0)
    into v_paid
    from public.payments
   where invoice_id = v_invoice_id
     and status = 'paid';

  update public.invoices set amount_paid = v_paid where id = v_invoice_id;
  perform public.recalc_invoice_totals(v_invoice_id);

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists payments_sync_invoice on public.payments;
create trigger payments_sync_invoice
  after insert or update or delete on public.payments
  for each row execute function public.payments_sync_invoice();

-- Overdue is a function of the calendar, so derive it on write.
create or replace function public.payments_derive_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'paid' and new.paid_date is null then
    new.paid_date := current_date;
  end if;

  if new.status in ('upcoming', 'pending') and new.due_date < current_date then
    new.status := 'overdue';
  end if;

  return new;
end;
$$;

drop trigger if exists payments_derive_status on public.payments;
create trigger payments_derive_status
  before insert or update on public.payments
  for each row execute function public.payments_derive_status();

-- ═══════════════════════════════════════════════════════════════════════════
--  GOAL COMPLETION
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.goals_derive_status()
returns trigger
language plpgsql
as $$
begin
  if new.current_amount >= new.target_amount and new.status = 'active' then
    new.status := 'achieved';
  end if;
  return new;
end;
$$;

drop trigger if exists goals_derive_status on public.financial_goals;
create trigger goals_derive_status
  before insert or update on public.financial_goals
  for each row execute function public.goals_derive_status();


-- ============================================================================
-- ============================================================================
--
--  PART 2 — ROW LEVEL SECURITY
--
--  Every policy, the workspace-ownership helper, and the grants that keep the
--  anon role out of the public schema entirely.
--
--  (was 02_rls.sql)
-- ============================================================================
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  NOVATRIX DIGITAL — 02 ROW LEVEL SECURITY                                ║
-- ║                                                                          ║
-- ║  Rule: a row is visible only to the user whose id is on it, and it may   ║
-- ║  only ever be attached to a workspace that same user owns.               ║
-- ║                                                                          ║
-- ║  `(select auth.uid())` is used instead of a bare `auth.uid()` so Postgres║
-- ║  evaluates it once per statement (InitPlan) rather than once per row.    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
--  WORKSPACE OWNERSHIP HELPER
--  SECURITY DEFINER so referencing it from another table's policy does not
--  re-enter the workspaces policy and recurse.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.owns_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.workspaces w
     where w.id = p_workspace_id
       and w.user_id = (select auth.uid())
  );
$$;

revoke all on function public.owns_workspace(uuid) from public, anon;
grant execute on function public.owns_workspace(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
--  ENABLE + FORCE RLS ON EVERY TABLE
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'workspaces', 'accounts', 'categories', 'contacts',
    'transactions', 'invoices', 'invoice_items', 'payments',
    'financial_goals', 'budgets', 'recurring_transactions'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  PROFILES
--  A profile is keyed by auth.users.id, so `id` is the tenant column.
--  No INSERT policy: profiles are created by the signup trigger only.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════
--  WORKSPACES
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "workspaces_select_own" on public.workspaces;
create policy "workspaces_select_own" on public.workspaces
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "workspaces_insert_own" on public.workspaces;
create policy "workspaces_insert_own" on public.workspaces
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "workspaces_update_own" on public.workspaces;
create policy "workspaces_update_own" on public.workspaces
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "workspaces_delete_own" on public.workspaces;
create policy "workspaces_delete_own" on public.workspaces
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════
--  GENERIC WORKSPACE-SCOPED TABLES
--  Identical shape for every financial table that carries workspace_id.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
  tables text[] := array[
    'accounts', 'contacts', 'transactions', 'invoices', 'payments',
    'financial_goals', 'budgets', 'recurring_transactions'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists "%1$s_select_own" on public.%1$I;', t);
    execute format($p$
      create policy "%1$s_select_own" on public.%1$I
        for select to authenticated
        using (user_id = (select auth.uid()));
    $p$, t);

    execute format('drop policy if exists "%1$s_insert_own" on public.%1$I;', t);
    execute format($p$
      create policy "%1$s_insert_own" on public.%1$I
        for insert to authenticated
        with check (
          user_id = (select auth.uid())
          and public.owns_workspace(workspace_id)
        );
    $p$, t);

    execute format('drop policy if exists "%1$s_update_own" on public.%1$I;', t);
    execute format($p$
      create policy "%1$s_update_own" on public.%1$I
        for update to authenticated
        using (user_id = (select auth.uid()))
        with check (
          user_id = (select auth.uid())
          and public.owns_workspace(workspace_id)
        );
    $p$, t);

    execute format('drop policy if exists "%1$s_delete_own" on public.%1$I;', t);
    execute format($p$
      create policy "%1$s_delete_own" on public.%1$I
        for delete to authenticated
        using (user_id = (select auth.uid()));
    $p$, t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  CATEGORIES  — workspace_id may be NULL (shared across both workspaces)
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "categories_select_own" on public.categories;
create policy "categories_select_own" on public.categories
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "categories_insert_own" on public.categories;
create policy "categories_insert_own" on public.categories
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (workspace_id is null or public.owns_workspace(workspace_id))
  );

drop policy if exists "categories_update_own" on public.categories;
create policy "categories_update_own" on public.categories
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (workspace_id is null or public.owns_workspace(workspace_id))
  );

drop policy if exists "categories_delete_own" on public.categories;
create policy "categories_delete_own" on public.categories
  for delete to authenticated
  using (user_id = (select auth.uid()) and is_system = false);

-- ═══════════════════════════════════════════════════════════════════════════
--  INVOICE ITEMS — no workspace_id; ownership flows through the parent invoice
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "invoice_items_select_own" on public.invoice_items;
create policy "invoice_items_select_own" on public.invoice_items
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "invoice_items_insert_own" on public.invoice_items;
create policy "invoice_items_insert_own" on public.invoice_items
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.invoices i
       where i.id = invoice_id
         and i.user_id = (select auth.uid())
    )
  );

drop policy if exists "invoice_items_update_own" on public.invoice_items;
create policy "invoice_items_update_own" on public.invoice_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.invoices i
       where i.id = invoice_id
         and i.user_id = (select auth.uid())
    )
  );

drop policy if exists "invoice_items_delete_own" on public.invoice_items;
create policy "invoice_items_delete_own" on public.invoice_items
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════
--  GRANTS — the anon role must never touch financial data.
--  Sign-in happens against auth.*, so anon needs nothing in public.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'workspaces', 'accounts', 'categories', 'contacts',
    'transactions', 'invoices', 'invoice_items', 'payments',
    'financial_goals', 'budgets', 'recurring_transactions'
  ];
begin
  foreach t in array tables loop
    execute format('revoke all on public.%I from anon;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end $$;

revoke all on schema public from anon;
grant usage on schema public to authenticated;


-- ============================================================================
-- ============================================================================
--
--  PART 3 — FUNCTIONS & RPCs
--
--  Signup bootstrap, the scope resolver, and the dashboard/report RPCs.
--
--  (was 03_functions.sql)
-- ============================================================================
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  NOVATRIX DIGITAL — 03 FUNCTIONS, RPCs & SIGNUP BOOTSTRAP                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
--  SIGNUP BOOTSTRAP
--  On every new auth.users row: create the profile, both workspaces, a
--  starter account per workspace, and the default category set.
--  SECURITY DEFINER because the trigger runs before the user has a session.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_personal uuid;
  v_business uuid;
  v_name     text;
begin
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, 'there'), '@', 1)
  );

  -- 1 ── Profile
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    v_name,
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;

  -- 2 ── The two workspaces every account starts with
  insert into public.workspaces (user_id, name, type, is_default, icon, color)
  values (new.id, 'Personal', 'personal', true, 'user', '#C8FF00')
  on conflict (user_id, type) do nothing
  returning id into v_personal;

  if v_personal is null then
    select id into v_personal
      from public.workspaces
     where user_id = new.id and type = 'personal';
  end if;

  insert into public.workspaces (user_id, name, type, is_default, icon, color)
  values (new.id, 'Business', 'business', false, 'briefcase', '#A8E600')
  on conflict (user_id, type) do nothing
  returning id into v_business;

  if v_business is null then
    select id into v_business
      from public.workspaces
     where user_id = new.id and type = 'business';
  end if;

  -- 3 ── Starter accounts
  insert into public.accounts (user_id, workspace_id, name, type, institution, icon, is_primary)
  values
    (new.id, v_personal, 'Primary Savings', 'savings', 'Add your bank', 'landmark', true),
    (new.id, v_personal, 'Cash Wallet',     'cash',    null,            'wallet',   false),
    (new.id, v_business, 'Business Current','bank',    'Add your bank', 'building-2', true);

  -- 4 ── Default categories (shared: workspace_id null)
  insert into public.categories (user_id, workspace_id, name, kind, icon, color, is_system, sort_order)
  values
    -- Income
    (new.id, null, 'Salary',             'income',  'banknote',       '#C8FF00', true, 1),
    (new.id, null, 'Client Revenue',     'income',  'handshake',      '#B6FF00', true, 2),
    (new.id, null, 'Interest & Dividend','income',  'trending-up',    '#A8E600', true, 3),
    (new.id, null, 'Other Income',       'income',  'plus-circle',    '#89BF00', true, 4),
    -- Expense
    (new.id, null, 'Office Expenses',    'expense', 'building-2',     '#C8FF00', true, 10),
    (new.id, null, 'Salaries',           'expense', 'users',          '#A8E600', true, 11),
    (new.id, null, 'Rent & Utilities',   'expense', 'home',           '#89BF00', true, 12),
    (new.id, null, 'Marketing',          'expense', 'megaphone',      '#6E9900', true, 13),
    (new.id, null, 'Travel',             'expense', 'plane',          '#FFB547', true, 14),
    (new.id, null, 'Software & Tools',   'expense', 'monitor',        '#7DD3FC', true, 15),
    (new.id, null, 'Food & Dining',      'expense', 'utensils',       '#FF9F6C', true, 16),
    (new.id, null, 'Shopping',           'expense', 'shopping-bag',   '#FF5C6C', true, 17),
    (new.id, null, 'Health',             'expense', 'heart-pulse',    '#F472B6', true, 18),
    (new.id, null, 'Transport',          'expense', 'car',            '#A78BFA', true, 19),
    (new.id, null, 'Others',             'expense', 'more-horizontal','#6B7280', true, 20),
    -- Transfer
    (new.id, null, 'Account Transfer',   'transfer','arrow-left-right','#9CA3AF', true, 30);

  return new;
exception
  -- Never let bootstrap failure block account creation.
  when others then
    raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profile email in step with auth email changes.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ═══════════════════════════════════════════════════════════════════════════
--  SCOPE RESOLVER
--  Turns 'personal' | 'business' | 'combined' into the caller's workspace ids.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.workspace_ids_for_scope(p_scope text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(w.id), '{}'::uuid[])
    from public.workspaces w
   where w.user_id = (select auth.uid())
     and (
       lower(coalesce(p_scope, 'combined')) = 'combined'
       or w.type::text = lower(p_scope)
     );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  DASHBOARD SUMMARY
--  One round trip for every headline figure on the dashboard.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.dashboard_summary(p_scope text default 'combined')
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid            uuid := (select auth.uid());
  v_ws             uuid[];
  v_month_start    date := date_trunc('month', current_date)::date;
  v_prev_start     date := (date_trunc('month', current_date) - interval '1 month')::date;

  v_total          numeric := 0;
  v_personal       numeric := 0;
  v_business       numeric := 0;

  v_income_m       numeric := 0;
  v_expense_m      numeric := 0;
  v_income_p       numeric := 0;
  v_expense_p      numeric := 0;

  v_recv           numeric := 0;
  v_recv_count     int     := 0;
  v_upcoming       numeric := 0;
  v_upcoming_count int     := 0;

  v_net_prev       numeric := 0;
  v_growth         numeric := 0;
begin
  if v_uid is null then
    return json_build_object('error', 'not authenticated');
  end if;

  v_ws := public.workspace_ids_for_scope(p_scope);

  -- Balances, split by workspace type so COMBINED can show the breakdown.
  select
    coalesce(sum(a.current_balance), 0),
    coalesce(sum(a.current_balance) filter (where w.type = 'personal'), 0),
    coalesce(sum(a.current_balance) filter (where w.type = 'business'), 0)
  into v_total, v_personal, v_business
  from public.accounts a
  join public.workspaces w on w.id = a.workspace_id
  where a.user_id = v_uid
    and a.is_active
    and a.workspace_id = any (v_ws);

  -- This month vs last month flows.
  select
    coalesce(sum(t.amount) filter (where t.type = 'income'  and t.txn_date >= v_month_start), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense' and t.txn_date >= v_month_start), 0),
    coalesce(sum(t.amount) filter (where t.type = 'income'  and t.txn_date >= v_prev_start and t.txn_date < v_month_start), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense' and t.txn_date >= v_prev_start and t.txn_date < v_month_start), 0)
  into v_income_m, v_expense_m, v_income_p, v_expense_p
  from public.transactions t
  where t.user_id = v_uid
    and t.status = 'completed'
    and t.workspace_id = any (v_ws)
    and t.txn_date >= v_prev_start;

  -- Receivables: money customers still owe.
  select coalesce(sum(i.balance_due), 0), count(*)
    into v_recv, v_recv_count
  from public.invoices i
  where i.user_id = v_uid
    and i.workspace_id = any (v_ws)
    and i.status in ('sent', 'partial', 'overdue');

  -- Upcoming: money leaving soon.
  select coalesce(sum(p.amount), 0), count(*)
    into v_upcoming, v_upcoming_count
  from public.payments p
  where p.user_id = v_uid
    and p.workspace_id = any (v_ws)
    and p.direction = 'outgoing'
    and p.status in ('upcoming', 'pending', 'overdue');

  -- Growth: today's balance vs the balance implied at last month's close.
  v_net_prev := v_total - (v_income_m - v_expense_m);
  if v_net_prev <> 0 then
    v_growth := round(((v_total - v_net_prev) / abs(v_net_prev)) * 100, 1);
  end if;

  return json_build_object(
    'scope',                 lower(coalesce(p_scope, 'combined')),
    'total_balance',         v_total,
    'personal_balance',      v_personal,
    'business_balance',      v_business,
    'net_worth',             v_total,
    'net_worth_growth',      v_growth,
    'income_month',          v_income_m,
    'expense_month',         v_expense_m,
    'income_prev_month',     v_income_p,
    'expense_prev_month',    v_expense_p,
    'income_growth',         case when v_income_p > 0
                                  then round(((v_income_m - v_income_p) / v_income_p) * 100, 1)
                                  else 0 end,
    'expense_growth',        case when v_expense_p > 0
                                  then round(((v_expense_m - v_expense_p) / v_expense_p) * 100, 1)
                                  else 0 end,
    'savings',               v_income_m - v_expense_m,
    'savings_rate',          case when v_income_m > 0
                                  then round(((v_income_m - v_expense_m) / v_income_m) * 100, 1)
                                  else 0 end,
    'pending_receivables',   v_recv,
    'receivable_count',      v_recv_count,
    'upcoming_payments',     v_upcoming,
    'upcoming_count',        v_upcoming_count
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  CASH FLOW SERIES — income vs expenses, month by month
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cash_flow_series(
  p_scope  text default 'combined',
  p_months integer default 6
)
returns table (
  bucket   date,
  label    text,
  income   numeric,
  expense  numeric,
  net      numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with span as (
    select generate_series(
      date_trunc('month', current_date) - ((greatest(p_months, 1) - 1) * interval '1 month'),
      date_trunc('month', current_date),
      interval '1 month'
    )::date as bucket
  ),
  flows as (
    select
      date_trunc('month', t.txn_date)::date as bucket,
      coalesce(sum(t.amount) filter (where t.type = 'income'), 0)  as income,
      coalesce(sum(t.amount) filter (where t.type = 'expense'), 0) as expense
    from public.transactions t
    where t.user_id = (select auth.uid())
      and t.status = 'completed'
      and t.workspace_id = any (public.workspace_ids_for_scope(p_scope))
      and t.txn_date >= (date_trunc('month', current_date)
                         - ((greatest(p_months, 1) - 1) * interval '1 month'))::date
    group by 1
  )
  select
    s.bucket,
    to_char(s.bucket, 'Mon')            as label,
    coalesce(f.income, 0)               as income,
    coalesce(f.expense, 0)              as expense,
    coalesce(f.income, 0) - coalesce(f.expense, 0) as net
  from span s
  left join flows f on f.bucket = s.bucket
  order by s.bucket;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  EXPENSE BREAKDOWN — donut chart source
--  The scope resolver is inlined rather than joined in: a comma-joined CTE
--  is not visible to a LEFT JOIN's ON clause in the same FROM list.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.expense_breakdown(
  p_scope text default 'combined',
  p_from  date default null,
  p_to    date default null
)
returns table (
  category_id uuid,
  name        text,
  color       text,
  icon        text,
  amount      numeric,
  percentage  numeric
)
language sql
stable
security definer
set search_path = public
as $fn$
  with spend as (
    select
      t.category_id                     as category_id,
      coalesce(c.name, 'Uncategorised') as name,
      coalesce(c.color, '#6B7280')      as color,
      coalesce(c.icon, 'tag')           as icon,
      sum(t.amount)                     as amount
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.user_id = (select auth.uid())
      and t.type = 'expense'
      and t.status = 'completed'
      and t.workspace_id = any (public.workspace_ids_for_scope(p_scope))
      and t.txn_date >= coalesce(p_from, date_trunc('month', current_date)::date)
      and t.txn_date <= coalesce(p_to, current_date)
    group by t.category_id, c.name, c.color, c.icon
  )
  select
    s.category_id,
    s.name,
    s.color,
    s.icon,
    s.amount,
    case when sum(s.amount) over () > 0
         then round((s.amount / sum(s.amount) over ()) * 100, 1)
         else 0 end as percentage
  from spend s
  order by s.amount desc;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
--  BUDGET PROGRESS — spend against each active budget for the current period
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.budget_progress(p_scope text default 'combined')
returns table (
  id              uuid,
  name            text,
  category_name   text,
  category_color  text,
  period          budget_period,
  amount          numeric,
  spent           numeric,
  remaining       numeric,
  percentage      numeric,
  alert_threshold integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    b.id,
    b.name,
    coalesce(c.name, 'All categories')                as category_name,
    coalesce(c.color, '#C8FF00')                      as category_color,
    b.period,
    b.amount,
    coalesce(spent.total, 0)                          as spent,
    greatest(b.amount - coalesce(spent.total, 0), 0)  as remaining,
    case when b.amount > 0
         then round((coalesce(spent.total, 0) / b.amount) * 100, 1)
         else 0 end                                   as percentage,
    b.alert_threshold
  from public.budgets b
  left join public.categories c on c.id = b.category_id
  left join lateral (
    select sum(t.amount) as total
      from public.transactions t
     where t.user_id = b.user_id
       and t.workspace_id = b.workspace_id
       and t.type = 'expense'
       and t.status = 'completed'
       and (b.category_id is null or t.category_id = b.category_id)
       and t.txn_date >= case b.period
                           when 'weekly'    then date_trunc('week', current_date)::date
                           when 'monthly'   then date_trunc('month', current_date)::date
                           when 'quarterly' then date_trunc('quarter', current_date)::date
                           else date_trunc('year', current_date)::date
                         end
  ) spent on true
  where b.user_id = (select auth.uid())
    and b.is_active
    and b.workspace_id = any (public.workspace_ids_for_scope(p_scope))
  order by percentage desc;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
--  NEXT INVOICE NUMBER — e.g. NOV-2026-0007
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.next_invoice_number(p_workspace_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_year text := to_char(current_date, 'YYYY');
  v_seq  int;
begin
  select coalesce(max(
           nullif(regexp_replace(invoice_number, '^.*-', ''), '')::int
         ), 0) + 1
    into v_seq
    from public.invoices
   where user_id = (select auth.uid())
     and workspace_id = p_workspace_id
     and invoice_number ~ ('^NOV-' || v_year || '-\d+$');

  return 'NOV-' || v_year || '-' || lpad(coalesce(v_seq, 1)::text, 4, '0');
exception
  when others then
    return 'NOV-' || v_year || '-0001';
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  RECURRING RUNNER
--  Materialises every due recurring rule into the ledger and rolls the date
--  forward. Safe to call repeatedly; call it on app load or from a cron job.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.run_due_recurring()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.recurring_transactions%rowtype;
  v_count  int := 0;
  v_step   interval;
begin
  for r in
    select * from public.recurring_transactions
     where user_id = (select auth.uid())
       and is_active
       and auto_post
       and next_run_date <= current_date
       and (end_date is null or next_run_date <= end_date)
  loop
    insert into public.transactions (
      user_id, workspace_id, account_id, category_id, contact_id, recurring_id,
      type, status, amount, currency, txn_date, description, payment_method
    )
    values (
      r.user_id, r.workspace_id, r.account_id, r.category_id, r.contact_id, r.id,
      r.type, 'completed', r.amount, r.currency, r.next_run_date,
      coalesce(nullif(r.description, ''), r.name), 'Auto — recurring'
    );

    v_step := case r.frequency
                when 'daily'     then make_interval(days  => r.interval_count)
                when 'weekly'    then make_interval(weeks => r.interval_count)
                when 'biweekly'  then make_interval(weeks => r.interval_count * 2)
                when 'monthly'   then make_interval(months => r.interval_count)
                when 'quarterly' then make_interval(months => r.interval_count * 3)
                else                  make_interval(years => r.interval_count)
              end;

    update public.recurring_transactions
       set last_run_date = next_run_date,
           next_run_date = (next_run_date + v_step)::date,
           run_count     = run_count + 1
     where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  EXECUTE GRANTS — authenticated only
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  fn text;
  fns text[] := array[
    'workspace_ids_for_scope(text)',
    'dashboard_summary(text)',
    'cash_flow_series(text,integer)',
    'expense_breakdown(text,date,date)',
    'budget_progress(text)',
    'next_invoice_number(uuid)',
    'run_due_recurring()'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;


-- ============================================================================
-- ============================================================================
--
--  PART 4 — STORAGE
--
--  The avatars and attachments buckets, with uid-scoped path policies.
--
--  (was 04_storage.sql)
-- ============================================================================
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  NOVATRIX DIGITAL — 04 STORAGE                                           ║
-- ║                                                                          ║
-- ║  Two buckets:                                                            ║
-- ║    avatars      public read, owner write   → profile pictures            ║
-- ║    attachments  fully private              → receipts, invoice PDFs      ║
-- ║                                                                          ║
-- ║  Path contract for BOTH buckets:  <auth.uid()>/<anything>                ║
-- ║  The first path segment must equal the caller's uid — that is what the   ║
-- ║  policies below enforce.                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2097152,
   array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']),
  ('attachments', 'attachments', false, 10485760,
   array['image/png', 'image/jpeg', 'image/webp', 'application/pdf',
         'text/csv', 'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ═══════════════════════════════════════════════════════════════════════════
--  AVATARS — world-readable, owner-writable
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ═══════════════════════════════════════════════════════════════════════════
--  ATTACHMENTS — private; every operation is uid-scoped
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "attachments_owner_read" on storage.objects;
create policy "attachments_owner_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "attachments_owner_insert" on storage.objects;
create policy "attachments_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "attachments_owner_update" on storage.objects;
create policy "attachments_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "attachments_owner_delete" on storage.objects;
create policy "attachments_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- ============================================================================
-- ============================================================================
--
--  PART 5 — ACCOUNT MAINTENANCE
--
--  reset_my_data(), scoped to the calling user.
--
--  The demo seed that used to live here has been removed. It opened with
--  nine `delete from … where user_id = auth.uid()` statements before writing
--  its sample book, so pressing "Load demo data" on an account holding real
--  records would have erased them. The app no longer offers it, and Part 7
--  drops the functions from databases that already have them.
--
--  (was 05_seed.sql)
-- ============================================================================
-- ============================================================================



-- ═══════════════════════════════════════════════════════════════════════════
--  RESET — wipe the caller's financial rows without touching the account
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.reset_my_data()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not authenticated');
  end if;

  delete from public.transactions           where user_id = v_uid;
  delete from public.invoice_items          where user_id = v_uid;
  delete from public.payments               where user_id = v_uid;
  delete from public.invoices               where user_id = v_uid;
  delete from public.financial_goals        where user_id = v_uid;
  delete from public.budgets                where user_id = v_uid;
  delete from public.recurring_transactions where user_id = v_uid;
  delete from public.contacts               where user_id = v_uid;
  delete from public.accounts               where user_id = v_uid;

  update public.profiles set onboarded = false where id = v_uid;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.reset_my_data() from public, anon;
grant execute on function public.reset_my_data() to authenticated;



-- ============================================================================
-- ============================================================================
--
--  PART 6 — SUBSCRIPTIONS, REMINDERS & EMAIL
--
--  Recurring services with renewal + trial tracking, the reminder queue
--  that feeds them, and the server-side hooks the Resend mailer calls.
--
--  (was 06_subscriptions_reminders.sql)
-- ============================================================================
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  NOVATRIX DIGITAL — PART 6 · SUBSCRIPTIONS, REMINDERS & EMAIL            ║
-- ║                                                                          ║
-- ║  Run AFTER novatrix_complete.sql. Idempotent, like the rest.             ║
-- ║                                                                          ║
-- ║  Adds:                                                                   ║
-- ║    subscriptions        recurring services with renewal + trial tracking ║
-- ║    reminders            scheduled nudges, optionally delivered by email  ║
-- ║    notification prefs   per-user email settings on `profiles`            ║
-- ║                                                                          ║
-- ║  Email is sent by the `send-reminders` Edge Function via Resend.         ║
-- ║  The RESEND_API_KEY is a SERVER secret — it must never reach the         ║
-- ║  browser bundle. See supabase/functions/send-reminders/index.ts.         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
--  ENUMS
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_type where typname = 'billing_cycle') then
    create type billing_cycle as enum
      ('weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'lifetime');
  end if;

  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type subscription_status as enum
      ('active', 'trial', 'paused', 'cancelled', 'expired');
  end if;

  if not exists (select 1 from pg_type where typname = 'reminder_status') then
    create type reminder_status as enum
      ('scheduled', 'sent', 'failed', 'dismissed', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'reminder_channel') then
    create type reminder_channel as enum ('email', 'in_app', 'both');
  end if;

  if not exists (select 1 from pg_type where typname = 'reminder_kind') then
    create type reminder_kind as enum
      ('subscription', 'payment', 'invoice', 'goal', 'budget', 'custom');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  NOTIFICATION PREFERENCES  (columns on profiles)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.profiles
  add column if not exists email_reminders     boolean not null default true,
  add column if not exists reminder_lead_days  integer not null default 3
    check (reminder_lead_days between 0 and 30),
  add column if not exists weekly_digest       boolean not null default false,
  add column if not exists notify_email        text,
  add column if not exists last_digest_at      timestamptz;

comment on column public.profiles.notify_email is
  'Overrides the sign-in address for notifications. Falls back to profiles.email.';

-- ═══════════════════════════════════════════════════════════════════════════
--  SUBSCRIPTIONS
--  Personal-first (Netflix, gym, insurance) but works for business SaaS too.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  account_id         uuid references public.accounts(id) on delete set null,
  category_id        uuid references public.categories(id) on delete set null,
  contact_id         uuid references public.contacts(id) on delete set null,

  name               text not null,
  vendor             text,
  plan               text,
  description        text,

  amount             numeric(16, 2) not null check (amount >= 0),
  currency           text not null default 'INR',
  billing_cycle      billing_cycle not null default 'monthly',
  cycle_count        integer not null default 1 check (cycle_count > 0),

  status             subscription_status not null default 'active',
  started_on         date not null default current_date,
  next_renewal_date  date not null default current_date,
  last_charged_on    date,
  trial_ends_on      date,
  cancelled_on       date,
  ends_on            date,

  auto_renew         boolean not null default true,
  -- When true, each renewal writes a real expense into the ledger.
  auto_post          boolean not null default false,
  payment_method     text,
  cancel_url         text,
  website            text,

  -- Per-subscription override; falls back to profiles.reminder_lead_days.
  reminder_days_before integer check (reminder_days_before between 0 and 60),
  remind_by_email    boolean not null default true,

  icon               text not null default 'repeat',
  color              text not null default '#C8FF00',
  notes              text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists subscriptions_user_idx      on public.subscriptions (user_id);
create index if not exists subscriptions_workspace_idx on public.subscriptions (workspace_id);
create index if not exists subscriptions_renewal_idx   on public.subscriptions (next_renewal_date)
  where status in ('active', 'trial');

-- ═══════════════════════════════════════════════════════════════════════════
--  REMINDERS
--  Either auto-generated from a subscription/payment/invoice, or free-form.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.reminders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  kind            reminder_kind not null default 'custom',
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  payment_id      uuid references public.payments(id) on delete cascade,
  invoice_id      uuid references public.invoices(id) on delete cascade,
  goal_id         uuid references public.financial_goals(id) on delete cascade,

  title           text not null,
  body            text,
  amount          numeric(16, 2),
  currency        text not null default 'INR',
  due_on          date,

  remind_at       timestamptz not null default now(),
  channel         reminder_channel not null default 'email',
  status          reminder_status not null default 'scheduled',

  sent_at         timestamptz,
  attempts        integer not null default 0,
  last_error      text,
  -- Stops the generator creating the same nudge twice.
  dedupe_key      text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint reminders_dedupe_unique unique (user_id, dedupe_key)
);

create index if not exists reminders_user_idx   on public.reminders (user_id);
create index if not exists reminders_due_idx    on public.reminders (remind_at)
  where status = 'scheduled';
create index if not exists reminders_status_idx on public.reminders (status);

-- ═══════════════════════════════════════════════════════════════════════════
--  UPDATED_AT
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['subscriptions', 'reminders'] loop
    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$I;', t);
    execute format(
      'create trigger set_updated_at_%1$s before update on public.%1$I
       for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  SUBSCRIPTION DERIVATIONS
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.subscription_cycle_interval(
  p_cycle billing_cycle,
  p_count integer
)
returns interval
language sql
immutable
as $$
  select case p_cycle
           when 'weekly'      then make_interval(weeks  => greatest(p_count, 1))
           when 'monthly'     then make_interval(months => greatest(p_count, 1))
           when 'quarterly'   then make_interval(months => greatest(p_count, 1) * 3)
           when 'half_yearly' then make_interval(months => greatest(p_count, 1) * 6)
           when 'yearly'      then make_interval(years  => greatest(p_count, 1))
           else make_interval(years => 100)   -- 'lifetime': effectively never
         end;
$$;

create or replace function public.subscriptions_derive()
returns trigger
language plpgsql
as $$
begin
  -- A trial that has run out becomes an ordinary active subscription.
  if new.status = 'trial' and new.trial_ends_on is not null
     and new.trial_ends_on < current_date then
    new.status := 'active';
  end if;

  if new.status = 'cancelled' and new.cancelled_on is null then
    new.cancelled_on := current_date;
  end if;

  if new.ends_on is not null and new.ends_on < current_date
     and new.status in ('active', 'trial') then
    new.status := 'expired';
  end if;

  -- Never leave a renewal date in the past on an active subscription.
  if new.status in ('active', 'trial') and new.auto_renew
     and new.next_renewal_date < current_date then
    while new.next_renewal_date < current_date loop
      new.next_renewal_date :=
        (new.next_renewal_date
         + public.subscription_cycle_interval(new.billing_cycle, new.cycle_count))::date;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists subscriptions_derive on public.subscriptions;
create trigger subscriptions_derive
  before insert or update on public.subscriptions
  for each row execute function public.subscriptions_derive();

-- ═══════════════════════════════════════════════════════════════════════════
--  MONTHLY-EQUIVALENT COST + SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.subscription_monthly_cost(
  p_amount numeric,
  p_cycle  billing_cycle,
  p_count  integer
)
returns numeric
language sql
immutable
as $$
  select case p_cycle
           when 'weekly'      then (p_amount * 52.0 / 12.0) / greatest(p_count, 1)
           when 'monthly'     then p_amount / greatest(p_count, 1)
           when 'quarterly'   then p_amount / (3 * greatest(p_count, 1))
           when 'half_yearly' then p_amount / (6 * greatest(p_count, 1))
           when 'yearly'      then p_amount / (12 * greatest(p_count, 1))
           else 0                              -- lifetime has no recurring cost
         end;
$$;

create or replace function public.subscription_summary(p_scope text default 'combined')
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ws  uuid[];
  v_monthly numeric := 0;
  v_yearly  numeric := 0;
  v_active  int := 0;
  v_trials  int := 0;
  v_due7    int := 0;
  v_due7_amt numeric := 0;
begin
  if v_uid is null then
    return json_build_object('error', 'not authenticated');
  end if;

  v_ws := public.workspace_ids_for_scope(p_scope);

  select
    coalesce(sum(public.subscription_monthly_cost(s.amount, s.billing_cycle, s.cycle_count)), 0),
    count(*) filter (where s.status = 'active'),
    count(*) filter (where s.status = 'trial')
  into v_monthly, v_active, v_trials
  from public.subscriptions s
  where s.user_id = v_uid
    and s.workspace_id = any (v_ws)
    and s.status in ('active', 'trial');

  select count(*), coalesce(sum(s.amount), 0)
    into v_due7, v_due7_amt
  from public.subscriptions s
  where s.user_id = v_uid
    and s.workspace_id = any (v_ws)
    and s.status in ('active', 'trial')
    and s.next_renewal_date between current_date and (current_date + 7);

  v_yearly := v_monthly * 12;

  return json_build_object(
    'monthly_cost',    round(v_monthly, 2),
    'yearly_cost',     round(v_yearly, 2),
    'active_count',    v_active,
    'trial_count',     v_trials,
    'due_week_count',  v_due7,
    'due_week_amount', v_due7_amt
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  RENEWAL RUNNER
--  Rolls renewal dates forward and, where auto_post is on, writes the charge
--  into the ledger. Safe to call repeatedly.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.run_due_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s       public.subscriptions%rowtype;
  v_count int := 0;
begin
  for s in
    select * from public.subscriptions
     where user_id = (select auth.uid())
       and status in ('active', 'trial')
       and auto_renew
       and next_renewal_date <= current_date
       and (ends_on is null or next_renewal_date <= ends_on)
  loop
    if s.auto_post then
      insert into public.transactions (
        user_id, workspace_id, account_id, category_id, contact_id,
        type, status, amount, currency, txn_date, description, payment_method
      )
      values (
        s.user_id, s.workspace_id, s.account_id, s.category_id, s.contact_id,
        'expense', 'completed', s.amount, s.currency, s.next_renewal_date,
        s.name || coalesce(' — ' || s.plan, ''), coalesce(s.payment_method, 'Auto Debit')
      );
    end if;

    update public.subscriptions
       set last_charged_on   = next_renewal_date,
           next_renewal_date =
             (next_renewal_date
              + public.subscription_cycle_interval(billing_cycle, cycle_count))::date
     where id = s.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  REMINDER GENERATOR
--  Creates the nudges the mailer will pick up. `dedupe_key` makes it safe to
--  run as often as you like — one reminder per event per due date.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.generate_reminders(p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := coalesce(p_user, (select auth.uid()));
  v_lead  int;
  v_made  int := 0;
  r       record;
begin
  if v_uid is null then
    return 0;
  end if;

  select coalesce(reminder_lead_days, 3) into v_lead
    from public.profiles where id = v_uid;
  v_lead := coalesce(v_lead, 3);

  -- ── Subscription renewals ───────────────────────────────────────────────
  for r in
    select s.*, coalesce(s.reminder_days_before, v_lead) as lead
      from public.subscriptions s
     where s.user_id = v_uid
       and s.status in ('active', 'trial')
       and s.remind_by_email
       and s.next_renewal_date
             between current_date
                 and (current_date + coalesce(s.reminder_days_before, v_lead))
  loop
    insert into public.reminders (
      user_id, workspace_id, kind, subscription_id, title, body,
      amount, currency, due_on, remind_at, channel, dedupe_key
    )
    values (
      r.user_id, r.workspace_id, 'subscription', r.id,
      r.name || ' renews on ' || to_char(r.next_renewal_date, 'DD Mon YYYY'),
      coalesce(r.vendor, r.name) ||
        case when r.plan is not null then ' · ' || r.plan else '' end,
      r.amount, r.currency, r.next_renewal_date, now(), 'email',
      'sub:' || r.id::text || ':' || r.next_renewal_date::text
    )
    on conflict (user_id, dedupe_key) do nothing;

    if found then v_made := v_made + 1; end if;
  end loop;

  -- ── Trials about to convert ─────────────────────────────────────────────
  for r in
    select * from public.subscriptions
     where user_id = v_uid
       and status = 'trial'
       and trial_ends_on is not null
       and trial_ends_on between current_date and (current_date + v_lead)
  loop
    insert into public.reminders (
      user_id, workspace_id, kind, subscription_id, title, body,
      amount, currency, due_on, remind_at, channel, dedupe_key
    )
    values (
      r.user_id, r.workspace_id, 'subscription', r.id,
      'Free trial for ' || r.name || ' ends on ' || to_char(r.trial_ends_on, 'DD Mon YYYY'),
      'Cancel before this date to avoid being charged.',
      r.amount, r.currency, r.trial_ends_on, now(), 'email',
      'trial:' || r.id::text || ':' || r.trial_ends_on::text
    )
    on conflict (user_id, dedupe_key) do nothing;

    if found then v_made := v_made + 1; end if;
  end loop;

  -- ── Scheduled payments falling due ──────────────────────────────────────
  for r in
    select * from public.payments
     where user_id = v_uid
       and status in ('upcoming', 'pending', 'overdue')
       and due_date between (current_date - 30) and (current_date + v_lead)
  loop
    insert into public.reminders (
      user_id, workspace_id, kind, payment_id, title, body,
      amount, currency, due_on, remind_at, channel, dedupe_key
    )
    values (
      r.user_id, r.workspace_id, 'payment', r.id,
      case when r.due_date < current_date
           then r.name || ' is overdue'
           else r.name || ' is due on ' || to_char(r.due_date, 'DD Mon YYYY') end,
      coalesce(r.method, 'Scheduled payment'),
      r.amount, r.currency, r.due_date, now(), 'email',
      'pay:' || r.id::text || ':' || r.due_date::text
    )
    on conflict (user_id, dedupe_key) do nothing;

    if found then v_made := v_made + 1; end if;
  end loop;

  -- ── Invoices going overdue ──────────────────────────────────────────────
  for r in
    select i.*, c.name as customer
      from public.invoices i
      left join public.contacts c on c.id = i.contact_id
     where i.user_id = v_uid
       and i.status in ('sent', 'partial', 'overdue')
       and i.due_date between (current_date - 30) and (current_date + v_lead)
  loop
    insert into public.reminders (
      user_id, workspace_id, kind, invoice_id, title, body,
      amount, currency, due_on, remind_at, channel, dedupe_key
    )
    values (
      r.user_id, r.workspace_id, 'invoice', r.id,
      'Invoice ' || r.invoice_number ||
        case when r.due_date < current_date then ' is overdue' else ' is due soon' end,
      coalesce(r.customer, 'Customer'),
      r.balance_due, r.currency, r.due_date, now(), 'email',
      'inv:' || r.id::text || ':' || r.due_date::text
    )
    on conflict (user_id, dedupe_key) do nothing;

    if found then v_made := v_made + 1; end if;
  end loop;

  return v_made;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  MAILER SUPPORT
--  `pending_reminder_batch` is called by the Edge Function with the SERVICE
--  ROLE key. It is SECURITY DEFINER and takes no uid, so it must never be
--  granted to `authenticated`.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.pending_reminder_batch(p_limit integer default 100)
returns table (
  reminder_id uuid,
  user_id     uuid,
  email       text,
  full_name   text,
  title       text,
  body        text,
  amount      numeric,
  currency    text,
  due_on      date,
  kind        reminder_kind
)
language sql
security definer
set search_path = public
as $$
  select
    r.id,
    r.user_id,
    coalesce(nullif(p.notify_email, ''), p.email) as email,
    coalesce(nullif(p.full_name, ''), 'there')    as full_name,
    r.title,
    r.body,
    r.amount,
    r.currency,
    r.due_on,
    r.kind
  from public.reminders r
  join public.profiles p on p.id = r.user_id
  where r.status = 'scheduled'
    and r.remind_at <= now()
    and r.channel in ('email', 'both')
    and p.email_reminders
    and coalesce(nullif(p.notify_email, ''), p.email) <> ''
    and r.attempts < 3
  order by r.remind_at
  limit greatest(p_limit, 1);
$$;

create or replace function public.mark_reminder_sent(
  p_id    uuid,
  p_ok    boolean,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.reminders
     set status     = case when p_ok then 'sent'::reminder_status
                           when attempts + 1 >= 3 then 'failed'::reminder_status
                           else 'scheduled'::reminder_status end,
         sent_at    = case when p_ok then now() else sent_at end,
         attempts   = attempts + 1,
         last_error = p_error
   where id = p_id;
$$;

/** Generates reminders for EVERY user — the scheduled entry point. */
create or replace function public.generate_all_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  u      record;
  v_total int := 0;
begin
  for u in select id from public.profiles where email_reminders loop
    v_total := v_total + public.generate_reminders(u.id);
  end loop;
  return v_total;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
begin
  foreach t in array array['subscriptions', 'reminders'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);

    execute format('drop policy if exists "%1$s_select_own" on public.%1$I;', t);
    execute format($p$
      create policy "%1$s_select_own" on public.%1$I
        for select to authenticated
        using (user_id = (select auth.uid()));
    $p$, t);

    execute format('drop policy if exists "%1$s_insert_own" on public.%1$I;', t);
    execute format($p$
      create policy "%1$s_insert_own" on public.%1$I
        for insert to authenticated
        with check (
          user_id = (select auth.uid())
          and public.owns_workspace(workspace_id)
        );
    $p$, t);

    execute format('drop policy if exists "%1$s_update_own" on public.%1$I;', t);
    execute format($p$
      create policy "%1$s_update_own" on public.%1$I
        for update to authenticated
        using (user_id = (select auth.uid()))
        with check (
          user_id = (select auth.uid())
          and public.owns_workspace(workspace_id)
        );
    $p$, t);

    execute format('drop policy if exists "%1$s_delete_own" on public.%1$I;', t);
    execute format($p$
      create policy "%1$s_delete_own" on public.%1$I
        for delete to authenticated
        using (user_id = (select auth.uid()));
    $p$, t);

    execute format('revoke all on public.%I from anon;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  EXECUTE GRANTS
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  fn text;
  user_fns text[] := array[
    'subscription_summary(text)',
    'run_due_subscriptions()',
    'generate_reminders(uuid)',
    'subscription_monthly_cost(numeric,billing_cycle,integer)',
    'subscription_cycle_interval(billing_cycle,integer)'
  ];
  -- Service-role only: these read across ALL users.
  admin_fns text[] := array[
    'pending_reminder_batch(integer)',
    'mark_reminder_sent(uuid,boolean,text)',
    'generate_all_reminders()'
  ];
begin
  foreach fn in array user_fns loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;

  foreach fn in array admin_fns loop
    execute format('revoke all on function public.%s from public, anon, authenticated;', fn);
    execute format('grant execute on function public.%s to service_role;', fn);
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  TEST DELIVERY
--  Queues a single reminder for the CALLING user so they can prove the Resend
--  pipeline end to end from Settings. Scoped to auth.uid(), so it can never
--  email anybody else.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.send_test_reminder()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_ws    uuid;
  v_email text;
  v_on    boolean;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not authenticated');
  end if;

  select coalesce(nullif(notify_email, ''), email), email_reminders
    into v_email, v_on
    from public.profiles where id = v_uid;

  if v_email is null or v_email = '' then
    return json_build_object('ok', false, 'error', 'No email address on your profile.');
  end if;

  if not v_on then
    return json_build_object(
      'ok', false,
      'error', 'Email reminders are switched off. Turn them on and try again.');
  end if;

  select id into v_ws
    from public.workspaces where user_id = v_uid and is_default
    limit 1;

  if v_ws is null then
    select id into v_ws from public.workspaces where user_id = v_uid limit 1;
  end if;

  if v_ws is null then
    return json_build_object('ok', false, 'error', 'No workspace found.');
  end if;

  insert into public.reminders (
    user_id, workspace_id, kind, title, body,
    remind_at, channel, status, dedupe_key
  )
  values (
    v_uid, v_ws, 'custom',
    'Test reminder from Novatrix Digital',
    'If this reached your inbox, reminder email is working. ' ||
    'Renewal, payment and invoice reminders will arrive the same way.',
    now(), 'email', 'scheduled',
    'test:' || v_uid::text || ':' || extract(epoch from now())::bigint::text
  );

  return json_build_object('ok', true, 'email', v_email);
end;
$$;

revoke all on function public.send_test_reminder() from public, anon;
grant execute on function public.send_test_reminder() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
--  OPTIONAL — nightly schedule inside Postgres
--  Requires the pg_cron and pg_net extensions (Database → Extensions).
--  Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> before running.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- -- 1. Build the day's reminders at 06:30 IST (01:00 UTC)
-- select cron.schedule(
--   'novatrix-generate-reminders', '0 1 * * *',
--   $cron$ select public.generate_all_reminders(); $cron$
-- );
--
-- -- 2. Hand them to the mailer five minutes later
-- select cron.schedule(
--   'novatrix-send-reminders', '5 1 * * *',
--   $cron$
--     select net.http_post(
--       url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
--       headers := jsonb_build_object(
--                    'Content-Type', 'application/json',
--                    'Authorization', 'Bearer <SERVICE_ROLE_KEY>'),
--       body    := '{}'::jsonb
--     );
--   $cron$
-- );
--
-- -- Inspect:  select * from cron.job;
-- -- Remove:   select cron.unschedule('novatrix-send-reminders');



-- ============================================================================
-- ============================================================================
--
--  PART 7 — CASH, ONE PRIMARY ACCOUNT, PAYMENTS → LEDGER
--
--  Was migration_002_cash_and_fixes.sql.
--
--  Cash stops being a parallel system: it is an ordinary account of type 'cash',
--  so an entry booked against it moves cash in hand AND counts in the month's
--  spend, because the same ledger triggers do both.
--
--  Also here: exactly one primary account per user, enforced by trigger rather
--  than by hoping the UI behaves; and a payment marked paid now posts to the
--  ledger instead of only changing its own status.
--
--  §2 adds a zero-balance "Cash in Hand" account to any workspace that does not
--  have one. Zero balance means zero effect on your totals.
--
-- ============================================================================
-- ============================================================================

begin;

-- ═══════════════════════════════════════════════════════════════════════════
--  §1  PRIMARY ACCOUNT — exactly one, across the whole account
--
--  `is_primary` was a plain boolean with nothing enforcing it: no unique
--  index, no trigger, and nothing in the form clearing the flag elsewhere.
--  Ticking "make this primary" on a Personal account therefore left the
--  Business one flagged too, and the star showed in both places.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.accounts_enforce_single_primary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Clear the flag everywhere else this user owns. The trigger is guarded by
  -- WHEN (new.is_primary), and this statement only ever sets it to false, so
  -- the recursive fire is a no-op rather than a loop.
  update public.accounts
     set is_primary = false
   where user_id = new.user_id
     and id <> new.id
     and is_primary;

  return null;
end;
$$;

drop trigger if exists accounts_single_primary on public.accounts;
create trigger accounts_single_primary
  after insert or update of is_primary on public.accounts
  for each row
  when (new.is_primary)
  execute function public.accounts_enforce_single_primary();

-- ── One-time correction ──────────────────────────────────────────────────
--  Signup used to flag two accounts primary (Personal savings + Business
--  current), so most existing users have two. Keep the most recently touched
--  one — that is the one they last chose deliberately — and clear the rest.
--  Only the boolean changes; no balance, name or link is affected.
with keeper as (
  select distinct on (user_id) id, user_id
    from public.accounts
   where is_primary
   order by user_id, updated_at desc, created_at desc
)
update public.accounts a
   set is_primary = false
  from keeper k
 where a.user_id = k.user_id
   and a.is_primary
   and a.id <> k.id;


-- ═══════════════════════════════════════════════════════════════════════════
--  §2  CASH SYSTEM
--
--  Cash is modelled as an ordinary account of type 'cash', which means it
--  rides on the existing ledger triggers for free: a cash expense lowers
--  cash in hand AND lands in the month's spend, and a bank→cash withdrawal
--  is just a transfer, so both sides move together.
-- ═══════════════════════════════════════════════════════════════════════════

-- Give every workspace a cash account if it has none. Opening balance 0, so
-- this cannot shift any figure you are already looking at — it just gives
-- cash somewhere to live. Set the real amount from the app once it appears.
insert into public.accounts (user_id, workspace_id, name, type, icon, color, opening_balance, current_balance)
select w.user_id, w.id, 'Cash in Hand', 'cash', 'wallet', '#A8E600', 0, 0
  from public.workspaces w
 where not exists (
   select 1 from public.accounts a
    where a.workspace_id = w.id
      and a.type = 'cash'
 );

-- ── Cash headline figures ────────────────────────────────────────────────
create or replace function public.cash_summary(p_scope text default 'combined')
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_ws          uuid[];
  v_month_start date := date_trunc('month', current_date)::date;

  v_in_hand     numeric := 0;
  v_accounts    int     := 0;
  v_spent_m     numeric := 0;
  v_spent_all   numeric := 0;
  v_recv_m      numeric := 0;
  v_last        date;
  v_untracked   numeric := 0;
  v_untracked_n int     := 0;
begin
  if v_uid is null then
    return json_build_object('error', 'not authenticated');
  end if;

  v_ws := public.workspace_ids_for_scope(p_scope);

  select coalesce(sum(a.current_balance), 0), count(*)
    into v_in_hand, v_accounts
    from public.accounts a
   where a.user_id = v_uid
     and a.is_active
     and a.type = 'cash'
     and a.workspace_id = any (v_ws);

  -- Money that actually left / entered a cash account.
  select
    coalesce(sum(t.amount) filter (
      where t.type = 'expense' and t.txn_date >= v_month_start), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0),
    coalesce(sum(t.amount) filter (
      where t.type = 'income' and t.txn_date >= v_month_start), 0),
    max(t.txn_date)
  into v_spent_m, v_spent_all, v_recv_m, v_last
  from public.transactions t
  join public.accounts a on a.id = t.account_id
 where t.user_id = v_uid
   and t.status = 'completed'
   and a.type = 'cash'
   and t.workspace_id = any (v_ws);

  -- "Old spend": entries marked paid by cash that were booked against a bank
  -- or card instead of a cash account, so they never reduced cash in hand.
  -- Surfaced rather than silently rewritten — the ledger stays as recorded.
  select coalesce(sum(t.amount), 0), count(*)
    into v_untracked, v_untracked_n
    from public.transactions t
   where t.user_id = v_uid
     and t.status = 'completed'
     and t.type = 'expense'
     and lower(coalesce(t.payment_method, '')) = 'cash'
     and t.workspace_id = any (v_ws)
     and (
       t.account_id is null
       or not exists (
         select 1 from public.accounts a
          where a.id = t.account_id and a.type = 'cash'
       )
     );

  return json_build_object(
    'cash_in_hand',     v_in_hand,
    'cash_accounts',    v_accounts,
    'spent_month',      v_spent_m,
    'spent_total',      v_spent_all,
    'received_month',   v_recv_m,
    'last_movement',    v_last,
    'untracked_amount', v_untracked,
    'untracked_count',  v_untracked_n
  );
end;
$$;

-- ── Cash spend history ───────────────────────────────────────────────────
--  Every movement of physical money, newest first. `on_cash_account` false
--  marks the historical entries described above: paid in cash, but booked
--  somewhere else. They are included so the record is complete.
create or replace function public.cash_activity(
  p_scope text    default 'combined',
  p_from  date    default null,
  p_to    date    default null,
  p_limit integer default 200
)
returns table (
  id              uuid,
  txn_date        date,
  description     text,
  type            transaction_type,
  amount          numeric,
  flow            text,           -- 'in' | 'out'
  account_id      uuid,
  account_name    text,
  category_name   text,
  category_color  text,
  payment_method  text,
  workspace_id    uuid,
  on_cash_account boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  with cash_accts as (
    select a.id, a.name
      from public.accounts a
     where a.user_id = (select auth.uid())
       and a.type = 'cash'
       and a.workspace_id = any (public.workspace_ids_for_scope(p_scope))
  ),
  moves as (
    -- Cash going out: spent from a cash account, or moved off it.
    select t.id, t.txn_date, t.description, t.type, t.amount, 'out'::text as flow,
           t.account_id, ca.name as account_name, t.category_id,
           t.payment_method, t.workspace_id, true as on_cash_account
      from public.transactions t
      join cash_accts ca on ca.id = t.account_id
     where t.status = 'completed'
       and t.type in ('expense', 'transfer')

    union all

    -- Cash coming in: received into a cash account.
    select t.id, t.txn_date, t.description, t.type, t.amount, 'in',
           t.account_id, ca.name, t.category_id,
           t.payment_method, t.workspace_id, true
      from public.transactions t
      join cash_accts ca on ca.id = t.account_id
     where t.status = 'completed'
       and t.type = 'income'

    union all

    -- Cash withdrawn from a bank into a cash account.
    select t.id, t.txn_date, t.description, t.type, t.amount, 'in',
           t.to_account_id, ca.name, t.category_id,
           t.payment_method, t.workspace_id, true
      from public.transactions t
      join cash_accts ca on ca.id = t.to_account_id
     where t.status = 'completed'
       and t.type = 'transfer'

    union all

    -- Paid in cash, but booked against a non-cash account.
    select t.id, t.txn_date, t.description, t.type, t.amount, 'out',
           t.account_id, a.name, t.category_id,
           t.payment_method, t.workspace_id, false
      from public.transactions t
      left join public.accounts a on a.id = t.account_id
     where t.user_id = (select auth.uid())
       and t.status = 'completed'
       and t.type = 'expense'
       and lower(coalesce(t.payment_method, '')) = 'cash'
       and t.workspace_id = any (public.workspace_ids_for_scope(p_scope))
       and not exists (
         select 1 from cash_accts ca where ca.id = t.account_id
       )
  )
  select
    m.id,
    m.txn_date,
    m.description,
    m.type,
    m.amount,
    m.flow,
    m.account_id,
    m.account_name,
    c.name  as category_name,
    c.color as category_color,
    m.payment_method,
    m.workspace_id,
    m.on_cash_account
  from moves m
  left join public.categories c on c.id = m.category_id
  where (p_from is null or m.txn_date >= p_from)
    and (p_to   is null or m.txn_date <= p_to)
  order by m.txn_date desc, m.id desc
  limit greatest(coalesce(p_limit, 200), 1);
$fn$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §3  PAYMENTS NOW REACH THE LEDGER
--
--  Marking a payment paid used to change nothing but the badge: no account
--  was debited and no ledger row was written, so settled money simply
--  vanished from the books. A paid payment now posts a real transaction and
--  keeps a link to it, so the existing balance triggers do the rest.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.payments
  add column if not exists transaction_id uuid references public.transactions(id) on delete set null;

alter table public.payments
  add column if not exists category_id uuid references public.categories(id) on delete set null;

create index if not exists payments_transaction_idx on public.payments (transaction_id);

create or replace function public.payments_post_to_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn_id uuid;
  v_type   transaction_type;
begin
  if tg_op = 'DELETE' then
    if old.transaction_id is not null then
      delete from public.transactions where id = old.transaction_id;
    end if;
    return old;
  end if;

  v_type := case when new.direction = 'incoming' then 'income' else 'expense' end;

  if new.status = 'paid' and new.account_id is not null then

    if new.transaction_id is null then
      insert into public.transactions (
        user_id, workspace_id, account_id, category_id, contact_id,
        type, status, amount, currency, txn_date,
        description, payment_method, reference
      )
      values (
        new.user_id, new.workspace_id, new.account_id, new.category_id, new.contact_id,
        v_type, 'completed', new.amount, coalesce(new.currency, 'INR'),
        coalesce(new.paid_date, current_date),
        new.name, new.method, 'payment:' || new.id::text
      )
      returning id into v_txn_id;

      new.transaction_id := v_txn_id;
    else
      -- Editing a settled payment keeps its ledger row in step. The balance
      -- trigger on transactions reverses the old shape and applies the new.
      update public.transactions
         set account_id     = new.account_id,
             category_id    = new.category_id,
             contact_id     = new.contact_id,
             type           = v_type,
             amount         = new.amount,
             txn_date       = coalesce(new.paid_date, txn_date),
             description    = new.name,
             payment_method = new.method
       where id = new.transaction_id;
    end if;

  elsif new.transaction_id is not null then
    -- Un-paid, cancelled, or the account was cleared: take it back out.
    -- Deleting the transaction reverses the balance automatically.
    delete from public.transactions where id = new.transaction_id;
    new.transaction_id := null;
  end if;

  return new;
end;
$$;

-- BEFORE, so the row can carry its own transaction_id without a second write.
-- Fires after payments_derive_status (alphabetical), which fills paid_date.
drop trigger if exists payments_post_to_ledger on public.payments;
create trigger payments_post_to_ledger
  before insert or update on public.payments
  for each row execute function public.payments_post_to_ledger();

drop trigger if exists payments_unpost_from_ledger on public.payments;
create trigger payments_unpost_from_ledger
  after delete on public.payments
  for each row execute function public.payments_post_to_ledger();

-- ── NOT BACKFILLED ON PURPOSE ────────────────────────────────────────────
--  Payments already marked paid keep transaction_id NULL and stay out of the
--  ledger. Posting them now would move real balances, and would double-count
--  wherever you had already entered the matching transaction by hand.
--
--  From here on every newly settled payment posts correctly. To bring an old
--  one in, open it and save it again — the trigger picks it up.
--
--  To review which ones are affected:
--
--    select name, amount, paid_date, account_id
--      from public.payments
--     where status = 'paid' and transaction_id is null
--     order by paid_date desc;


-- ═══════════════════════════════════════════════════════════════════════════
--  §4  GOAL STATUS GOES BOTH WAYS
--
--  A goal was promoted to 'achieved' when it reached its target but never
--  came back to 'active' if the target was raised or the saved figure
--  corrected downwards — it stayed achieved for ever.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.goals_derive_status()
returns trigger
language plpgsql
as $$
begin
  if new.current_amount >= new.target_amount and new.status = 'active' then
    new.status := 'achieved';
  elsif new.current_amount < new.target_amount and new.status = 'achieved' then
    new.status := 'active';
  end if;
  return new;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §5  BUDGET SPEND STOPS AT THE END OF THE PERIOD
--
--  The spend lateral had a lower bound but no upper one, so a transaction
--  dated next month was already counted against this month's budget and
--  showed the bar over-spent before the money had gone.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.budget_progress(p_scope text default 'combined')
returns table (
  id              uuid,
  name            text,
  category_name   text,
  category_color  text,
  period          budget_period,
  amount          numeric,
  spent           numeric,
  remaining       numeric,
  percentage      numeric,
  alert_threshold integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    b.id,
    b.name,
    coalesce(c.name, 'All categories')                as category_name,
    coalesce(c.color, '#C8FF00')                      as category_color,
    b.period,
    b.amount,
    coalesce(spent.total, 0)                          as spent,
    greatest(b.amount - coalesce(spent.total, 0), 0)  as remaining,
    case when b.amount > 0
         then round((coalesce(spent.total, 0) / b.amount) * 100, 1)
         else 0 end                                   as percentage,
    b.alert_threshold
  from public.budgets b
  left join public.categories c on c.id = b.category_id
  left join lateral (
    select sum(t.amount) as total
      from public.transactions t
     where t.user_id = b.user_id
       and t.workspace_id = b.workspace_id
       and t.type = 'expense'
       and t.status = 'completed'
       and (b.category_id is null or t.category_id = b.category_id)
       and t.txn_date >= case b.period
                           when 'weekly'    then date_trunc('week',    current_date)::date
                           when 'monthly'   then date_trunc('month',   current_date)::date
                           when 'quarterly' then date_trunc('quarter', current_date)::date
                           else                  date_trunc('year',    current_date)::date
                         end
       and t.txn_date <  case b.period
                           when 'weekly'    then (date_trunc('week',    current_date) + interval '1 week')::date
                           when 'monthly'   then (date_trunc('month',   current_date) + interval '1 month')::date
                           when 'quarterly' then (date_trunc('quarter', current_date) + interval '3 months')::date
                           else                  (date_trunc('year',    current_date) + interval '1 year')::date
                         end
  ) spent on true
  where b.user_id = (select auth.uid())
    and b.is_active
    and b.workspace_id = any (public.workspace_ids_for_scope(p_scope))
  order by percentage desc;
$fn$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §6  SIGNUP BOOTSTRAP — one primary, cash in both workspaces
--
--  Only affects users created from here on. Existing rows are untouched;
--  §1 and §2 above already brought them into line.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_personal uuid;
  v_business uuid;
  v_name     text;
begin
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, 'there'), '@', 1)
  );

  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    v_name,
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;

  insert into public.workspaces (user_id, name, type, is_default, icon, color)
  values (new.id, 'Personal', 'personal', true, 'user', '#C8FF00')
  on conflict (user_id, type) do nothing
  returning id into v_personal;

  if v_personal is null then
    select id into v_personal
      from public.workspaces
     where user_id = new.id and type = 'personal';
  end if;

  insert into public.workspaces (user_id, name, type, is_default, icon, color)
  values (new.id, 'Business', 'business', false, 'briefcase', '#A8E600')
  on conflict (user_id, type) do nothing
  returning id into v_business;

  if v_business is null then
    select id into v_business
      from public.workspaces
     where user_id = new.id and type = 'business';
  end if;

  -- Starter accounts. Exactly one is primary — the trigger in §1 would
  -- collapse them anyway, but flagging one keeps the intent obvious.
  insert into public.accounts (user_id, workspace_id, name, type, institution, icon, color, is_primary)
  values
    (new.id, v_personal, 'Primary Savings',  'savings', 'Add your bank', 'landmark',   '#C8FF00', true),
    (new.id, v_personal, 'Cash in Hand',     'cash',    null,            'wallet',     '#A8E600', false),
    (new.id, v_business, 'Business Current', 'bank',    'Add your bank', 'building-2', '#C8FF00', false),
    (new.id, v_business, 'Cash in Hand',     'cash',    null,            'wallet',     '#A8E600', false);

  insert into public.categories (user_id, workspace_id, name, kind, icon, color, is_system, sort_order)
  values
    (new.id, null, 'Salary',             'income',  'banknote',       '#C8FF00', true, 1),
    (new.id, null, 'Client Revenue',     'income',  'handshake',      '#B6FF00', true, 2),
    (new.id, null, 'Interest & Dividend','income',  'trending-up',    '#A8E600', true, 3),
    (new.id, null, 'Other Income',       'income',  'plus-circle',    '#89BF00', true, 4),
    (new.id, null, 'Office Expenses',    'expense', 'building-2',     '#C8FF00', true, 10),
    (new.id, null, 'Salaries',           'expense', 'users',          '#A8E600', true, 11),
    (new.id, null, 'Rent & Utilities',   'expense', 'home',           '#89BF00', true, 12),
    (new.id, null, 'Marketing',          'expense', 'megaphone',      '#6E9900', true, 13),
    (new.id, null, 'Travel',             'expense', 'plane',          '#FFB547', true, 14),
    (new.id, null, 'Software & Tools',   'expense', 'monitor',        '#7DD3FC', true, 15),
    (new.id, null, 'Food & Dining',      'expense', 'utensils',       '#FF9F6C', true, 16),
    (new.id, null, 'Shopping',           'expense', 'shopping-bag',   '#FF5C6C', true, 17),
    (new.id, null, 'Health',             'expense', 'heart-pulse',    '#F472B6', true, 18),
    (new.id, null, 'Transport',          'expense', 'car',            '#A78BFA', true, 19),
    (new.id, null, 'Others',             'expense', 'more-horizontal','#6B7280', true, 20),
    (new.id, null, 'Account Transfer',   'transfer','arrow-left-right','#9CA3AF', true, 30);

  return new;
exception
  when others then
    raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §7  DEMO SEED REMOVED
--
--  seed_demo_data() opened with nine `delete from … where user_id = auth.uid()`
--  statements — transactions, invoices, payments, goals, budgets, recurring,
--  contacts and accounts — before writing its sample book. With real data in
--  the account, one press of "Load demo data" would have erased all of it.
--
--  Dropping the functions means an old cached bundle cannot call them either.
--  No data is removed here: only the two functions go.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.seed_demo_data();
drop function if exists public.seed_demo_subscriptions();



-- ═══════════════════════════════════════════════════════════════════════════
--  §8  RUNNERS CATCH UP PROPERLY
--
--  Both runners advanced their schedule by exactly one cycle per call, so a
--  rule that had been due for three months posted a single entry and jumped
--  its date forward — the other cycles were lost, not deferred. Subscriptions
--  had it worse: subscriptions_derive rolls any stale renewal date to today
--  in one hop, so the missed cycles were erased before anything could post
--  them.
--
--  Both now post every cycle that has actually come and gone. Still safe to
--  call repeatedly: each pass only ever looks at dates already in the past.
--
--  These write NEW transactions dated in the past, which will move balances
--  the first time they run — that is the point, it is money that was always
--  owed. If a subscription is one you had been entering by hand, switch its
--  "post to ledger" off before opening the app, or delete the duplicate
--  entries afterwards from Transactions.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.run_due_recurring()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.recurring_transactions%rowtype;
  v_count int := 0;
  v_step  interval;
  v_due   date;
  v_guard int;
begin
  for r in
    select * from public.recurring_transactions
     where user_id = (select auth.uid())
       and is_active
       and auto_post
       and next_run_date <= current_date
       and (end_date is null or next_run_date <= end_date)
  loop
    v_step := case r.frequency
                when 'daily'     then make_interval(days   => greatest(r.interval_count, 1))
                when 'weekly'    then make_interval(weeks  => greatest(r.interval_count, 1))
                when 'biweekly'  then make_interval(weeks  => greatest(r.interval_count, 1) * 2)
                when 'monthly'   then make_interval(months => greatest(r.interval_count, 1))
                when 'quarterly' then make_interval(months => greatest(r.interval_count, 1) * 3)
                else                  make_interval(years  => greatest(r.interval_count, 1))
              end;

    v_due   := r.next_run_date;
    v_guard := 0;

    -- Every occurrence that is already in the past, not just the first.
    -- The guard caps a single call at 400 entries so a rule with an absurd
    -- start date cannot run away with the transaction log.
    while v_due <= current_date
      and (r.end_date is null or v_due <= r.end_date)
      and v_guard < 400
    loop
      insert into public.transactions (
        user_id, workspace_id, account_id, category_id, contact_id, recurring_id,
        type, status, amount, currency, txn_date, description, payment_method
      )
      values (
        r.user_id, r.workspace_id, r.account_id, r.category_id, r.contact_id, r.id,
        r.type, 'completed', r.amount, r.currency, v_due,
        coalesce(nullif(r.description, ''), r.name), 'Auto — recurring'
      );

      v_due   := (v_due + v_step)::date;
      v_guard := v_guard + 1;
      v_count := v_count + 1;
    end loop;

    if v_guard > 0 then
      update public.recurring_transactions
         set last_run_date = (v_due - v_step)::date,
             next_run_date = v_due,
             run_count     = run_count + v_guard
       where id = r.id;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function public.run_due_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s       public.subscriptions%rowtype;
  v_count int := 0;
  v_step  interval;
  v_due   date;
  v_guard int;
begin
  for s in
    select * from public.subscriptions
     where user_id = (select auth.uid())
       and status in ('active', 'trial')
       and auto_renew
       and next_renewal_date <= current_date
       and (ends_on is null or next_renewal_date <= ends_on)
  loop
    v_step  := public.subscription_cycle_interval(s.billing_cycle, s.cycle_count);
    v_due   := s.next_renewal_date;
    v_guard := 0;

    -- 'lifetime' resolves to a 100-year interval, so the first pass takes the
    -- date far past today and the loop ends after one charge, as it should.
    while v_due <= current_date
      and (s.ends_on is null or v_due <= s.ends_on)
      and v_guard < 120
    loop
      if s.auto_post then
        insert into public.transactions (
          user_id, workspace_id, account_id, category_id, contact_id,
          type, status, amount, currency, txn_date, description, payment_method
        )
        values (
          s.user_id, s.workspace_id, s.account_id, s.category_id, s.contact_id,
          'expense', 'completed', s.amount, s.currency, v_due,
          s.name || coalesce(' — ' || s.plan, ''), coalesce(s.payment_method, 'Auto Debit')
        );
      end if;

      v_due   := (v_due + v_step)::date;
      v_guard := v_guard + 1;
      v_count := v_count + 1;
    end loop;

    if v_guard > 0 then
      update public.subscriptions
         set last_charged_on   = (v_due - v_step)::date,
             next_renewal_date = v_due
       where id = s.id;
    end if;
  end loop;

  return v_count;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §9  GRANTS
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on function public.cash_summary(text)                    from public, anon;
revoke all on function public.cash_activity(text, date, date, integer) from public, anon;

grant execute on function public.cash_summary(text)                    to authenticated;
grant execute on function public.cash_activity(text, date, date, integer) to authenticated;

-- Re-asserted: these were replaced above, and CREATE OR REPLACE keeps the
-- existing grants, but stating them means a hand-dropped function comes back
-- with the right access.
grant execute on function public.run_due_recurring()     to authenticated;
grant execute on function public.run_due_subscriptions() to authenticated;
grant execute on function public.generate_reminders(uuid) to authenticated;

commit;


-- ============================================================================
-- ============================================================================
--
--  PART 8 — SHARED ACCOUNTS · SUBSCRIPTION AUTOMATION · REMINDERS EVERYWHERE
--
--  Was migration_003_shared_and_automation.sql.
--
--  §1 lets an account (or contact) belong to BOTH workspaces instead of one, by
--     allowing workspace_id to be NULL — exactly how categories have always
--     worked. Existing rows keep the workspace they have.
--  §4 makes the Personal / Business split figures report the truth at all times
--     instead of echoing whichever scope you were looking at.
--  §5 gives every subscription a mirrored row on the Recurring page. The mirror
--     never posts to the ledger, so nothing can be charged twice.
--
--  The enum label this part depends on is added in Part 0, above, which commits
--  before this transaction opens.
--
-- ============================================================================
-- ============================================================================

begin;

-- ═══════════════════════════════════════════════════════════════════════════
--  §1  SHARED ACCOUNTS AND CONTACTS  — "use in both"
--
--  A bank account you use for personal spending AND for the business is one
--  real account holding one real balance. Modelling it as two rows means two
--  balances that drift apart and a Combined total that counts the same money
--  twice.
--
--  So workspace_id becomes nullable on accounts and contacts, and NULL reads
--  as "belongs to both". Every transaction written against a shared account
--  still carries its own workspace_id, so Personal and Business reporting
--  stays completely separate — only the container is shared.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.accounts alter column workspace_id drop not null;
alter table public.contacts alter column workspace_id drop not null;

comment on column public.accounts.workspace_id is
  'NULL means the account is shared by Personal and Business. Its balance is '
  'counted once in Combined, and it is offered in both workspaces'' pickers.';

comment on column public.contacts.workspace_id is
  'NULL means the contact is visible from Personal and Business alike.';

-- Partial indexes so "give me the shared ones" stays cheap.
create index if not exists accounts_shared_idx on public.accounts (user_id)
  where workspace_id is null;
create index if not exists contacts_shared_idx on public.contacts (user_id)
  where workspace_id is null;

-- ── RLS: accept NULL as a legal workspace ────────────────────────────────
--  The generic policy block in the base schema builds
--  `owns_workspace(workspace_id)`, which is NULL-in/NULL-out — and a WITH
--  CHECK that evaluates to NULL rejects the row. Without this, saving a
--  shared account would fail with a policy violation.
do $$
declare t text;
begin
  foreach t in array array['accounts', 'contacts'] loop
    execute format('drop policy if exists "%1$s_insert_own" on public.%1$I;', t);
    execute format($p$
      create policy "%1$s_insert_own" on public.%1$I
        for insert to authenticated
        with check (
          user_id = (select auth.uid())
          and (workspace_id is null or public.owns_workspace(workspace_id))
        );
    $p$, t);

    execute format('drop policy if exists "%1$s_update_own" on public.%1$I;', t);
    execute format($p$
      create policy "%1$s_update_own" on public.%1$I
        for update to authenticated
        using (user_id = (select auth.uid()))
        with check (
          user_id = (select auth.uid())
          and (workspace_id is null or public.owns_workspace(workspace_id))
        );
    $p$, t);
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §2  SCOPE HELPER
--
--  Every "is this row in the scope I am looking at?" test now has to treat a
--  NULL workspace as in-scope. One function so the rule cannot be spelled
--  three different ways in three different RPCs.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.in_scope(p_workspace_id uuid, p_scope_ids uuid[])
returns boolean
language sql
immutable
parallel safe
as $$
  select p_workspace_id is null or p_workspace_id = any (p_scope_ids);
$$;

comment on function public.in_scope(uuid, uuid[]) is
  'True when a row belongs to the scope, or is shared (workspace_id NULL).';

revoke all on function public.in_scope(uuid, uuid[]) from public, anon;
grant execute on function public.in_scope(uuid, uuid[]) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
--  §3  ONE PRIMARY ACCOUNT — unchanged rule, now NULL-aware
--
--  The trigger from migration 002 clears the flag across the whole user, not
--  per workspace, so a shared account can hold it. Re-declared here only so
--  this file can be run against a database that skipped 002's trigger.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.accounts_enforce_single_primary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.accounts
     set is_primary = false
   where user_id = new.user_id
     and id <> new.id
     and is_primary;
  return null;
end;
$$;

drop trigger if exists accounts_single_primary on public.accounts;
create trigger accounts_single_primary
  after insert or update of is_primary on public.accounts
  for each row
  when (new.is_primary)
  execute function public.accounts_enforce_single_primary();



-- ═══════════════════════════════════════════════════════════════════════════
--  §4  DASHBOARD SUMMARY — shared-aware, and honest about the split
--
--  TWO FIXES HERE.
--
--  1. Shared accounts now count toward whichever scope you are in, and are
--     counted exactly ONCE in Combined.
--
--  2. `personal_balance` and `business_balance` used to be filtered by the
--     scope being viewed. In Personal they reported Business = 0; in Business
--     the Personal figure came back 0; and in Combined both rows echoed the
--     combined total. Every surface that prints a row literally labelled
--     "Business" was therefore printing something else.
--
--     Those two keys are now computed across ALL workspaces the user owns,
--     independent of p_scope. A row labelled Business shows Business money,
--     always. `total_balance` is unchanged — it still follows the scope,
--     because that is exactly what the headline card is for.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.dashboard_summary(p_scope text default 'combined')
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid            uuid := (select auth.uid());
  v_ws             uuid[];
  v_month_start    date := date_trunc('month', current_date)::date;
  v_prev_start     date := (date_trunc('month', current_date) - interval '1 month')::date;

  v_total          numeric := 0;
  v_personal       numeric := 0;
  v_business       numeric := 0;
  v_shared         numeric := 0;

  v_income_m       numeric := 0;
  v_expense_m      numeric := 0;
  v_income_p       numeric := 0;
  v_expense_p      numeric := 0;

  v_recv           numeric := 0;
  v_recv_count     int     := 0;
  v_upcoming       numeric := 0;
  v_upcoming_count int     := 0;

  v_net_prev       numeric := 0;
  v_growth         numeric := 0;
begin
  if v_uid is null then
    return json_build_object('error', 'not authenticated');
  end if;

  v_ws := public.workspace_ids_for_scope(p_scope);

  -- Scoped headline balance. A shared account has no workspace row to join
  -- to, so this must not inner-join workspaces or it would drop silently.
  select coalesce(sum(a.current_balance), 0)
    into v_total
  from public.accounts a
  where a.user_id = v_uid
    and a.is_active
    and public.in_scope(a.workspace_id, v_ws);

  -- The split, deliberately NOT scope-filtered. See the note above.
  select
    coalesce(sum(a.current_balance) filter (where w.type = 'personal'), 0),
    coalesce(sum(a.current_balance) filter (where w.type = 'business'), 0),
    coalesce(sum(a.current_balance) filter (where a.workspace_id is null), 0)
  into v_personal, v_business, v_shared
  from public.accounts a
  left join public.workspaces w on w.id = a.workspace_id
  where a.user_id = v_uid
    and a.is_active;

  -- This month vs last month flows.
  select
    coalesce(sum(t.amount) filter (where t.type = 'income'  and t.txn_date >= v_month_start), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense' and t.txn_date >= v_month_start), 0),
    coalesce(sum(t.amount) filter (where t.type = 'income'  and t.txn_date >= v_prev_start and t.txn_date < v_month_start), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense' and t.txn_date >= v_prev_start and t.txn_date < v_month_start), 0)
  into v_income_m, v_expense_m, v_income_p, v_expense_p
  from public.transactions t
  where t.user_id = v_uid
    and t.status = 'completed'
    and t.workspace_id = any (v_ws)
    and t.txn_date >= v_prev_start;

  select coalesce(sum(i.balance_due), 0), count(*)
    into v_recv, v_recv_count
  from public.invoices i
  where i.user_id = v_uid
    and i.workspace_id = any (v_ws)
    and i.status in ('sent', 'partial', 'overdue');

  select coalesce(sum(p.amount), 0), count(*)
    into v_upcoming, v_upcoming_count
  from public.payments p
  where p.user_id = v_uid
    and p.workspace_id = any (v_ws)
    and p.direction = 'outgoing'
    and p.status in ('upcoming', 'pending', 'overdue');

  v_net_prev := v_total - (v_income_m - v_expense_m);
  if v_net_prev <> 0 then
    v_growth := round(((v_total - v_net_prev) / abs(v_net_prev)) * 100, 1);
  end if;

  return json_build_object(
    'scope',                 lower(coalesce(p_scope, 'combined')),
    'total_balance',         v_total,
    -- True figures, whatever scope is active.
    'personal_balance',      v_personal,
    'business_balance',      v_business,
    'shared_balance',        v_shared,
    'has_shared',            (v_shared <> 0),
    'net_worth',             v_total,
    'net_worth_growth',      v_growth,
    'income_month',          v_income_m,
    'expense_month',         v_expense_m,
    'income_prev_month',     v_income_p,
    'expense_prev_month',    v_expense_p,
    'income_growth',         case when v_income_p > 0
                                  then round(((v_income_m - v_income_p) / v_income_p) * 100, 1)
                                  else 0 end,
    'expense_growth',        case when v_expense_p > 0
                                  then round(((v_expense_m - v_expense_p) / v_expense_p) * 100, 1)
                                  else 0 end,
    'savings',               v_income_m - v_expense_m,
    'savings_rate',          case when v_income_m > 0
                                  then round(((v_income_m - v_expense_m) / v_income_m) * 100, 1)
                                  else 0 end,
    'pending_receivables',   v_recv,
    'receivable_count',      v_recv_count,
    'upcoming_payments',     v_upcoming,
    'upcoming_count',        v_upcoming_count
  );
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §5  CASH — a shared cash account counts in both workspaces
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cash_summary(p_scope text default 'combined')
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_ws          uuid[];
  v_month_start date := date_trunc('month', current_date)::date;

  v_in_hand     numeric := 0;
  v_accounts    int     := 0;
  v_spent_m     numeric := 0;
  v_spent_all   numeric := 0;
  v_recv_m      numeric := 0;
  v_last        date;
  v_untracked   numeric := 0;
  v_untracked_n int     := 0;
begin
  if v_uid is null then
    return json_build_object('error', 'not authenticated');
  end if;

  v_ws := public.workspace_ids_for_scope(p_scope);

  select coalesce(sum(a.current_balance), 0), count(*)
    into v_in_hand, v_accounts
    from public.accounts a
   where a.user_id = v_uid
     and a.is_active
     and a.type = 'cash'
     and public.in_scope(a.workspace_id, v_ws);

  -- Money that actually left or entered a cash account. Filtered on the
  -- transaction workspace, which stays concrete even when the cash account
  -- behind it is shared.
  select
    coalesce(sum(t.amount) filter (
      where t.type = 'expense' and t.txn_date >= v_month_start), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0),
    coalesce(sum(t.amount) filter (
      where t.type = 'income' and t.txn_date >= v_month_start), 0),
    max(t.txn_date)
  into v_spent_m, v_spent_all, v_recv_m, v_last
  from public.transactions t
  join public.accounts a on a.id = t.account_id
 where t.user_id = v_uid
   and t.status = 'completed'
   and a.type = 'cash'
   and t.workspace_id = any (v_ws);

  select coalesce(sum(t.amount), 0), count(*)
    into v_untracked, v_untracked_n
    from public.transactions t
   where t.user_id = v_uid
     and t.status = 'completed'
     and t.type = 'expense'
     and lower(coalesce(t.payment_method, '')) = 'cash'
     and t.workspace_id = any (v_ws)
     and (
       t.account_id is null
       or not exists (
         select 1 from public.accounts a
          where a.id = t.account_id and a.type = 'cash'
       )
     );

  return json_build_object(
    'cash_in_hand',     v_in_hand,
    'cash_accounts',    v_accounts,
    'spent_month',      v_spent_m,
    'spent_total',      v_spent_all,
    'received_month',   v_recv_m,
    'last_movement',    v_last,
    'untracked_amount', v_untracked,
    'untracked_count',  v_untracked_n
  );
end;
$$;




-- ═══════════════════════════════════════════════════════════════════════════
--  §6  CASH ACTIVITY — same shared-aware account list
--
--  Identical signature and columns to migration 002. The only change is the
--  scope test on the cash-account list, so a shared cash account shows its
--  movements in Personal and in Business rather than in neither.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cash_activity(
  p_scope text    default 'combined',
  p_from  date    default null,
  p_to    date    default null,
  p_limit integer default 200
)
returns table (
  id              uuid,
  txn_date        date,
  description     text,
  type            transaction_type,
  amount          numeric,
  flow            text,           -- 'in' | 'out'
  account_id      uuid,
  account_name    text,
  category_name   text,
  category_color  text,
  payment_method  text,
  workspace_id    uuid,
  on_cash_account boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  with cash_accts as (
    select a.id, a.name
      from public.accounts a
     where a.user_id = (select auth.uid())
       and a.type = 'cash'
       and public.in_scope(
             a.workspace_id,
             public.workspace_ids_for_scope(p_scope)
           )
  ),
  moves as (
    -- Cash going out: spent from a cash account, or moved off it.
    select t.id, t.txn_date, t.description, t.type, t.amount, 'out'::text as flow,
           t.account_id, ca.name as account_name, t.category_id,
           t.payment_method, t.workspace_id, true as on_cash_account
      from public.transactions t
      join cash_accts ca on ca.id = t.account_id
     where t.status = 'completed'
       and t.type in ('expense', 'transfer')

    union all

    -- Cash coming in: received into a cash account.
    select t.id, t.txn_date, t.description, t.type, t.amount, 'in',
           t.account_id, ca.name, t.category_id,
           t.payment_method, t.workspace_id, true
      from public.transactions t
      join cash_accts ca on ca.id = t.account_id
     where t.status = 'completed'
       and t.type = 'income'

    union all

    -- Cash withdrawn from a bank into a cash account.
    select t.id, t.txn_date, t.description, t.type, t.amount, 'in',
           t.to_account_id, ca.name, t.category_id,
           t.payment_method, t.workspace_id, true
      from public.transactions t
      join cash_accts ca on ca.id = t.to_account_id
     where t.status = 'completed'
       and t.type = 'transfer'

    union all

    -- Paid in cash, but booked against a non-cash account.
    select t.id, t.txn_date, t.description, t.type, t.amount, 'out',
           t.account_id, a.name, t.category_id,
           t.payment_method, t.workspace_id, false
      from public.transactions t
      left join public.accounts a on a.id = t.account_id
     where t.user_id = (select auth.uid())
       and t.status = 'completed'
       and t.type = 'expense'
       and lower(coalesce(t.payment_method, '')) = 'cash'
       and t.workspace_id = any (public.workspace_ids_for_scope(p_scope))
       and not exists (
         select 1 from cash_accts ca where ca.id = t.account_id
       )
  )
  select
    m.id,
    m.txn_date,
    m.description,
    m.type,
    m.amount,
    m.flow,
    m.account_id,
    m.account_name,
    c.name  as category_name,
    c.color as category_color,
    m.payment_method,
    m.workspace_id,
    m.on_cash_account
  from moves m
  left join public.categories c on c.id = m.category_id
  where (p_from is null or m.txn_date >= p_from)
    and (p_to   is null or m.txn_date <= p_to)
  order by m.txn_date desc, m.id desc
  limit greatest(coalesce(p_limit, 200), 1);
$fn$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §7  SUBSCRIPTION  →  RECURRING MIRROR
--
--  A subscription IS a recurring charge, so it now appears on the Recurring
--  page automatically instead of having to be typed in twice.
--
--  ONLY ONE OF THE TWO EVER POSTS TO THE LEDGER.
--  The subscription owns the posting (its own `auto_post` flag, applied by
--  run_due_subscriptions). The mirror is the visible schedule: it is forced
--  to auto_post = false on every sync, and run_due_recurring skips any row
--  carrying a subscription_id outright. Two independent guards, because a
--  double-posted charge is the one failure mode here that costs real money.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.recurring_transactions
  add column if not exists subscription_id uuid
    references public.subscriptions(id) on delete cascade;

create unique index if not exists recurring_subscription_unique
  on public.recurring_transactions (subscription_id)
  where subscription_id is not null;

comment on column public.recurring_transactions.subscription_id is
  'Set when this row mirrors a subscription. Mirrors never post to the '
  'ledger — the subscription does. Edit the subscription, not this row.';

-- Maps a billing cycle onto the recurrence vocabulary. `half_yearly` has no
-- direct equivalent, so it becomes "every 6 months".
create or replace function public.billing_cycle_as_recurrence(
  p_cycle billing_cycle,
  p_count integer
)
returns table (frequency recurrence_frequency, interval_count integer)
language sql
immutable
as $$
  select
    case p_cycle
      when 'weekly'      then 'weekly'::recurrence_frequency
      when 'monthly'     then 'monthly'::recurrence_frequency
      when 'quarterly'   then 'quarterly'::recurrence_frequency
      when 'half_yearly' then 'monthly'::recurrence_frequency
      when 'yearly'      then 'yearly'::recurrence_frequency
      else 'monthly'::recurrence_frequency
    end,
    greatest(coalesce(p_count, 1), 1)
      * case when p_cycle = 'half_yearly' then 6 else 1 end;
$$;

create or replace function public.subscriptions_sync_recurring()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_freq     recurrence_frequency;
  v_interval integer;
  v_active   boolean;
  v_existing uuid;
begin
  -- A lifetime purchase does not recur, so it gets no mirror.
  if new.billing_cycle = 'lifetime' then
    delete from public.recurring_transactions where subscription_id = new.id;
    return null;
  end if;

  select r.frequency, r.interval_count
    into v_freq, v_interval
    from public.billing_cycle_as_recurrence(new.billing_cycle, new.cycle_count) r;

  -- The mirror is live only while the subscription itself is.
  v_active := new.status in ('active', 'trial') and new.auto_renew;

  select id into v_existing
    from public.recurring_transactions
   where subscription_id = new.id;

  if v_existing is null then
    insert into public.recurring_transactions (
      user_id, workspace_id, account_id, category_id, contact_id,
      subscription_id, name, type, amount, currency, description,
      frequency, interval_count, start_date, next_run_date, end_date,
      auto_post, is_active
    )
    values (
      new.user_id, new.workspace_id, new.account_id, new.category_id, new.contact_id,
      new.id, new.name, 'expense', new.amount, new.currency,
      coalesce(nullif(new.plan, ''), new.vendor, new.name),
      v_freq, v_interval, new.started_on, new.next_renewal_date, new.ends_on,
      false,        -- never. The subscription posts, not the mirror.
      v_active
    );
  else
    update public.recurring_transactions
       set workspace_id   = new.workspace_id,
           account_id     = new.account_id,
           category_id    = new.category_id,
           contact_id     = new.contact_id,
           name           = new.name,
           amount         = new.amount,
           currency       = new.currency,
           description    = coalesce(nullif(new.plan, ''), new.vendor, new.name),
           frequency      = v_freq,
           interval_count = v_interval,
           next_run_date  = new.next_renewal_date,
           end_date       = new.ends_on,
           auto_post      = false,
           is_active      = v_active
     where id = v_existing;
  end if;

  return null;
end;
$$;

drop trigger if exists subscriptions_sync_recurring on public.subscriptions;
create trigger subscriptions_sync_recurring
  after insert or update on public.subscriptions
  for each row
  execute function public.subscriptions_sync_recurring();

-- Backfill: every subscription that already exists gets its mirror now.
--
-- Done as a direct INSERT rather than a no-op UPDATE on subscriptions. An
-- UPDATE would have fired the existing BEFORE trigger `subscriptions_derive`,
-- which rolls `next_renewal_date` forward past any date already in the past —
-- so a renewal that was due but not yet posted would have been stepped over
-- and its charge would never have reached the ledger. This touches
-- recurring_transactions only; no subscription row is modified.
insert into public.recurring_transactions (
  user_id, workspace_id, account_id, category_id, contact_id,
  subscription_id, name, type, amount, currency, description,
  frequency, interval_count, start_date, next_run_date, end_date,
  auto_post, is_active
)
select
  s.user_id, s.workspace_id, s.account_id, s.category_id, s.contact_id,
  s.id, s.name, 'expense', s.amount, s.currency,
  coalesce(nullif(s.plan, ''), s.vendor, s.name),
  m.frequency, m.interval_count, s.started_on, s.next_renewal_date, s.ends_on,
  false,                                             -- the mirror never posts
  (s.status in ('active', 'trial') and s.auto_renew)
from public.subscriptions s
cross join lateral public.billing_cycle_as_recurrence(s.billing_cycle, s.cycle_count) m
where s.billing_cycle <> 'lifetime'
  and not exists (
    select 1 from public.recurring_transactions r where r.subscription_id = s.id
  );


-- ── run_due_recurring: never post a mirror ───────────────────────────────
create or replace function public.run_due_recurring()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.recurring_transactions%rowtype;
  v_count  int := 0;
  v_step   interval;
begin
  for r in
    select * from public.recurring_transactions
     where user_id = (select auth.uid())
       and is_active
       and auto_post
       -- Second guard against a double charge. run_due_subscriptions owns
       -- anything that came from a subscription.
       and subscription_id is null
       and next_run_date <= current_date
       and (end_date is null or next_run_date <= end_date)
  loop
    insert into public.transactions (
      user_id, workspace_id, account_id, category_id, contact_id, recurring_id,
      type, status, amount, currency, txn_date, description, payment_method
    )
    values (
      r.user_id, r.workspace_id, r.account_id, r.category_id, r.contact_id, r.id,
      r.type, 'completed', r.amount, r.currency, r.next_run_date,
      coalesce(nullif(r.description, ''), r.name), 'Auto — recurring'
    );

    v_step := case r.frequency
                when 'daily'     then make_interval(days  => r.interval_count)
                when 'weekly'    then make_interval(weeks => r.interval_count)
                when 'biweekly'  then make_interval(weeks => r.interval_count * 2)
                when 'monthly'   then make_interval(months => r.interval_count)
                when 'quarterly' then make_interval(months => r.interval_count * 3)
                else                  make_interval(years => r.interval_count)
              end;

    update public.recurring_transactions
       set last_run_date = next_run_date,
           next_run_date = (next_run_date + v_step)::date,
           run_count     = run_count + 1
     where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §8  REMINDERS FOR EVERYTHING
--
--  THE BEHAVIOUR CHANGE WORTH READING.
--
--  The old generator only created a reminder once the due date was already
--  inside the lead window — add a subscription renewing in 30 days and the
--  Reminders page stayed empty for 27 of them, which reads as "it did not
--  work". It also meant a missed nightly run could skip a nudge entirely.
--
--  Reminders are now created as soon as the record exists, anywhere in the
--  next 400 days, with `remind_at` set to the moment the email should go out
--  (lead days before the due date, 09:00). Nothing is emailed earlier than
--  before — pending_reminder_batch still only picks up rows whose remind_at
--  has arrived — but the nudge is visible and auditable from the start.
--
--  `dedupe_key` keeps it idempotent, so this is still safe to run as often
--  as you like.
-- ═══════════════════════════════════════════════════════════════════════════

-- When an email should leave: lead days before the due date, at 09:00, and
-- never in the past (an overdue item goes out on the next run).
create or replace function public.reminder_send_at(p_due date, p_lead integer)
returns timestamptz
language sql
stable
as $$
  select greatest(
    now(),
    ((p_due - greatest(coalesce(p_lead, 0), 0))::timestamptz + interval '9 hours')
  );
$$;

create or replace function public.generate_reminders(p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := coalesce(p_user, (select auth.uid()));
  v_lead    int;
  v_made    int := 0;
  v_horizon int := 400;   -- far enough for an annual renewal, not forever
  r         record;
begin
  if v_uid is null then
    return 0;
  end if;

  -- This is SECURITY DEFINER and granted to `authenticated`, so p_user has to
  -- be checked: without this, any signed-in user could pass someone else's id.
  -- A NULL auth.uid() means the caller is the service role or a trigger
  -- running under the definer, which is allowed to name any user.
  if (select auth.uid()) is not null and v_uid <> (select auth.uid()) then
    raise exception 'generate_reminders: cannot generate reminders for another user';
  end if;

  select coalesce(reminder_lead_days, 3) into v_lead
    from public.profiles where id = v_uid;
  v_lead := coalesce(v_lead, 3);

  -- ── Subscription renewals ───────────────────────────────────────────────
  for r in
    select s.*, coalesce(s.reminder_days_before, v_lead) as lead
      from public.subscriptions s
     where s.user_id = v_uid
       and s.status in ('active', 'trial')
       and s.remind_by_email
       and s.next_renewal_date >= current_date
       and s.next_renewal_date <= current_date + v_horizon
  loop
    insert into public.reminders (
      user_id, workspace_id, kind, subscription_id, title, body,
      amount, currency, due_on, remind_at, channel, dedupe_key
    )
    values (
      r.user_id, r.workspace_id, 'subscription', r.id,
      r.name || ' renews on ' || to_char(r.next_renewal_date, 'DD Mon YYYY'),
      coalesce(r.vendor, r.name) ||
        case when r.plan is not null then ' · ' || r.plan else '' end,
      r.amount, r.currency, r.next_renewal_date,
      public.reminder_send_at(r.next_renewal_date, r.lead), 'email',
      'sub:' || r.id::text || ':' || r.next_renewal_date::text
    )
    on conflict (user_id, dedupe_key) do nothing;

    if found then v_made := v_made + 1; end if;
  end loop;

  -- ── Trials about to convert ─────────────────────────────────────────────
  for r in
    select s.*, coalesce(s.reminder_days_before, v_lead) as lead
      from public.subscriptions s
     where s.user_id = v_uid
       and s.status = 'trial'
       and s.trial_ends_on is not null
       and s.trial_ends_on >= current_date
       and s.trial_ends_on <= current_date + v_horizon
  loop
    insert into public.reminders (
      user_id, workspace_id, kind, subscription_id, title, body,
      amount, currency, due_on, remind_at, channel, dedupe_key
    )
    values (
      r.user_id, r.workspace_id, 'subscription', r.id,
      'Free trial for ' || r.name || ' ends on ' || to_char(r.trial_ends_on, 'DD Mon YYYY'),
      'Cancel before this date to avoid being charged.',
      r.amount, r.currency, r.trial_ends_on,
      public.reminder_send_at(r.trial_ends_on, r.lead), 'email',
      'trial:' || r.id::text || ':' || r.trial_ends_on::text
    )
    on conflict (user_id, dedupe_key) do nothing;

    if found then v_made := v_made + 1; end if;
  end loop;

  -- ── Scheduled payments falling due ──────────────────────────────────────
  for r in
    select * from public.payments
     where user_id = v_uid
       and status in ('upcoming', 'pending', 'overdue')
       and due_date between (current_date - 30) and (current_date + v_horizon)
  loop
    insert into public.reminders (
      user_id, workspace_id, kind, payment_id, title, body,
      amount, currency, due_on, remind_at, channel, dedupe_key
    )
    values (
      r.user_id, r.workspace_id, 'payment', r.id,
      case when r.due_date < current_date
           then r.name || ' is overdue'
           else r.name || ' is due on ' || to_char(r.due_date, 'DD Mon YYYY') end,
      coalesce(r.method, 'Scheduled payment'),
      r.amount, r.currency, r.due_date,
      public.reminder_send_at(r.due_date, v_lead), 'email',
      'pay:' || r.id::text || ':' || r.due_date::text
    )
    on conflict (user_id, dedupe_key) do nothing;

    if found then v_made := v_made + 1; end if;
  end loop;

  -- ── Invoices going overdue ──────────────────────────────────────────────
  for r in
    select i.*, c.name as customer
      from public.invoices i
      left join public.contacts c on c.id = i.contact_id
     where i.user_id = v_uid
       and i.status in ('sent', 'partial', 'overdue')
       and i.due_date between (current_date - 30) and (current_date + v_horizon)
  loop
    insert into public.reminders (
      user_id, workspace_id, kind, invoice_id, title, body,
      amount, currency, due_on, remind_at, channel, dedupe_key
    )
    values (
      r.user_id, r.workspace_id, 'invoice', r.id,
      'Invoice ' || r.invoice_number ||
        case when r.due_date < current_date then ' is overdue' else ' is due soon' end,
      coalesce(r.customer, 'Customer'),
      r.balance_due, r.currency, r.due_date,
      public.reminder_send_at(r.due_date, v_lead), 'email',
      'inv:' || r.id::text || ':' || r.due_date::text
    )
    on conflict (user_id, dedupe_key) do nothing;

    if found then v_made := v_made + 1; end if;
  end loop;

  -- ── Goals: the target date approaching ──────────────────────────────────
  for r in
    select * from public.financial_goals
     where user_id = v_uid
       and status = 'active'
       and target_date is not null
       and target_date >= current_date
       and target_date <= current_date + v_horizon
  loop
    insert into public.reminders (
      user_id, workspace_id, kind, goal_id, title, body,
      amount, currency, due_on, remind_at, channel, dedupe_key
    )
    values (
      r.user_id, r.workspace_id, 'goal', r.id,
      r.name || ' is due on ' || to_char(r.target_date, 'DD Mon YYYY'),
      'Saved so far: ' || round(
        case when r.target_amount > 0
             then (r.current_amount / r.target_amount) * 100
             else 0 end, 0) || '% of the target.',
      greatest(r.target_amount - r.current_amount, 0), 'INR', r.target_date,
      public.reminder_send_at(r.target_date, v_lead), 'email',
      'goal-due:' || r.id::text || ':' || r.target_date::text
    )
    on conflict (user_id, dedupe_key) do nothing;

    if found then v_made := v_made + 1; end if;
  end loop;

  -- ── Goals: next monthly contribution nudge ──────────────────────────────
  --  One row at a time — the following month is created after this one has
  --  been sent, so the Reminders page never fills up with a year of nudges.
  for r in
    select * from public.financial_goals
     where user_id = v_uid
       and status = 'active'
       and current_amount < target_amount
  loop
    insert into public.reminders (
      user_id, workspace_id, kind, goal_id, title, body,
      amount, currency, due_on, remind_at, channel, dedupe_key
    )
    values (
      r.user_id, r.workspace_id, 'goal', r.id,
      'Put something towards ' || r.name,
      'You are ' || to_char(greatest(r.target_amount - r.current_amount, 0), 'FM999,999,999')
        || ' away from the target.',
      greatest(r.target_amount - r.current_amount, 0), 'INR',
      (date_trunc('month', current_date) + interval '1 month')::date,
      (date_trunc('month', current_date) + interval '1 month')::timestamptz
        + interval '9 hours',
      'email',
      'goal-month:' || r.id::text || ':' ||
        to_char(date_trunc('month', current_date) + interval '1 month', 'YYYY-MM')
    )
    on conflict (user_id, dedupe_key) do nothing;

    if found then v_made := v_made + 1; end if;
  end loop;

  -- ── Budgets: threshold and overspend alerts ─────────────────────────────
  --  Reactive, not scheduled: the row appears at the moment the line is
  --  crossed, so remind_at is now. Keyed by period start, so next month
  --  starts clean.
  for r in
    select
      b.*,
      case b.period
        when 'weekly'    then date_trunc('week', current_date)::date
        when 'monthly'   then date_trunc('month', current_date)::date
        when 'quarterly' then date_trunc('quarter', current_date)::date
        else date_trunc('year', current_date)::date
      end as period_start,
      coalesce(spent.total, 0) as spent
    from public.budgets b
    left join lateral (
      select sum(t.amount) as total
        from public.transactions t
       where t.user_id = b.user_id
         and t.workspace_id = b.workspace_id
         and t.type = 'expense'
         and t.status = 'completed'
         and (b.category_id is null or t.category_id = b.category_id)
         and t.txn_date >= case b.period
                             when 'weekly'    then date_trunc('week', current_date)::date
                             when 'monthly'   then date_trunc('month', current_date)::date
                             when 'quarterly' then date_trunc('quarter', current_date)::date
                             else date_trunc('year', current_date)::date
                           end
    ) spent on true
    where b.user_id = v_uid
      and b.is_active
      and b.amount > 0
      and coalesce(spent.total, 0) >= b.amount * (b.alert_threshold / 100.0)
  loop
    insert into public.reminders (
      user_id, workspace_id, kind, title, body,
      amount, currency, due_on, remind_at, channel, dedupe_key
    )
    values (
      r.user_id, r.workspace_id, 'budget',
      case when r.spent >= r.amount
           then r.name || ' budget is spent'
           else r.name || ' budget is at ' ||
                round((r.spent / r.amount) * 100, 0) || '%' end,
      'Spent ' || to_char(r.spent, 'FM999,999,999') ||
        ' of ' || to_char(r.amount, 'FM999,999,999') ||
        ' this ' || r.period::text || ' period.',
      r.spent, 'INR', null, now(), 'email',
      'budget:' || r.id::text || ':' || r.period_start::text || ':' ||
        case when r.spent >= r.amount then 'over' else 'threshold' end
    )
    on conflict (user_id, dedupe_key) do nothing;

    if found then v_made := v_made + 1; end if;
  end loop;

  return v_made;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §9  AUTOMATIC — the moment you save the record
--
--  Until now the generator only ran once a session from the browser, so a
--  record created afterwards had no reminder until the next day. Each source
--  table now nudges the generator itself. It is idempotent and keyed, so the
--  extra calls cost a scan, never a duplicate.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.touch_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.generate_reminders(new.user_id);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'subscriptions', 'payments', 'invoices', 'financial_goals', 'budgets'
  ] loop
    execute format('drop trigger if exists %1$s_touch_reminders on public.%1$I;', t);
    execute format($p$
      create trigger %1$s_touch_reminders
        after insert or update on public.%1$I
        for each row execute function public.touch_reminders();
    $p$, t);
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §10  GRANTS
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  fn text;
  fns text[] := array[
    'in_scope(uuid,uuid[])',
    'dashboard_summary(text)',
    'cash_summary(text)',
    'cash_activity(text,date,date,integer)',
    'billing_cycle_as_recurrence(billing_cycle,integer)',
    'reminder_send_at(date,integer)',
    'generate_reminders(uuid)',
    'run_due_recurring()',
    'run_due_subscriptions()'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;

commit;


-- ============================================================================
-- ============================================================================
--
--  PART 9 — WEEKLY DIGEST
--
--  Was migration_004_weekly_digest.sql.
--
--  Settings has always had a "Weekly digest" switch. It wrote profiles.weekly_digest
--  and absolutely nothing read it — no query, no job, no email. A user could turn
--  it on, save, see the success toast, and never receive anything, with no way to
--  tell the difference between "off" and "broken".
--
--  This part is the half that was missing: a function that computes the week for
--  every user who opted in. The Worker's Monday cron calls it and sends the mail.
--
--  Nothing here writes to a ledger table. It only reads.
--
-- ============================================================================
-- ============================================================================

begin;

-- ═══════════════════════════════════════════════════════════════════════════
--  §1  BOOKKEEPING COLUMN
--
--  Tracks the last digest actually sent, so a re-run on the same day is a
--  no-op rather than a second copy in the inbox. Cron triggers can and do
--  fire twice.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.profiles
  add column if not exists weekly_digest_sent_on date;

comment on column public.profiles.weekly_digest_sent_on is
  'Date of the last weekly digest sent. Guards against duplicate sends when a cron fires more than once.';


-- ═══════════════════════════════════════════════════════════════════════════
--  §2  ONE USER'S WEEK
--
--  Scoped to the user, across both workspaces — a digest is a personal summary
--  of everything, not a view of whichever workspace happened to be selected in
--  the browser last. RLS is not in play here (this is SECURITY DEFINER, called
--  by the service role), so the user_id filter is doing the isolation and every
--  query below states it explicitly.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.weekly_digest_for(p_user uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from        date := (current_date - interval '7 days')::date;
  v_to          date := current_date;

  v_income      numeric := 0;
  v_expense     numeric := 0;
  v_count       int     := 0;

  v_prev_income  numeric := 0;
  v_prev_expense numeric := 0;

  v_balance     numeric := 0;
  v_top         json;
  v_upcoming    json;
  v_overdue_n   int := 0;
begin
  -- The week just gone.
  select
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0),
    count(*)
  into v_income, v_expense, v_count
  from public.transactions t
  where t.user_id = p_user
    and t.status = 'completed'
    and t.txn_date >= v_from
    and t.txn_date < v_to;

  -- The week before it, so the email can say "up" or "down" and mean it.
  select
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
  into v_prev_income, v_prev_expense
  from public.transactions t
  where t.user_id = p_user
    and t.status = 'completed'
    and t.txn_date >= (v_from - interval '7 days')::date
    and t.txn_date < v_from;

  select coalesce(sum(a.current_balance), 0)
  into v_balance
  from public.accounts a
  where a.user_id = p_user
    and a.is_active;

  -- Where the money went: the five biggest categories of the week.
  select coalesce(json_agg(x), '[]'::json)
  into v_top
  from (
    select
      coalesce(c.name, 'Uncategorised') as name,
      sum(t.amount)                     as amount
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.user_id = p_user
      and t.status = 'completed'
      and t.type = 'expense'
      and t.txn_date >= v_from
      and t.txn_date < v_to
    group by 1
    order by 2 desc
    limit 5
  ) x;

  -- What is about to land, so the digest is forward-looking and not just a
  -- report card.
  select coalesce(json_agg(x), '[]'::json)
  into v_upcoming
  from (
    select
      p.name     as name,
      p.amount   as amount,
      p.due_date as due_on
    from public.payments p
    where p.user_id = p_user
      and p.status not in ('paid', 'cancelled')
      and p.due_date >= v_to
      and p.due_date < (v_to + interval '7 days')::date
    order by p.due_date
    limit 5
  ) x;

  select count(*)
  into v_overdue_n
  from public.payments p
  where p.user_id = p_user
    and p.status not in ('paid', 'cancelled')
    and p.due_date < v_to;

  return json_build_object(
    'from',           v_from,
    'to',             v_to,
    'income',         v_income,
    'expense',        v_expense,
    'net',            v_income - v_expense,
    'txn_count',      v_count,
    'prev_income',    v_prev_income,
    'prev_expense',   v_prev_expense,
    'balance',        v_balance,
    'top_categories', v_top,
    'upcoming',       v_upcoming,
    'overdue_count',  v_overdue_n
  );
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §3  THE BATCH THE WORKER ASKS FOR
--
--  Only users who switched the digest on, who have somewhere to send it, and
--  who have not already had one today.
--
--  A user with no activity at all still gets nothing: an empty digest is spam
--  that happens to be accurate.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.weekly_digest_batch(p_limit integer default 200)
returns table (
  user_id   uuid,
  email     text,
  full_name text,
  currency  text,
  digest    json
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce(nullif(p.notify_email, ''), p.email) as email,
    coalesce(nullif(p.full_name, ''), 'there')    as full_name,
    coalesce(p.currency, 'INR')                   as currency,
    public.weekly_digest_for(p.id)                as digest
  from public.profiles p
  where p.weekly_digest
    and coalesce(nullif(p.notify_email, ''), p.email) <> ''
    and (p.weekly_digest_sent_on is null or p.weekly_digest_sent_on < current_date)
    and exists (
      select 1
      from public.transactions t
      where t.user_id = p.id
        and t.txn_date >= (current_date - interval '7 days')::date
    )
  order by p.id
  limit greatest(p_limit, 1);
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §4  MARK AS SENT
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.mark_weekly_digest_sent(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set weekly_digest_sent_on = current_date
   where id = p_user;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  §5  GRANTS
--
--  `weekly_digest_for` is useful to the signed-in user (a preview in the app
--  could call it for themselves), but it is SECURITY DEFINER and takes a user
--  id, so it must never be reachable by `anon` — that would let an
--  unauthenticated caller read anyone's week by guessing a uuid.
--
--  The batch and the mark are service-role only: they cross user boundaries
--  by design and have no business being callable from a browser.
-- ═══════════════════════════════════════════════════════════════════════════
revoke all on function public.weekly_digest_for(uuid) from public, anon;
revoke all on function public.weekly_digest_batch(integer) from public, anon, authenticated;
revoke all on function public.mark_weekly_digest_sent(uuid) from public, anon, authenticated;

-- Callers may only ask for their own week.
create or replace function public.my_weekly_digest()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then json_build_object('error', 'not authenticated')
    else public.weekly_digest_for(auth.uid())
  end;
$$;

revoke all on function public.my_weekly_digest() from public, anon;
grant execute on function public.my_weekly_digest() to authenticated;

commit;


-- ============================================================================
--
--  SETUP COMPLETE
--
--  Next steps:
--    1. Authentication → URL Configuration
--         Site URL      https://finance.novatrixdigital.in
--         Redirect URLs https://finance.novatrixdigital.in/auth/callback
--                       https://finance.novatrixdigital.in/reset
--                       http://localhost:5173/auth/callback
--                       http://localhost:5173/reset
--    2. Sign up in the app. The handle_new_user trigger creates your profile,
--       both workspaces, starter accounts and 17 categories.
--    3. Add your first account, then start recording. Every workspace is given
--       a "Cash in Hand" account so physical money is tracked from day one
--       alongside the bank.
--    4. Deploy the Worker (npm run deploy). It carries the daily cron that
--       posts due recurring entries and subscription renewals, sends
--       reminders, and mails the Monday digest.
--
-- ============================================================================
--
--  VERIFY THE INSTALL
--
--  -- Schema ------------------------------------------------------------
--  select table_name from information_schema.tables
--   where table_schema = 'public' order by 1;
--
--  select tablename, rowsecurity from pg_tables
--   where schemaname = 'public';                    -- all must be true
--
--  -- Part 7: cash and the single-primary rule ---------------------------
--  select user_id, count(*) from public.accounts
--   where is_primary group by user_id having count(*) <> 1;   -- expect 0 rows
--
--  select w.id from public.workspaces w
--   where not exists (select 1 from public.accounts a
--                      where a.workspace_id = w.id and a.type = 'cash');
--                                                             -- expect 0 rows
--
--  select proname from pg_proc where proname like 'seed_demo%';
--                                       -- expect 0 rows: the demo seed is gone
--
--  -- Part 8: shared rows are allowed -----------------------------------
--  select is_nullable from information_schema.columns
--   where table_name = 'accounts' and column_name = 'workspace_id';  -- YES
--
--  -- Part 9: the digest ------------------------------------------------
--  select proname from pg_proc
--   where proname in ('weekly_digest_for', 'weekly_digest_batch',
--                     'mark_weekly_digest_sent', 'my_weekly_digest');
--                                                            -- expect 4 rows
--
--  -- Send yourself one now (dryRun renders without sending):
--  --   curl -X POST https://<your-worker>/api/reminders/run \
--  --        -H "x-reminder-secret: $REMINDER_SECRET" \
--  --        -H "content-type: application/json" \
--  --        -d '{"digest": true, "dryRun": true}'
--
-- ============================================================================
