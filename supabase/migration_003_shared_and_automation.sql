-- ============================================================================
--  NOVATRIX FINANCE — MIGRATION 003
--  Shared accounts/contacts · subscription automation · reminders everywhere
--
--  RUN THIS ON A DATABASE THAT ALREADY HOLDS REAL DATA.
--  Run migration_002 first. Safe to run more than once.
--
--  Nothing here deletes a transaction, an invoice, a payment or an account,
--  and no balance is recomputed behind your back. The three places that do
--  change what you see are called out where they happen:
--
--    §1  lets an account (or contact) belong to BOTH workspaces instead of
--        one, by allowing workspace_id to be NULL — exactly how categories
--        have always worked. Existing rows keep the workspace they have.
--    §4  makes the Personal / Business split figures report the truth at all
--        times instead of echoing whichever scope you were looking at.
--    §5  gives every subscription a mirrored row on the Recurring page. The
--        mirror never posts to the ledger, so nothing can be charged twice.
--
--  HOW TO RUN IT
--  ─────────────
--  Paste the whole file into the Supabase SQL editor and run it once.
--
--  §0 adds an enum label and deliberately sits OUTSIDE the transaction,
--  because a new label cannot be used in the transaction that creates it.
--  If your client wraps the whole script in one transaction and complains
--  about "unsafe use of new value of enum type", run §0 on its own first and
--  then run the rest — the file is idempotent, so nothing is harmed by that.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
--  §0  ENUM EXTENSION — outside the transaction on purpose
--
--  A new enum label cannot be USED in the same transaction that adds it, so
--  this runs and commits on its own before the migration body opens.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'reminder_kind'
       and e.enumlabel = 'budget'
  ) then
    alter type reminder_kind add value 'budget';
  end if;
end $$;

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
