-- ============================================================
-- PAWS CONSOLE — COMPLETE SUPABASE SETUP (ONE-TIME PASTE)
-- SIH 2026 · PS 26223 · Disaster Management
-- Project: Mumbai / ap-south-1, main branch
--
-- Paste the WHOLE file into Supabase → SQL Editor → Run.
-- 100% safe to re-run (every object uses IF NOT EXISTS / OR REPLACE /
-- ON CONFLICT / DROP IF EXISTS). Nothing here can damage existing data.
--
-- What this creates:
--   1. All console tables + indexes (missions, telemetry, mission_state,
--      events, alerts, commands, detections, trail_points, scores,
--      fusion_weights, profiles, device_tokens)
--   2. device_ingest() RPC — lets the ESP32 write telemetry DIRECTLY
--      with only {project URL + anon key} (no service key on hardware)
--   3. Row Level Security: anon can do NOTHING but call device_ingest;
--      signed-in operators write, observers read
--   4. Realtime publication hookup (already-safe re-run)
--   5. Demo login accounts (operator + observer) with correct roles
-- ============================================================

-- ------------------------------------------------------------------
-- 0. EXTENSIONS
-- ------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- 1. PROFILES  (role: operator | observer)
-- ------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'observer' check (role in ('operator', 'observer')),
  name text,
  created_at timestamptz not null default now()
);

create or replace function public.is_operator()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'operator'
  );
$$;

create or replace function public.ensure_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'role', 'observer'), new.raw_user_meta_data ->> 'name')
  on conflict (id) do update
    set role = excluded.role, name = excluded.name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.ensure_profile();

-- ------------------------------------------------------------------
-- 2. CONSOLE TABLES
-- ------------------------------------------------------------------
create table if not exists public.missions (
  id text primary key,
  name text not null,
  status text not null default 'running' check (status in ('idle','running','paused','ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  origin jsonb not null default '{"xM":0,"yM":0}'::jsonb
);

create table if not exists public.telemetry (
  id bigint generated always as identity primary key,
  mission_id text references public.missions(id) on delete cascade,
  device_id text not null,
  ts bigint not null,
  payload jsonb not null
);
create index if not exists telemetry_mission_idx on public.telemetry (mission_id, id);

create table if not exists public.mission_state (
  mission_id text primary key references public.missions(id) on delete cascade,
  sensors jsonb not null default '{}'::jsonb,
  latest_detection jsonb,
  last_processed_id bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id text primary key,
  mission_id text references public.missions(id) on delete cascade,
  ts bigint not null,
  kind text not null,
  level text not null,
  text text not null,
  snapshot jsonb not null default '{}'::jsonb,
  ref_id text
);
create index if not exists events_mission_idx on public.events (mission_id, ts desc);

create table if not exists public.alerts (
  id text primary key,
  mission_id text references public.missions(id) on delete cascade,
  ts bigint not null,
  kind text not null,
  severity text not null,
  message text not null,
  acked_by text,
  acked_at timestamptz
);

create table if not exists public.commands (
  id text primary key,
  mission_id text references public.missions(id) on delete cascade,
  type text not null,
  params jsonb not null default '{}'::jsonb,
  issued_by text not null,
  issued_at bigint not null,
  current text not null default 'queued',
  stages jsonb not null default '[]'::jsonb
);

create table if not exists public.detections (
  id text primary key,
  mission_id text references public.missions(id) on delete cascade,
  ts bigint not null,
  label text not null,
  confidence numeric(4,2) not null,
  bbox jsonb not null,
  position jsonb
);
create index if not exists detections_mission_idx on public.detections (mission_id, ts desc);

create table if not exists public.trail_points (
  id bigint generated always as identity primary key,
  mission_id text references public.missions(id) on delete cascade,
  x numeric not null,
  y numeric not null,
  ts bigint not null,
  score numeric(4,2) not null,
  hazard numeric(4,2) not null,
  gas_ppm numeric not null default 0
);
create index if not exists trail_mission_idx on public.trail_points (mission_id, id);

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  mission_id text references public.missions(id) on delete cascade,
  ts bigint not null,
  payload jsonb not null
);
create index if not exists scores_mission_idx on public.scores (mission_id, id);

create table if not exists public.fusion_weights (
  id int primary key default 1 check (id = 1),
  vision numeric not null default 0.5,
  sound numeric not null default 0.3,
  thermal numeric not null default 0.2,
  version text not null default '2.1'
);
insert into public.fusion_weights (id) values (1) on conflict do nothing;

-- ------------------------------------------------------------------
-- 3. DEVICE TOKENS  (what the ESP32 must prove before writing)
-- ------------------------------------------------------------------
create table if not exists public.device_tokens (
  token text primary key,
  device_id text not null,
  note text not null default ''
);
insert into public.device_tokens (token, device_id, note)
values ('paws-device-token', 'paws-01', 'default demo token — change before the final demo')
on conflict (token) do nothing;

-- ------------------------------------------------------------------
-- 4. DEVICE INGEST RPC — the ONLY thing the anon key may do.
--    ESP32 → POST {url}/rest/v1/rpc/device_ingest  (URL + anon key only)
-- ------------------------------------------------------------------
create or replace function public.device_ingest(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token   text := payload ->> 'deviceToken';
  v_body    jsonb := payload -> 'telemetry';
  v_device  text;
  v_mission text;
  v_ts      bigint;
  v_now_ms  bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_body is null or v_token is null then
    raise exception 'payload must be {"deviceToken":"...", "telemetry":{...}}';
  end if;

  select device_id into v_device from public.device_tokens where token = v_token;
  if v_device is null then
    raise exception 'invalid device token';
  end if;

  -- no running mission? first telemetry creates one (plug-and-play)
  select id into v_mission from public.missions where status = 'running' order by started_at desc limit 1;
  if v_mission is null then
    v_mission := 'mis_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.missions (id, name, status, started_at, origin)
    values (v_mission, 'Field Mission', 'running', now(),
            jsonb_build_object('xM', 0, 'yM', 0, 'setAt', v_now_ms));
    insert into public.events (id, mission_id, ts, kind, level, text, snapshot)
    values ('evt_' || replace(gen_random_uuid()::text, '-', ''), v_mission, v_now_ms,
            'mission', 'success',
            'Mission auto-created on first telemetry — PAWS is online.',
            '{}'::jsonb);
  end if;

  v_ts := coalesce((v_body ->> 'ts')::bigint, v_now_ms);

  insert into public.telemetry (mission_id, device_id, ts, payload)
  values (v_mission, v_device, v_ts, v_body);

  return jsonb_build_object('ok', true, 'ts', v_ts, 'mission', v_mission);
end;
$$;

revoke all on function public.device_ingest(jsonb) from public;
grant execute on function public.device_ingest(jsonb) to anon, authenticated;

-- ------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
--    anon:         nothing (only device_ingest, which is security definer)
--    authenticated: read everything; write only if role = operator
-- ------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.missions       enable row level security;
alter table public.telemetry      enable row level security;
alter table public.mission_state  enable row level security;
alter table public.events         enable row level security;
alter table public.alerts         enable row level security;
alter table public.commands       enable row level security;
alter table public.detections     enable row level security;
alter table public.trail_points   enable row level security;
alter table public.scores         enable row level security;
alter table public.fusion_weights enable row level security;
alter table public.device_tokens  enable row level security;

-- profiles: users read their own
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- everything else: observers & operators read; ONLY operators write
do $$
declare t text;
begin
  foreach t in array array[
    'missions','telemetry','mission_state','events','alerts','commands',
    'detections','trail_points','scores','fusion_weights'
  ] loop
    execute format('drop policy if exists "read_all" on public.%I', t);
    execute format(
      'create policy "read_all" on public.%I for select to authenticated using (auth.role() = ''authenticated'')', t);
    execute format('drop policy if exists "write_operator" on public.%I', t);
    execute format(
      'create policy "write_operator" on public.%I for all to authenticated using (public.is_operator()) with check (public.is_operator())', t);
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 6. REALTIME  (console live updates; safe to re-run)
-- ------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.events;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.trail_points;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.telemetry;
  exception when duplicate_object then null; end;
end $$;

-- ------------------------------------------------------------------
-- 7. DEMO LOGIN ACCOUNTS  (skip if you already created these in
--    Authentication → Users — ON CONFLICT makes this a no-op)
-- ------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'operator@paws.local', crypt('paws-demo-operator', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"role":"operator","name":"Prabhjyot Singh Bhambra"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'observer@paws.local', crypt('paws-demo-observer', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"role":"observer","name":"Field Observer"}'::jsonb, now(), now())
on conflict (email) do nothing;

-- identities rows (required by Supabase Auth for password sign-in)
insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email),
       'email', u.id::text, now(), now(), now()
from auth.users u
where u.email in ('operator@paws.local', 'observer@paws.local')
  and not exists (
    select 1 from auth.identities i where i.provider = 'email' and i.provider_id = u.id::text
  )
on conflict do nothing;

-- backfill profiles (covers users created BEFORE the trigger existed)
insert into public.profiles (id, role, name)
select u.id,
       coalesce(u.raw_user_meta_data ->> 'role', 'observer'),
       u.raw_user_meta_data ->> 'name'
from auth.users u
where u.email in ('operator@paws.local', 'observer@paws.local')
on conflict (id) do update
  set role = excluded.role, name = excluded.name;

-- operator must be operator in BOTH auth (console UI) and profiles (RLS)
update auth.users
set raw_user_meta_data = jsonb_set(coalesce(raw_user_meta_data, '{}'::jsonb), '{role}', '"operator"')
where email = 'operator@paws.local';

update public.profiles p
set role = 'operator', name = 'Prabhjyot Singh Bhambra'
from auth.users u
where u.id = p.id and u.email = 'operator@paws.local';

-- ============================================================
-- DONE. Verify: Table Editor → all 11+ tables present with a
-- seeded fusion_weights row, and device_tokens has
-- 'paws-device-token'. The ESP32 can now write telemetry with
-- only {project URL + anon key}. 
-- ============================================================
