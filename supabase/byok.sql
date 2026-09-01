-- BYOK (Bring Your Own Key): setiap user menyimpan Gemini API key sendiri.
-- Jalankan di SQL Editor setelah schema.sql utama.

create table if not exists public.user_settings (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  gemini_api_key text not null default '',
  updated_at   timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "Users manage their own settings" on public.user_settings;
create policy "Users manage their own settings"
  on public.user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch
  before update on public.user_settings
  for each row execute function public.touch_updated_at();
