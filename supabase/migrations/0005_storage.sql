-- =====================================================================
-- Миграция 0005: хранилище файлов (замена base44 Core.UploadFile).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portal-files',
  'portal-files',
  true,
  26214400, -- 25 МБ
  array[
    'image/png','image/jpeg','image/webp','image/svg+xml','image/gif',
    'application/pdf',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/csv','application/zip','application/x-zip-compressed'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Загружать может только вошедший пользователь и только в свою папку.
drop policy if exists portal_files_insert on storage.objects;
create policy portal_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'portal-files'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists portal_files_select on storage.objects;
create policy portal_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'portal-files');

drop policy if exists portal_files_delete on storage.objects;
create policy portal_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'portal-files'
    and ((storage.foldername(name))[2] = auth.uid()::text or is_hr())
  );
