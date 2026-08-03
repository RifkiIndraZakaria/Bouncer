-- =====================================================
-- Paddle Bounce Idle — Supabase schema
-- Jalankan seluruh isi file ini di Supabase Dashboard:
-- Project > SQL Editor > New query > paste > Run
-- =====================================================

-- Tabel profil, menyimpan nama pemain yang terhubung ke akun anonim
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (char_length(username) between 3 and 20),
  created_at timestamptz not null default now()
);

-- Tabel save game (data lengkap progres, privat per pemain)
create table if not exists public.saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Tabel leaderboard (hanya skor ringkas, dapat dibaca publik)
create table if not exists public.leaderboard (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  score bigint not null default 0,
  level int not null default 1,
  updated_at timestamptz not null default now()
);

-- Aktifkan Row Level Security di semua tabel
alter table public.profiles enable row level security;
alter table public.saves enable row level security;
alter table public.leaderboard enable row level security;

-- profiles: setiap user hanya boleh baca/tulis barisnya sendiri
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

-- saves: setiap user hanya boleh baca/tulis save miliknya sendiri
drop policy if exists "saves: read own" on public.saves;
create policy "saves: read own" on public.saves
  for select using (auth.uid() = user_id);

drop policy if exists "saves: insert own" on public.saves;
create policy "saves: insert own" on public.saves
  for insert with check (auth.uid() = user_id);

drop policy if exists "saves: update own" on public.saves;
create policy "saves: update own" on public.saves
  for update using (auth.uid() = user_id);

-- leaderboard: SEMUA orang boleh membaca (untuk ditampilkan di game),
-- tapi hanya pemilik baris yang boleh menulis/mengubah skornya sendiri
drop policy if exists "leaderboard: public read" on public.leaderboard;
create policy "leaderboard: public read" on public.leaderboard
  for select using (true);

drop policy if exists "leaderboard: insert own" on public.leaderboard;
create policy "leaderboard: insert own" on public.leaderboard
  for insert with check (auth.uid() = user_id);

drop policy if exists "leaderboard: update own" on public.leaderboard;
create policy "leaderboard: update own" on public.leaderboard
  for update using (auth.uid() = user_id);

-- Index untuk mempercepat query "top N leaderboard"
create index if not exists leaderboard_score_idx
  on public.leaderboard (score desc);
