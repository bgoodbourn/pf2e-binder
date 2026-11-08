-- Campaign Binder — co-GM chat
--
-- A small append-only message log per scenario, so two GMs on two computers
-- can pass notes during a session. Kept out of scenario_overlay on purpose:
-- messages never go through the overlay's compare-and-swap merge.
--
-- Only today's messages matter. The app shows messages from local midnight
-- onward, and each insert prunes anything older than two days, so the table
-- never grows past a couple of sessions' worth of rows.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),  -- the app sends its own id
  scenario_id text not null,                 -- no FK: a scenario may not have reached the server yet
  author_id   text not null,                 -- random per-device id, tells "mine" apart
  author_name text not null check (char_length(author_name) between 1 and 40),
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists chat_messages_scenario_idx
  on public.chat_messages (scenario_id, created_at);

-- Prune old messages on each insert. Statement-level, so a batch insert prunes
-- once. security definer because anon has no delete policy on this table.
create or replace function public.prune_chat_messages()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.chat_messages where created_at < now() - interval '2 days';
  return null;
end; $$;

drop trigger if exists chat_messages_prune on public.chat_messages;
create trigger chat_messages_prune after insert on public.chat_messages
  for each statement execute function public.prune_chat_messages();

-- RLS: same intentionally-open model as the other tables (anon key, no auth).
-- The app only reads and inserts; the prune trigger does the deleting.
alter table public.chat_messages enable row level security;
drop policy if exists anon_select_chat on public.chat_messages;
drop policy if exists anon_insert_chat on public.chat_messages;
create policy anon_select_chat on public.chat_messages for select to anon using (true);
create policy anon_insert_chat on public.chat_messages for insert to anon with check (true);
grant select, insert on public.chat_messages to anon;

-- Realtime: the app subscribes to inserts for the open scenario.
do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; end $$;
