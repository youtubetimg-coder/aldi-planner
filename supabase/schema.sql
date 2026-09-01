-- Aldi Planner — Supabase schema
-- Jalankan di: Supabase Dashboard → SQL Editor → New query → paste → Run

-- ─── Tables ────────────────────────────────────────────────────────────────

create table if not exists public.campuses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  city          text not null default '',
  planner_status text not null default 'idle'
                check (planner_status in ('idle', 'processing', 'completed', 'failed')),
  source_file   text,
  created_at    timestamptz not null default now()
);

create table if not exists public.planners (
  id               uuid primary key default gen_random_uuid(),
  campus_id        uuid not null references public.campuses (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  status           text not null default 'processing'
                   check (status in ('processing', 'completed', 'failed')),
  source_file      text,
  academic_events  jsonb not null default '[]'::jsonb,
  training_modules jsonb not null default '[]'::jsonb,
  error_message    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  gemini_api_key   text not null default '',
  updated_at       timestamptz not null default now()
);

-- Satu planner "current" per kampus
create unique index if not exists planners_campus_current_idx on public.planners (campus_id);
create index if not exists campuses_user_idx on public.campuses (user_id);

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table public.campuses enable row level security;
alter table public.planners enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "Users manage their own campuses" on public.campuses;
create policy "Users manage their own campuses"
  on public.campuses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their own planners" on public.planners;
create policy "Users manage their own planners"
  on public.planners for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their own settings" on public.user_settings;
create policy "Users manage their own settings"
  on public.user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Storage ────────────────────────────────────────────────────────────────
-- Buat bucket "calendars" (private) lalu batasi per-user folder.

insert into storage.buckets (id, name, public)
values ('calendars', 'calendars', false)
on conflict (id) do nothing;

-- Path konvensi: calendars/{user_id}/{campus_id}/{timestamp}-{filename}
drop policy if exists "Users upload into their own folder" on storage.objects;
create policy "Users upload into their own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'calendars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users read their own files" on storage.objects;
create policy "Users read their own files"
  on storage.objects for select
  using (
    bucket_id = 'calendars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete their own files" on storage.objects;
create policy "Users delete their own files"
  on storage.objects for delete
  using (
    bucket_id = 'calendars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── updated_at trigger ─────────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists planners_touch on public.planners;
create trigger planners_touch
  before update on public.planners
  for each row execute function public.touch_updated_at();

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch
  before update on public.user_settings
  for each row execute function public.touch_updated_at();
