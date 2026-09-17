-- PitchKu — skema awal
-- Jalankan di Supabase: SQL Editor > New query > tempel > Run

-- ============================================================
-- 1. Profil pengguna (sinkron dengan auth.users)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  company_name text,
  created_at timestamptz not null default timezone('utc', now())
);

-- Profil dibuat otomatis saat pengguna mendaftar, termasuk via Google OAuth.
--
-- raw_user_meta_data diisi frontend lewat signUp({ options: { data: {...} } }).
-- Untuk pendaftaran email/password, kirim full_name dan company_name di sana;
-- tanpa itu kolomnya null dan pengguna harus melengkapinya di halaman pengaturan.
-- Google OAuth tidak pernah mengirim company_name - Google tidak tahu nama
-- usaha seseorang - jadi kolom itu memang null sampai pengguna mengisi sendiri.
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
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. Brand kit
-- ============================================================
create table public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  logo_url text,
  primary_color varchar(7) not null default '#0F4C81',
  accent_color varchar(7) not null default '#F2A007',
  font_family varchar(50) not null default 'Inter',
  updated_at timestamptz not null default timezone('utc', now()),

  -- PENTING: FRD menyebut "brand kit yang aktif" tapi tidak menyediakan
  -- penanda mana yang aktif. Dibatasi satu baris per pengguna supaya
  -- tidak ada kebingungan, dan supaya upsert onConflict bisa jalan.
  constraint brand_kits_one_per_user unique (user_id),

  constraint primary_color_hex check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint accent_color_hex check (accent_color ~ '^#[0-9A-Fa-f]{6}$')
);

-- ============================================================
-- 3. Proyek
-- ============================================================
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title varchar(150) not null,
  template_type varchar(50) not null
    check (template_type in ('company_profile','penawaran_produk','proposal_kerjasama','laporan_ringkas')),
  status varchar(20) not null default 'draft'
    check (status in ('draft','completed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index projects_user_updated_idx on public.projects (user_id, updated_at desc);

-- ============================================================
-- 4. Versi deck (snapshot JSON slide)
-- ============================================================
create table public.deck_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_number int not null default 1,

  -- Bentuknya { brandKit: {...}, slides: [...] }
  -- Brand kit disimpan di dalam snapshot supaya deck lama tidak berubah
  -- tampilan waktu pengguna mengganti warna merek bulan depan.
  slides_json jsonb not null,

  created_at timestamptz not null default timezone('utc', now()),
  constraint deck_versions_unique_version unique (project_id, version_number)
);

create index deck_versions_latest_idx
  on public.deck_versions (project_id, version_number desc);

-- ============================================================
-- 5. Log generasi (SLA & biaya token)
-- ============================================================
create table public.generation_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  stage varchar(20) not null check (stage in ('diagnose','outline','content')),
  model_name varchar(50) not null,
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  duration_ms int not null,
  estimated_cost_usd numeric(10,6) not null default 0.0,
  status varchar(20) not null check (status in ('success','retry','failed')),
  error_message text,
  created_at timestamptz not null default timezone('utc', now())
);

-- ============================================================
-- 6. Row Level Security (NFR-S01)
-- ============================================================
alter table public.profiles       enable row level security;
alter table public.brand_kits     enable row level security;
alter table public.projects       enable row level security;
alter table public.deck_versions  enable row level security;
alter table public.generation_logs enable row level security;

create policy "profil sendiri" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "brand kit sendiri" on public.brand_kits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "proyek sendiri" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Versi deck diakses lewat kepemilikan proyeknya.
create policy "versi deck sendiri" on public.deck_versions
  for all
  using (exists (
    select 1 from public.projects p
    where p.id = deck_versions.project_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = deck_versions.project_id and p.user_id = auth.uid()
  ));

-- Log hanya bisa dibaca pemilik proyek. Penulisan lewat service role key
-- di backend, yang melewati RLS.
create policy "baca log sendiri" on public.generation_logs
  for select
  using (
    project_id is null
    or exists (
      select 1 from public.projects p
      where p.id = generation_logs.project_id and p.user_id = auth.uid()
    )
  );

-- ============================================================
-- 7. Storage untuk logo
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152,
        array['image/png','image/jpeg','image/svg+xml'])
on conflict (id) do nothing;

create policy "unggah logo sendiri" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "ubah logo sendiri" on storage.objects
  for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "hapus logo sendiri" on storage.objects
  for delete to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "logo bisa dilihat publik" on storage.objects
  for select using (bucket_id = 'logos');
