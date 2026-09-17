-- PitchKu — perbaikan profiles yang tidak terbuat
-- Jalankan di Supabase: SQL Editor > New query > tempel > Run
--
-- GEJALA
--   Simpan proyek gagal dengan:
--     23503 insert or update on table "projects" violates foreign key
--     constraint "projects_user_id_fkey" - Key is not present in table "profiles"
--
-- PENYEBAB
--   projects.user_id menunjuk ke profiles.id, bukan langsung ke auth.users.
--   Row profiles hanya dibuat oleh trigger on_auth_user_created, dan trigger
--   hanya jalan untuk pendaftaran SETELAH trigger itu ada. Akun yang dibuat
--   sebelum 001_init.sql dijalankan (misalnya akun tes lewat Authentication >
--   Users > Add user) tidak pernah punya profil.
--
--   001_init.sql tidak bisa dijalankan ulang untuk memperbaikinya - create
--   table dan create trigger di sana gagal kalau objeknya sudah ada. Berkas
--   ini aman dijalankan berkali-kali.

-- ============================================================
-- 1. Fungsi trigger
-- ============================================================
-- Sama dengan versi di 001_init.sql, ditambah on conflict do nothing.
-- Tanpa itu, kalau row profil kebetulan sudah ada, pendaftaran pengguna
-- ikut gagal dengan "Database error saving new user".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, company_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    nullif(trim(new.raw_user_meta_data->>'company_name'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ============================================================
-- 2. Trigger
-- ============================================================
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 3. Backfill akun lama yang belum punya profil
-- ============================================================
insert into public.profiles (id, full_name, company_name)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
  nullif(trim(u.raw_user_meta_data->>'company_name'), '')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- ============================================================
-- 4. Cek hasilnya
-- ============================================================
-- Baris terakhir yang tampil di hasil Run. Keduanya harus benar:
--   trigger_aktif      = true
--   user_tanpa_profil  = 0
select
  exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created'
      and tgrelid = 'auth.users'::regclass
      and tgenabled <> 'D'
  ) as trigger_aktif,
  (select count(*) from auth.users u
   where not exists (select 1 from public.profiles p where p.id = u.id)
  ) as user_tanpa_profil;
