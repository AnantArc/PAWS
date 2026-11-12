-- ============================================================
-- PAWS — CAMERA VISION (YOLO) WRITES · v2  ·  one paste, safe to re-run
-- SIH 2026  ·  PS 26223
-- ============================================================
-- The friend's detector (detect_human.py on the laptop) reads the
-- ESP32-CAM MJPEG stream, runs YOLO person-only, and POSTs rows into
-- the EXISTING public.detections table with exactly:
--     { "label": "person" | "none", "confidence": 0.87, "ts": "<ISO-8601>" }
-- every state change + a heartbeat every 15 s (newest row = current state).
--
-- This block adapts the table so those EXACT writes work with ZERO
-- changes to the detector: it accepts the ISO-8601 ts string, auto-fills
-- id / bbox / device_id, grants anon INSERT + SELECT (PostgREST returns
-- the inserted row unless Prefer: return=minimal), drops-and-recreates
-- the RLS policies idempotently, and adds detections to Realtime so the
-- console is pushed the instant a person is seen.
--
-- WHAT THE FRIEND RUNS (nothing else — no code change needed):
--   python detect_human.py        (after pip install -r requirements.txt)
--   .env:  ROBOT_EYES_CAMERA_URL=...  SUPABASE_URL  SUPABASE_KEY
--          SUPABASE_TABLE=detections  HUMAN_LABEL=person
--          NO_HUMAN_LABEL=none  HEARTBEAT_SEC=15
--
-- LABEL CONTRACT (what the UI will treat as "human detected"):
--   positive: 'person'  (any of: person / human)
--   negative: 'none'    (any of: none / nobody / no person / clear)
-- ============================================================

-- ---------- 0. ts: accept the detector's ISO-8601 string -------------
-- (idempotent: only converts while the column is still bigint, and
--  migrates any existing epoch-ms rows correctly)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'detections'
      and column_name = 'ts' and data_type = 'bigint'
  ) then
    alter table public.detections
      alter column ts type timestamptz using to_timestamp(ts / 1000.0);
  end if;
end $$;
alter table public.detections alter column ts set default now();

-- ---------- 1. id + friendly defaults (detector never sends them) ----
alter table public.detections alter column id set default gen_random_uuid()::text;
alter table public.detections alter column bbox set default '{}'::jsonb;

-- camera bookkeeping columns (idempotent)
alter table public.detections add column if not exists device_id text default 'paws-cam';

-- cleanup from earlier draft (if this was ever run before)
alter table public.detections drop column if exists captured_at;

-- ---------- 2. anon permissions --------------------------------------
grant usage on schema public to anon;
grant insert, select on public.detections to anon;

-- ---------- 3. RLS: detector inserts, and PostgREST reads back -------
drop policy if exists "detections_allow_insert" on public.detections;
create policy "detections_allow_insert" on public.detections
  for insert to anon with check (true);

drop policy if exists "detections_read_anon" on public.detections;
create policy "detections_read_anon" on public.detections
  for select to anon using (true);

-- ---------- 4. Realtime push to the console --------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.detections;
  exception when duplicate_object then null; end;
end $$;

notify pgrst, 'reload schema';
