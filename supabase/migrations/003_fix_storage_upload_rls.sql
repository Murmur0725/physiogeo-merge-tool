-- Fix Storage RLS so website can upload under experiment/ baseline/ raw/
-- (path checks use name LIKE — more reliable than storage.foldername)
-- Run in Supabase SQL Editor.

-- Drop old / partial policies
drop policy if exists "anon_upload_baseline" on storage.objects;
drop policy if exists "anon_upload_private_merge" on storage.objects;
drop policy if exists "anon_update_private_merge" on storage.objects;
drop policy if exists "authenticated_upload_private_merge" on storage.objects;
drop policy if exists "authenticated_update_private_merge" on storage.objects;

-- INSERT: allow anon + authenticated to upload into the three folders
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
    )
  );

-- UPDATE: needed when client uses upsert:true to overwrite same path
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
    )
  )
  with check (
    bucket_id = 'merge-private'
    and (
      name like 'baseline/%'
      or name like 'experiment/%'
      or name like 'raw/%'
    )
  );

-- Keep SELECT blocked for anon (no website download from Storage).
-- authenticated_read_private_merge from 001 still allows logged-in dashboard users.
