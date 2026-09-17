-- PitchKu — status proyek mengikuti frontend
-- Jalankan di Supabase: SQL Editor > New query > tempel > Run
-- Aman dijalankan berkali-kali.
--
-- GEJALA
--   Menandai proyek "Selesai" di dashboard atau editor tidak pernah tersimpan.
--   Setelah refresh atau pindah perangkat, statusnya kembali draft.
--
-- PENYEBAB
--   Frontend memakai status 'draft' | 'selesai' dan meng-upsert tabel projects
--   langsung. Check constraint dari 001 hanya menerima 'draft' | 'completed',
--   jadi seluruh upsert ditolak - termasuk judul dan updated_at di baris itu.

-- ============================================================
-- 1. Status 'selesai'
-- ============================================================
-- Constraint lama dilepas dulu. Selama masih terpasang, 'selesai' ditolak
-- dan update di bawahnya gagal.
alter table public.projects drop constraint if exists projects_status_check;

update public.projects set status = 'selesai' where status = 'completed';

alter table public.projects
  add constraint projects_status_check check (status in ('draft', 'selesai'));

-- ============================================================
-- 2. Riwayat migrasi untuk integrasi GitHub Supabase
-- ============================================================
-- 001 dan 002 dijalankan manual lewat SQL Editor, jadi integrasi GitHub
-- tidak tahu keduanya sudah jalan. Setiap push ke master ia mencoba 001 lagi
-- dan gagal dengan: relation "profiles" already exists.
--
-- Bentuk tabel di bawah sama dengan yang dibuat Supabase CLI, dan semua
-- perintahnya "if not exists" / "on conflict do nothing", jadi tidak
-- bentrok kalau berkas ini dijalankan oleh integrasi itu sendiri.
create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key
);
alter table supabase_migrations.schema_migrations
  add column if not exists statements text[];
alter table supabase_migrations.schema_migrations
  add column if not exists name text;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('001', 'init', '{}'), ('002', 'fix_profiles', '{}')
on conflict (version) do nothing;
