-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║                                                                          ║
-- ║                        N O V A T R I X   D I G I T A L                   ║
-- ║                          Finance. Simplified.                            ║
-- ║                                                                          ║
-- ║                  COMPLETE DATABASE SETUP — SINGLE SCRIPT                 ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
--  HOW TO RUN
--  ──────────
--  1. Open your Supabase project → SQL Editor → New query.
--  2. Paste this entire file and press Run.
--  3. Copy Project URL + anon key from Settings → API into your .env.
--
--  The script is idempotent: every table uses CREATE TABLE IF NOT EXISTS,
--  every policy is dropped before being recreated, and every function uses
--  CREATE OR REPLACE. Running it twice is safe.
--
--  Target: Supabase / PostgreSQL 15+
--
--  CONTENTS
--  ────────
--    Part 1  Schema ............ tables, enums, balance + invoice triggers
--    Part 2  Row Level Security  policies, ownership helper, grants
--    Part 3  Functions & RPCs .. signup bootstrap, dashboard aggregations
--    Part 4  Storage ........... avatars + attachments buckets
--    Part 5  Demo seed ......... seed_demo_data(), reset_my_data()
--    Part 6  Subscriptions ..... renewals, reminders, Resend email support
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
--  PART 5 — DEMO SEED
--
--  seed_demo_data() and reset_my_data(), both scoped to the calling user.
--
--  (was 05_seed.sql)
-- ============================================================================
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  NOVATRIX DIGITAL — 05 DEMO SEED                                         ║
-- ║                                                                          ║
-- ║  `public.seed_demo_data()` fills the CALLING user's own workspaces with  ║
-- ║  a realistic six-month book. It is uid-scoped, so it can never write to  ║
-- ║  another account. The app offers it as "Load demo data" in Settings and  ║
-- ║  on the empty dashboard.                                                 ║
-- ║                                                                          ║
-- ║  Figures are internally consistent — every headline number the           ║
-- ║  dashboard shows is computed from these rows, not hard-coded.            ║
-- ║    Personal balance  ₹  8,75,000                                         ║
-- ║    Business balance  ₹ 16,10,000                                         ║
-- ║    Net worth         ₹ 24,85,000                                         ║
-- ║    Income  (month)   ₹  8,40,000                                         ║
-- ║    Expenses(month)   ₹  5,12,000                                         ║
-- ║    Receivables       ₹  3,45,000  across 5 invoices                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.seed_demo_data()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_pers  uuid;
  v_biz   uuid;

  -- accounts
  a_hdfc uuid; a_cash uuid; a_invest uuid;
  a_curr uuid; a_biz_savings uuid; a_card uuid;

  -- contacts
  c_abc uuid; c_stellar uuid; c_meridian uuid; c_vertex uuid; c_orbit uuid;
  c_dell uuid; c_adobe uuid; c_landlord uuid;

  -- categories
  k_salary uuid; k_client uuid; k_interest uuid;
  k_office uuid; k_salaries uuid; k_rent uuid; k_marketing uuid;
  k_travel uuid; k_software uuid; k_others uuid; k_food uuid; k_transport uuid;

  -- invoices
  i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid; i6 uuid;

  v_month  date := date_trunc('month', current_date)::date;
  v_delta  numeric;
  i        int;

  -- Six-month history (index 1 = five months ago … index 5 = last month)
  hist_income  numeric[] := array[620000, 780000, 700000, 860000, 710000];
  hist_expense numeric[] := array[430000, 400000, 455000, 470000, 440000];
  m_start      date;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not authenticated');
  end if;

  select id into v_pers from public.workspaces where user_id = v_uid and type = 'personal';
  select id into v_biz  from public.workspaces where user_id = v_uid and type = 'business';

  if v_pers is null or v_biz is null then
    return json_build_object('ok', false, 'error', 'workspaces missing — sign out and back in');
  end if;

  -- ── Clean slate ────────────────────────────────────────────────────────
  delete from public.transactions            where user_id = v_uid;
  delete from public.invoice_items           where user_id = v_uid;
  delete from public.payments                where user_id = v_uid;
  delete from public.invoices                where user_id = v_uid;
  delete from public.financial_goals         where user_id = v_uid;
  delete from public.budgets                 where user_id = v_uid;
  delete from public.recurring_transactions  where user_id = v_uid;
  delete from public.contacts                where user_id = v_uid;
  delete from public.accounts                where user_id = v_uid;

  -- ── Categories (created at signup; look them up) ───────────────────────
  select id into k_salary   from public.categories where user_id = v_uid and name = 'Salary'              limit 1;
  select id into k_client   from public.categories where user_id = v_uid and name = 'Client Revenue'      limit 1;
  select id into k_interest from public.categories where user_id = v_uid and name = 'Interest & Dividend' limit 1;
  select id into k_office   from public.categories where user_id = v_uid and name = 'Office Expenses'     limit 1;
  select id into k_salaries from public.categories where user_id = v_uid and name = 'Salaries'            limit 1;
  select id into k_rent     from public.categories where user_id = v_uid and name = 'Rent & Utilities'    limit 1;
  select id into k_marketing from public.categories where user_id = v_uid and name = 'Marketing'          limit 1;
  select id into k_travel   from public.categories where user_id = v_uid and name = 'Travel'              limit 1;
  select id into k_software from public.categories where user_id = v_uid and name = 'Software & Tools'    limit 1;
  select id into k_others   from public.categories where user_id = v_uid and name = 'Others'              limit 1;
  select id into k_food     from public.categories where user_id = v_uid and name = 'Food & Dining'       limit 1;
  select id into k_transport from public.categories where user_id = v_uid and name = 'Transport'          limit 1;

  -- ── Accounts ───────────────────────────────────────────────────────────
  insert into public.accounts (user_id, workspace_id, name, type, institution, account_number, icon, color, is_primary, opening_balance)
  values (v_uid, v_pers, 'HDFC Savings', 'savings', 'HDFC Bank', 'XXXX 4421', 'landmark', '#C8FF00', true, 0)
  returning id into a_hdfc;

  insert into public.accounts (user_id, workspace_id, name, type, institution, icon, color, opening_balance)
  values (v_uid, v_pers, 'Cash Wallet', 'cash', null, 'wallet', '#A8E600', 24000)
  returning id into a_cash;

  insert into public.accounts (user_id, workspace_id, name, type, institution, icon, color, opening_balance)
  values (v_uid, v_pers, 'Index Portfolio', 'investment', 'Zerodha', 'trending-up', '#7DD3FC', 310000)
  returning id into a_invest;

  insert into public.accounts (user_id, workspace_id, name, type, institution, account_number, icon, color, is_primary, opening_balance)
  values (v_uid, v_biz, 'Business Current', 'bank', 'ICICI Bank', 'XXXX 9087', 'building-2', '#C8FF00', true, 0)
  returning id into a_curr;

  insert into public.accounts (user_id, workspace_id, name, type, institution, icon, color, opening_balance)
  values (v_uid, v_biz, 'Business Reserve', 'savings', 'ICICI Bank', 'piggy-bank', '#B6FF00', 480000)
  returning id into a_biz_savings;

  insert into public.accounts (user_id, workspace_id, name, type, institution, icon, color, credit_limit, opening_balance)
  values (v_uid, v_biz, 'Corporate Card', 'credit_card', 'Amex', 'credit-card', '#FF5C6C', 500000, -64000)
  returning id into a_card;

  -- ── Contacts ───────────────────────────────────────────────────────────
  insert into public.contacts (user_id, workspace_id, name, type, company, email, phone, city)
  values (v_uid, v_biz, 'ABC Tech Solutions', 'customer', 'ABC Tech Pvt Ltd', 'accounts@abctech.in', '+91 98400 11223', 'Chennai')
  returning id into c_abc;

  insert into public.contacts (user_id, workspace_id, name, type, company, email, city)
  values (v_uid, v_biz, 'Stellar Infotech', 'customer', 'Stellar Infotech LLP', 'finance@stellar.io', 'Bengaluru')
  returning id into c_stellar;

  insert into public.contacts (user_id, workspace_id, name, type, company, email, city)
  values (v_uid, v_biz, 'Meridian Retail', 'customer', 'Meridian Retail Ltd', 'ap@meridian.co.in', 'Mumbai')
  returning id into c_meridian;

  insert into public.contacts (user_id, workspace_id, name, type, company, email, city)
  values (v_uid, v_biz, 'Vertex Media', 'customer', 'Vertex Media Group', 'billing@vertex.media', 'Hyderabad')
  returning id into c_vertex;

  insert into public.contacts (user_id, workspace_id, name, type, company, email, city)
  values (v_uid, v_biz, 'Orbit Labs', 'customer', 'Orbit Labs Pvt Ltd', 'hello@orbitlabs.dev', 'Pune')
  returning id into c_orbit;

  insert into public.contacts (user_id, workspace_id, name, type, company, email)
  values (v_uid, v_biz, 'Dell Technologies', 'vendor', 'Dell India', 'orders@dell.in')
  returning id into c_dell;

  insert into public.contacts (user_id, workspace_id, name, type, company)
  values (v_uid, v_biz, 'Adobe Inc', 'vendor', 'Adobe Systems')
  returning id into c_adobe;

  insert into public.contacts (user_id, workspace_id, name, type, phone)
  values (v_uid, v_biz, 'Kumar Properties', 'vendor', '+91 90030 55441')
  returning id into c_landlord;

  -- ═══════════════════════════════════════════════════════════════════════
  --  SIX-MONTH LEDGER
  --  Months −5 … −1 are summarised; the current month is itemised so the
  --  donut chart lands on the exact category mix.
  -- ═══════════════════════════════════════════════════════════════════════
  for i in 1..5 loop
    m_start := (v_month - make_interval(months => 6 - i))::date;

    -- Business revenue (65%) + personal salary (35%)
    insert into public.transactions (user_id, workspace_id, account_id, category_id, contact_id, type, amount, txn_date, description, payment_method)
    values
      (v_uid, v_biz,  a_curr, k_client, c_abc, 'income',
       round(hist_income[i] * 0.65, 2), m_start + 6, 'Client retainer — ABC Tech', 'Bank Transfer'),
      (v_uid, v_pers, a_hdfc, k_salary, null, 'income',
       round(hist_income[i] * 0.35, 2), m_start + 1, 'Salary credit', 'Bank Transfer');

    -- Expenses split across the main heads
    insert into public.transactions (user_id, workspace_id, account_id, category_id, contact_id, type, amount, txn_date, description, payment_method)
    values
      (v_uid, v_biz,  a_curr, k_office,   null,       'expense', round(hist_expense[i] * 0.30, 2), m_start + 8,  'Office operations',   'Bank Transfer'),
      (v_uid, v_biz,  a_curr, k_salaries, null,       'expense', round(hist_expense[i] * 0.24, 2), m_start + 27, 'Team salaries',       'Bank Transfer'),
      (v_uid, v_biz,  a_curr, k_rent,     c_landlord, 'expense', round(hist_expense[i] * 0.16, 2), m_start + 4,  'Office rent',         'Bank Transfer'),
      (v_uid, v_biz,  a_card, k_software, c_adobe,    'expense', round(hist_expense[i] * 0.10, 2), m_start + 11, 'Software licences',   'Card'),
      (v_uid, v_pers, a_hdfc, k_food,     null,       'expense', round(hist_expense[i] * 0.12, 2), m_start + 14, 'Groceries & dining',  'UPI'),
      (v_uid, v_pers, a_cash, k_transport,null,       'expense', round(hist_expense[i] * 0.08, 2), m_start + 18, 'Fuel & transport',    'Cash');
  end loop;

  -- ── CURRENT MONTH — income ₹8,40,000 ───────────────────────────────────
  insert into public.transactions (user_id, workspace_id, account_id, category_id, contact_id, type, amount, txn_date, description, payment_method, reference)
  values
    (v_uid, v_biz,  a_curr, k_client,   c_abc,     'income', 150000, current_date,     'Client Payment - ABC Tech', 'Bank Transfer', 'NEFT-88431'),
    (v_uid, v_pers, a_hdfc, k_salary,   null,      'income', 120000, current_date - 3, 'Salary Credit',             'Bank Transfer', 'SAL-2026-09'),
    (v_uid, v_biz,  a_curr, k_client,   c_stellar, 'income', 370000, v_month + 2,      'Project milestone - Stellar Infotech', 'Bank Transfer', 'NEFT-88102'),
    (v_uid, v_pers, a_hdfc, k_salary,   null,      'income', 120000, v_month,          'Consulting retainer',       'Bank Transfer', null),
    (v_uid, v_pers, a_invest, k_interest, null,    'income',  80000, v_month + 1,      'Dividend & interest',       'Bank Transfer', null);

  -- ── CURRENT MONTH — expenses ₹5,12,000 in the exact category mix ───────
  insert into public.transactions (user_id, workspace_id, account_id, category_id, contact_id, type, amount, txn_date, description, payment_method)
  values
    (v_uid, v_biz,  a_curr, k_rent,      c_landlord, 'expense',  60000, current_date - 1, 'Office Rent',            'Bank Transfer'),
    (v_uid, v_pers, a_hdfc, k_others,    null,       'expense',   8499, current_date - 2, 'Amazon Purchase',        'Card'),
    (v_uid, v_biz,  a_card, k_software,  c_adobe,    'expense',  12499, current_date - 4, 'Software Subscription',  'Card'),
    (v_uid, v_biz,  a_curr, k_office,    null,       'expense', 143360, v_month + 3,      'Office expenses',        'Bank Transfer'),
    (v_uid, v_biz,  a_curr, k_salaries,  null,       'expense', 102400, v_month + 1,      'Team salaries',          'Bank Transfer'),
    (v_uid, v_pers, a_hdfc, k_rent,      null,       'expense',  16800, v_month + 2,      'Electricity & internet', 'UPI'),
    (v_uid, v_biz,  a_curr, k_marketing, null,       'expense',  61440, v_month + 4,      'Campaign spend',         'Card'),
    (v_uid, v_biz,  a_card, k_travel,    null,       'expense',  30000, v_month + 5,      'Client visit — travel',  'Card'),
    (v_uid, v_pers, a_hdfc, k_travel,    null,       'expense',  21200, v_month + 2,      'Weekend trip',           'Card'),
    (v_uid, v_biz,  a_card, k_software,  null,       'expense',  28461, v_month + 6,      'Cloud & tooling',        'Card'),
    (v_uid, v_pers, a_cash, k_others,    null,       'expense',  27341, v_month + 3,      'Household & misc',       'Cash');

  -- ═══════════════════════════════════════════════════════════════════════
  --  INVOICES — ₹3,45,000 outstanding across 5, plus one settled
  -- ═══════════════════════════════════════════════════════════════════════
  insert into public.invoices (user_id, workspace_id, contact_id, invoice_number, status, issue_date, due_date, terms)
  values (v_uid, v_biz, c_abc, 'NOV-' || to_char(current_date, 'YYYY') || '-0001', 'sent',
          current_date - 12, current_date + 10, 'Net 15 — bank transfer only.')
  returning id into i1;

  insert into public.invoices (user_id, workspace_id, contact_id, invoice_number, status, issue_date, due_date)
  values (v_uid, v_biz, c_stellar, 'NOV-' || to_char(current_date, 'YYYY') || '-0002', 'sent',
          current_date - 9, current_date + 14)
  returning id into i2;

  insert into public.invoices (user_id, workspace_id, contact_id, invoice_number, status, issue_date, due_date)
  values (v_uid, v_biz, c_meridian, 'NOV-' || to_char(current_date, 'YYYY') || '-0003', 'sent',
          current_date - 6, current_date + 18)
  returning id into i3;

  insert into public.invoices (user_id, workspace_id, contact_id, invoice_number, status, issue_date, due_date)
  values (v_uid, v_biz, c_vertex, 'NOV-' || to_char(current_date, 'YYYY') || '-0004', 'sent',
          current_date - 40, current_date - 8)   -- trigger will mark this overdue
  returning id into i4;

  insert into public.invoices (user_id, workspace_id, contact_id, invoice_number, status, issue_date, due_date)
  values (v_uid, v_biz, c_orbit, 'NOV-' || to_char(current_date, 'YYYY') || '-0005', 'sent',
          current_date - 2, current_date + 21)
  returning id into i5;

  insert into public.invoices (user_id, workspace_id, contact_id, invoice_number, status, issue_date, due_date)
  values (v_uid, v_biz, c_abc, 'NOV-' || to_char(current_date, 'YYYY') || '-0006', 'sent',
          current_date - 30, current_date - 15)
  returning id into i6;

  insert into public.invoice_items (invoice_id, user_id, description, quantity, rate, sort_order)
  values
    (i1, v_uid, 'Product design retainer — September', 1, 90000, 1),
    (i1, v_uid, 'Front-end engineering (30 hrs)',     30,  1000, 2),
    (i2, v_uid, 'Platform integration — phase 2',      1, 85000, 1),
    (i3, v_uid, 'Analytics dashboard build',           1, 60000, 1),
    (i4, v_uid, 'Brand campaign microsite',            1, 45000, 1),
    (i5, v_uid, 'API consulting (14 hrs)',            14,  2500, 1),
    (i6, v_uid, 'Support & maintenance — August',      1,150000, 1);

  -- i1 120,000 · i2 85,000 · i3 60,000 · i4 45,000 · i5 35,000  ⇒ ₹3,45,000
  -- i6 150,000 is fully paid below, so it leaves receivables untouched.

  -- ═══════════════════════════════════════════════════════════════════════
  --  PAYMENTS
  -- ═══════════════════════════════════════════════════════════════════════
  insert into public.payments (user_id, workspace_id, contact_id, account_id, name, direction, status, amount, due_date, method)
  values
    (v_uid, v_biz, c_dell,     a_curr, 'Dell Technologies',    'outgoing', 'upcoming',  85000, current_date + 2,  'Bank Transfer'),
    (v_uid, v_biz, c_landlord, a_curr, 'Office Rent',          'outgoing', 'upcoming',  60000, current_date + 4,  'Bank Transfer'),
    (v_uid, v_biz, c_adobe,    a_card, 'Adobe Subscription',   'outgoing', 'upcoming',  12499, current_date + 7,  'Card'),
    (v_uid, v_biz, c_stellar,  a_curr, 'Vendor - Stellar Info','outgoing', 'pending',   45000, current_date + 10, 'Bank Transfer'),
    (v_uid, v_biz, null,       a_curr, 'Team Salaries',        'outgoing', 'upcoming', 180000, current_date + 22, 'Bank Transfer'),
    (v_uid, v_pers, null,      a_hdfc, 'Home Loan EMI',        'outgoing', 'upcoming',  42000, current_date + 5,  'Auto Debit'),
    (v_uid, v_pers, null,      a_hdfc, 'Health Insurance',     'outgoing', 'upcoming',  18500, current_date + 12, 'Auto Debit'),
    (v_uid, v_pers, null,      a_hdfc, 'Credit Card Bill',     'outgoing', 'pending',   26400, current_date + 9,  'Auto Debit');

  -- The settled invoice, recorded as an incoming payment.
  insert into public.payments (user_id, workspace_id, invoice_id, contact_id, account_id, name, direction, status, amount, due_date, paid_date, method)
  values (v_uid, v_biz, i6, c_abc, a_curr, 'ABC Tech — August support', 'incoming', 'paid',
          150000, current_date - 15, current_date - 14, 'Bank Transfer');

  -- ═══════════════════════════════════════════════════════════════════════
  --  GOALS
  -- ═══════════════════════════════════════════════════════════════════════
  insert into public.financial_goals (user_id, workspace_id, name, icon, color, target_amount, current_amount, target_date, description)
  values
    (v_uid, v_pers, 'New Car',            'car',        '#C8FF00',  1000000,  600000, date '2026-12-31', 'Downpayment plus on-road cost.'),
    (v_uid, v_biz,  'Business Expansion', 'building-2', '#A8E600',  3000000, 1200000, date '2027-03-31', 'Second studio floor and hiring.'),
    (v_uid, v_pers, 'Emergency Fund',     'shield',     '#7DD3FC',   600000,  420000, date '2026-11-30', 'Six months of runway.');

  -- ═══════════════════════════════════════════════════════════════════════
  --  BUDGETS
  -- ═══════════════════════════════════════════════════════════════════════
  insert into public.budgets (user_id, workspace_id, category_id, name, amount, period, alert_threshold)
  values
    (v_uid, v_biz,  k_office,    'Office Expenses',   160000, 'monthly', 80),
    (v_uid, v_biz,  k_marketing, 'Marketing Spend',    75000, 'monthly', 75),
    (v_uid, v_biz,  k_software,  'Software & Tools',   50000, 'monthly', 85),
    (v_uid, v_pers, k_food,      'Food & Dining',      30000, 'monthly', 80),
    (v_uid, v_pers, k_travel,    'Travel',             40000, 'monthly', 70),
    (v_uid, v_pers, k_others,    'Personal Spending',  45000, 'monthly', 80);

  -- ═══════════════════════════════════════════════════════════════════════
  --  RECURRING
  -- ═══════════════════════════════════════════════════════════════════════
  insert into public.recurring_transactions
    (user_id, workspace_id, account_id, category_id, contact_id, name, type, amount, frequency, next_run_date, description)
  values
    (v_uid, v_biz,  a_curr, k_rent,     c_landlord, 'Office Rent',        'expense',  60000, 'monthly', (v_month + interval '1 month')::date, 'Monthly studio rent'),
    (v_uid, v_biz,  a_card, k_software, c_adobe,    'Adobe Creative Cloud','expense', 12499, 'monthly', (v_month + interval '1 month')::date, 'Design suite licence'),
    (v_uid, v_biz,  a_curr, k_salaries, null,       'Team Salaries',      'expense', 180000, 'monthly', (v_month + interval '1 month')::date, 'Payroll run'),
    (v_uid, v_pers, a_hdfc, k_salary,   null,       'Salary Credit',      'income',  120000, 'monthly', (v_month + interval '1 month')::date, 'Monthly salary'),
    (v_uid, v_pers, a_hdfc, k_others,   null,       'Home Loan EMI',      'expense',  42000, 'monthly', (v_month + interval '1 month')::date, 'Housing loan instalment');

  -- ═══════════════════════════════════════════════════════════════════════
  --  BALANCE CALIBRATION
  --  The ledger has moved every balance; nudge each primary account so the
  --  workspace totals land exactly on the headline figures.
  -- ═══════════════════════════════════════════════════════════════════════
  select 875000 - coalesce(sum(current_balance), 0) into v_delta
    from public.accounts where user_id = v_uid and workspace_id = v_pers and is_active;
  update public.accounts
     set opening_balance = opening_balance + v_delta,
         current_balance = current_balance + v_delta
   where id = a_hdfc;

  select 1610000 - coalesce(sum(current_balance), 0) into v_delta
    from public.accounts where user_id = v_uid and workspace_id = v_biz and is_active;
  update public.accounts
     set opening_balance = opening_balance + v_delta,
         current_balance = current_balance + v_delta
   where id = a_curr;

  update public.profiles set onboarded = true where id = v_uid;

  return json_build_object(
    'ok', true,
    'transactions', (select count(*) from public.transactions where user_id = v_uid),
    'invoices',     (select count(*) from public.invoices     where user_id = v_uid),
    'payments',     (select count(*) from public.payments     where user_id = v_uid),
    'net_worth',    (select coalesce(sum(current_balance), 0)
                       from public.accounts where user_id = v_uid and is_active)
  );
end;
$$;

revoke all on function public.seed_demo_data() from public, anon;
grant execute on function public.seed_demo_data() to authenticated;

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
--  DEMO SUBSCRIPTIONS  — call after seed_demo_data()
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.seed_demo_subscriptions()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_pers uuid;
  v_biz  uuid;
  a_hdfc uuid;
  a_card uuid;
  k_soft uuid;
  k_other uuid;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not authenticated');
  end if;

  select id into v_pers from public.workspaces where user_id = v_uid and type = 'personal';
  select id into v_biz  from public.workspaces where user_id = v_uid and type = 'business';
  select id into a_hdfc from public.accounts where user_id = v_uid and workspace_id = v_pers order by is_primary desc limit 1;
  select id into a_card from public.accounts where user_id = v_uid and workspace_id = v_biz  and type = 'credit_card' limit 1;
  select id into k_soft from public.categories where user_id = v_uid and name = 'Software & Tools' limit 1;
  select id into k_other from public.categories where user_id = v_uid and name = 'Others' limit 1;

  delete from public.subscriptions where user_id = v_uid;

  insert into public.subscriptions
    (user_id, workspace_id, account_id, category_id, name, vendor, plan, amount,
     billing_cycle, status, started_on, next_renewal_date, trial_ends_on,
     icon, color, payment_method, auto_post, reminder_days_before, website)
  values
    (v_uid, v_pers, a_hdfc, k_other, 'Netflix',        'Netflix',   'Premium 4K',  649,
     'monthly', 'active', current_date - 400, current_date + 3,  null,
     'monitor',   '#FF5C6C', 'Auto Debit', true, 3, 'https://netflix.com'),

    (v_uid, v_pers, a_hdfc, k_other, 'Spotify',        'Spotify',   'Family',      179,
     'monthly', 'active', current_date - 300, current_date + 9,  null,
     'music',     '#B6FF00', 'UPI', true, 2, 'https://spotify.com'),

    (v_uid, v_pers, a_hdfc, k_other, 'Gym Membership', 'Cult.fit',  'Elite',      2499,
     'monthly', 'active', current_date - 120, current_date + 14, null,
     'dumbbell',  '#C8FF00', 'Card', false, 5, null),

    (v_uid, v_pers, a_hdfc, k_other, 'Health Insurance','HDFC Ergo','Family Floater', 24000,
     'yearly',  'active', current_date - 200, current_date + 40, null,
     'shield',    '#7DD3FC', 'Auto Debit', false, 14, null),

    (v_uid, v_pers, a_hdfc, k_soft,  'iCloud+',        'Apple',     '2TB',         749,
     'monthly', 'active', current_date - 90,  current_date + 20, null,
     'cloud',     '#A78BFA', 'Card', false, 3, null),

    (v_uid, v_pers, a_hdfc, k_other, 'Kindle Unlimited','Amazon',   'Trial',       299,
     'monthly', 'trial',  current_date - 25,  current_date + 5,  current_date + 5,
     'book',      '#FFB547', 'Card', false, 2, null),

    (v_uid, v_biz,  a_card, k_soft,  'Adobe Creative Cloud','Adobe','All Apps',  12499,
     'monthly', 'active', current_date - 500, current_date + 7,  null,
     'monitor',   '#FF5C6C', 'Card', true, 5, 'https://adobe.com'),

    (v_uid, v_biz,  a_card, k_soft,  'Figma',          'Figma',     'Organisation', 3800,
     'monthly', 'active', current_date - 260, current_date + 11, null,
     'package',   '#A78BFA', 'Card', false, 3, 'https://figma.com'),

    (v_uid, v_biz,  a_card, k_soft,  'Google Workspace','Google',   'Business Standard', 6200,
     'monthly', 'active', current_date - 600, current_date + 17, null,
     'globe',     '#7DD3FC', 'Card', false, 3, null);

  perform public.generate_reminders(v_uid);

  return json_build_object(
    'ok', true,
    'subscriptions', (select count(*) from public.subscriptions where user_id = v_uid),
    'reminders',     (select count(*) from public.reminders where user_id = v_uid)
  );
end;
$$;

revoke all on function public.seed_demo_subscriptions() from public, anon;
grant execute on function public.seed_demo_subscriptions() to authenticated;

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
as $
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
$;

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
--    2. Sign up in the app. The handle_new_user trigger creates your
--       profile, both workspaces, starter accounts and 17 categories.
--    3. Optional: run  select public.seed_demo_data();  or press
--       "Load demo data" on the dashboard.
--
--  Verify the install:
--    select table_name from information_schema.tables
--     where table_schema = 'public' order by 1;          -- expect 12 tables
--
--    select tablename, rowsecurity from pg_tables
--     where schemaname = 'public';                       -- all must be true
--
-- ============================================================================
