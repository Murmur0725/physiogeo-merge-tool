-- Private merge archive: website may INSERT baseline rows, but cannot SELECT/download.
-- Researchers retrieve via Supabase Dashboard or service-role scripts.

create extension if not exists "pgcrypto";

create table if not exists public.merge_artifacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subject_id text not null,
  subject_name text not null default '',
  kind text not null check (kind in ('experiment_cd', 'baseline_ab')),
  window_label text,
  storage_path text not null,
  row_count integer,
  time_range text,
  metrics jsonb,
  downloadable_on_web boolean not null default false
);

create index if not exists merge_artifacts_subject_idx
  on public.merge_artifacts (subject_id, kind, created_at desc);

alter table public.merge_artifacts enable row level security;

-- Anon website clients can insert baseline artifacts only.
drop policy if exists "anon_insert_baseline" on public.merge_artifacts;
create policy "anon_insert_baseline"
  on public.merge_artifacts
  for insert
  to anon
  with check (
    kind = 'baseline_ab'
    and downloadable_on_web = false
  );

-- No SELECT policy for anon → website cannot list or download baseline.
-- Authenticated researchers (or service role) can read everything.
drop policy if exists "authenticated_read_artifacts" on public.merge_artifacts;
create policy "authenticated_read_artifacts"
  on public.merge_artifacts
  for select
  to authenticated
  using (true);

-- Private storage bucket (not publicly readable).
insert into storage.buckets (id, name, public)
values ('merge-private', 'merge-private', false)
on conflict (id) do update set public = false;

drop policy if exists "anon_upload_baseline" on storage.objects;
create policy "anon_upload_baseline"
  on storage.objects
  for insert
  to anon
  with check (
    bucket_id = 'merge-private'
    and (storage.foldername(name))[1] = 'baseline'
  );

-- Anon cannot read/download objects from the private bucket.
drop policy if exists "authenticated_read_private_merge" on storage.objects;
create policy "authenticated_read_private_merge"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'merge-private');
