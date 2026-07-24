-- Allow anon to replace archived files without upsert (upsert needs SELECT).
-- Run in Supabase SQL Editor after 003.

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
    )
  );
