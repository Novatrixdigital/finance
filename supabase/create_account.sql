-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  NOVATRIX DIGITAL — CREATE THE OWNER ACCOUNT                             ║
-- ║                                                                          ║
-- ║  Creates:  info@novatrixdigital.in  (Surendran M)                        ║
-- ║                                                                          ║
-- ║  RUN THIS *AFTER* novatrix_complete.sql.                                 ║
-- ║  It depends on the handle_new_user trigger from Part 3, which fires on    ║
-- ║  insert into auth.users and builds the profile, BOTH workspaces, the      ║
-- ║  starter accounts and the 17 default categories automatically.            ║
-- ║                                                                          ║
-- ║  Idempotent: if the email already exists, the password is reset instead   ║
-- ║  of creating a duplicate.                                                 ║
-- ║                                                                          ║
-- ║  ─────────────────────────────────────────────────────────────────────   ║
-- ║  SECURITY                                                                 ║
-- ║  Fill in v_password below, run this once, then blank it again.            ║
-- ║  Do NOT commit a real password — git retains it in history for ever,      ║
-- ║  even after a later edit removes it from the working file.                ║
-- ║                                                                           ║
-- ║  Easier alternative: Supabase Dashboard → Authentication → Users →        ║
-- ║  Add user, with "Auto Confirm" ticked. Same result, no secret on disk.    ║
-- ║  ─────────────────────────────────────────────────────────────────────   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

do $$
declare
  v_email    text := 'info@novatrixdigital.in';
  -- Set this immediately before running, then clear it again. Never commit
  -- a real password: git keeps it in history even after you edit the file.
  v_password text := 'REPLACE_WITH_A_PASSWORD';
  v_name     text := 'Surendran M';
  v_uid      uuid;
  v_existing uuid;
begin
  -- pgcrypto supplies crypt() / gen_salt(); Part 1 already enabled it.
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    raise exception 'pgcrypto is missing — run novatrix_complete.sql first.';
  end if;

  select id into v_existing from auth.users where email = lower(v_email);

  -- ── Already there: just reset the password and confirm the address ──────
  if v_existing is not null then
    update auth.users
       set encrypted_password = crypt(v_password, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at         = now(),
           raw_user_meta_data =
             coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', v_name)
     where id = v_existing;

    update public.profiles
       set full_name = v_name,
           email     = lower(v_email)
     where id = v_existing;

    raise notice 'Account already existed — password reset. uid=%', v_existing;
    return;
  end if;

  -- ── Create the auth user ────────────────────────────────────────────────
  v_uid := gen_random_uuid();

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,          -- pre-confirmed: no verification email needed
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_uid,
    'authenticated',
    'authenticated',
    lower(v_email),
    crypt(v_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', v_name),
    now(),
    now(),
    '', '', '', ''                -- GoTrue expects empty strings, not NULLs
  );

  -- ── Matching identity row, or password sign-in will not resolve ─────────
  insert into auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', lower(v_email),
                       'email_verified', true, 'phone_verified', false),
    'email',
    lower(v_email),
    now(),
    now(),
    now()
  );

  raise notice 'Created % (uid=%)', v_email, v_uid;
  raise notice 'The handle_new_user trigger has built the profile, both workspaces and the categories.';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
select
  u.id,
  u.email,
  u.email_confirmed_at is not null                as confirmed,
  p.full_name,
  (select count(*) from public.workspaces w where w.user_id = u.id) as workspaces,   -- expect 2
  (select count(*) from public.accounts   a where a.user_id = u.id) as accounts,     -- expect 3
  (select count(*) from public.categories c where c.user_id = u.id) as categories    -- expect 17
from auth.users u
left join public.profiles p on p.id = u.id
where u.email = 'info@novatrixdigital.in';

-- ═══════════════════════════════════════════════════════════════════════════
--  OPTIONAL — load the six-month demo book into this account
--  Run while signed in as this user (the function is scoped to auth.uid()),
--  or press "Load demo data" on the dashboard.
-- ═══════════════════════════════════════════════════════════════════════════
-- select public.seed_demo_data();
