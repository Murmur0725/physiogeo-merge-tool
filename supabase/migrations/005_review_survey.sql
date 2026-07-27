-- Review survey archive: sessions, segments, street points, survey responses.
-- Anon may INSERT only (no SELECT) so the website cannot list/download.
-- Run in Supabase SQL Editor after 001–004.

create extension if not exists "pgcrypto";

-- ---------- Tables ----------

create table if not exists public.review_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subject_id text not null,
  subject_name text not null default '',
  route_config_id text not null,
  route_name text,
  instrument_id text not null
);

create index if not exists review_sessions_subject_idx
  on public.review_sessions (subject_id, created_at desc);

create table if not exists public.review_segments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id uuid not null references public.review_sessions (id) on delete cascade,
  segment_key text not null,
  label text not null,
  sort_order integer not null default 0,
  geometry jsonb not null default '[]'::jsonb,
  start_waypoint_id text,
  end_waypoint_id text
);

create index if not exists review_segments_session_idx
  on public.review_segments (session_id, sort_order);

create table if not exists public.segment_street_points (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  segment_id uuid not null references public.review_segments (id) on delete cascade,
  point_key text not null,
  lng double precision not null,
  lat double precision not null,
  progress double precision,
  label text,
  mapillary_image_id text,
  sort_order integer not null default 0
);

create index if not exists segment_street_points_segment_idx
  on public.segment_street_points (segment_id, sort_order);

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id uuid not null references public.review_sessions (id) on delete cascade,
  segment_id uuid not null references public.review_segments (id) on delete cascade,
  instrument_id text not null,
  answers jsonb not null default '{}'::jsonb,
  scores jsonb
);

create index if not exists survey_responses_session_idx
  on public.survey_responses (session_id, created_at desc);

-- ---------- RLS: anon insert-only ----------

alter table public.review_sessions enable row level security;
alter table public.review_segments enable row level security;
alter table public.segment_street_points enable row level security;
alter table public.survey_responses enable row level security;

drop policy if exists "anon_insert_review_sessions" on public.review_sessions;
create policy "anon_insert_review_sessions"
  on public.review_sessions
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "anon_insert_review_segments" on public.review_segments;
create policy "anon_insert_review_segments"
  on public.review_segments
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "anon_insert_segment_street_points" on public.segment_street_points;
create policy "anon_insert_segment_street_points"
  on public.segment_street_points
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "anon_insert_survey_responses" on public.survey_responses;
create policy "anon_insert_survey_responses"
  on public.survey_responses
  for insert
  to anon, authenticated
  with check (true);

-- Authenticated researchers can read (Dashboard / service tooling).
drop policy if exists "authenticated_read_review_sessions" on public.review_sessions;
create policy "authenticated_read_review_sessions"
  on public.review_sessions for select to authenticated using (true);

drop policy if exists "authenticated_read_review_segments" on public.review_segments;
create policy "authenticated_read_review_segments"
  on public.review_segments for select to authenticated using (true);

drop policy if exists "authenticated_read_segment_street_points" on public.segment_street_points;
create policy "authenticated_read_segment_street_points"
  on public.segment_street_points for select to authenticated using (true);

drop policy if exists "authenticated_read_survey_responses" on public.survey_responses;
create policy "authenticated_read_survey_responses"
  on public.survey_responses for select to authenticated using (true);

-- ---------- Storage: allow review/% snapshots (still no anon SELECT) ----------

drop policy if exists "anon_upload_private_merge" on storage.objects;
create policy "anon_upload_private_merge"
  on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'merge-private'
    and (
      name like 'baseline/%'
      or name like 'experiment/%'
      or name like 'raw/%'
      or name like 'review/%'
    )
  );

drop policy if exists "anon_update_private_merge" on storage.objects;
create policy "anon_update_private_merge"
  on storage.objects
  for update
  to anon, authenticated
  using (
    bucket_id = 'merge-private'
    and (
      name like 'baseline/%'
      or name like 'experiment/%'
      or name like 'raw/%'
      or name like 'review/%'
    )
  )
  with check (
    bucket_id = 'merge-private'
    and (
      name like 'baseline/%'
      or name like 'experiment/%'
      or name like 'raw/%'
      or name like 'review/%'
    )
  );

drop policy if exists "anon_delete_private_merge" on storage.objects;
create policy "anon_delete_private_merge"
  on storage.objects
  for delete
  to anon, authenticated
  using (
    bucket_id = 'merge-private'
    and (
      name like 'baseline/%'
      or name like 'experiment/%'
      or name like 'raw/%'
      or name like 'review/%'
    )
  );
