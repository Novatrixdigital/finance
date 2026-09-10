-- ============================================================================
--  NOVATRIX FINANCE — MIGRATION 002
--  Cash system · single primary account · payment/goal/budget fixes
--
--  RUN THIS ON A DATABASE THAT ALREADY HOLDS REAL DATA.
--
--  Everything below is additive or corrective. Nothing here deletes a
--  transaction, an account, an invoice or a payment you entered, and no
--  balance is recomputed behind your back. The two places that do touch
--  existing rows are called out explicitly:
--
--    §1  collapses multiple primary accounts down to one (the flag only —
--        balances are untouched), because that is the bug being fixed;
--    §2  adds a zero-balance "Cash in Hand" account to any workspace that
--        does not have one. Zero balance means zero effect on your totals.
--
--  Safe to run more than once.
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
--  VERIFY
--
--    -- exactly one primary per user
--    select user_id, count(*) from public.accounts
--     where is_primary group by user_id having count(*) <> 1;   -- expect 0 rows
--
--    -- every workspace has cash
--    select w.id from public.workspaces w
--     where not exists (select 1 from public.accounts a
--                        where a.workspace_id = w.id and a.type = 'cash');  -- 0 rows
--
--    -- the demo functions are gone
--    select proname from pg_proc where proname like 'seed_demo%';           -- 0 rows
-- ============================================================================
