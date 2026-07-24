-- Expand private archive: baseline + experiment CD merge + raw uploads.
-- Run this in Supabase SQL Editor after 001_merge_artifacts.sql.

alter table public.merge_artifacts
  drop constraint if exists merge_artifacts_kind_check;

alter table public.merge_artifacts
  add constraint merge_artifacts_kind_check
  check (kind in ('experiment_cd', 'baseline_ab', 'raw'));

-- Anon may insert any private artifact kind (still no SELECT / download).
drop policy if exists "anon_insert_baseline" on public.merge_artifacts;
drop policy if exists "anon_insert_private_artifacts" on public.merge_artifacts;
create policy "anon_insert_private_artifacts"
  on public.merge_artifacts
  for insert
  to anon
  with check (
    kind in ('baseline_ab', 'experiment_cd', 'raw')
    and downloadable_on_web = false
  );

-- Storage: allow uploads under baseline/ | experiment/ | raw/
drop policy if exists "anon_upload_baseline" on storage.objects;
drop policy if exists "anon_upload_private_merge" on storage.objects;
create policy "anon_upload_private_merge"
  on storage.objects
  for insert
  to anon
  with check (
    bucket_id = 'merge-private'
    and (storage.foldername(name))[1] in ('baseline', 'experiment', 'raw')
  );
