-- Campaign Binder — MCP server support
--
-- Two writers now touch scenario_overlay: the app (whole-blob pushes) and the
-- local MCP server (Claude, patching one top-level key at a time). This adds:
--   • compare-and-swap writes so neither silently clobbers the other
--     (a stale write fails with SQLSTATE PT409, which PostgREST returns as 409)
--   • an undo trail for Claude's writes
--   • realtime on scenario_overlay so an open binder tab sees Claude's edits
--   • binder_view: what the app is showing, so Claude can act on "this page"
--
-- Apply in the Supabase SQL editor. Safe to re-run.

-- updated_at is the CAS token. clock_timestamp() (not now(), which is the
-- transaction start) keeps it moving forward even when writers queue on a lock.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = clock_timestamp(); return new; end; $$;

-- Undo trail for MCP writes only. App pushes are not recorded: they happen
-- every couple of seconds while typing and would flush Claude's entries out.
create table if not exists public.overlay_history (
  id          bigserial primary key,
  scenario_id text not null references public.scenario(scenario_id) on delete cascade,
  source      text not null,                 -- 'mcp' | 'mcp-undo'
  summary     text,                          -- what the write did, for undo messages
  before      jsonb not null,                -- overlay before the write
  patch       jsonb not null,                -- top-level keys the write replaced
  created_at  timestamptz not null default clock_timestamp()
);
create index if not exists overlay_history_scenario_idx
  on public.overlay_history (scenario_id, id desc);

-- Patch top-level keys of an overlay (overlay || p_patch), MCP side.
-- p_expected: the updated_at the caller read; null means "I saw no row".
create or replace function public.patch_overlay(
  p_scenario_id text,
  p_patch       jsonb,
  p_expected    timestamptz default null,
  p_source      text default 'mcp',
  p_summary     text default null
) returns timestamptz language plpgsql as $$
declare
  cur public.scenario_overlay%rowtype;
  ts  timestamptz;
begin
  select * into cur from public.scenario_overlay
    where scenario_id = p_scenario_id for update;

  if not found then
    if p_expected is not null then
      raise exception 'overlay changed (row missing)' using errcode = 'PT409';
    end if;
    insert into public.scenario_overlay (scenario_id, overlay, schema_version, updated_at)
      values (p_scenario_id, p_patch, 3, clock_timestamp())
      returning updated_at into ts;
    insert into public.overlay_history (scenario_id, source, summary, before, patch)
      values (p_scenario_id, p_source, p_summary, '{}'::jsonb, p_patch);
    return ts;
  end if;

  if p_expected is null or cur.updated_at <> p_expected then
    raise exception 'overlay changed since it was read' using errcode = 'PT409';
  end if;

  insert into public.overlay_history (scenario_id, source, summary, before, patch)
    values (p_scenario_id, p_source, p_summary, cur.overlay, p_patch);

  update public.scenario_overlay
    set overlay = cur.overlay || p_patch
    where scenario_id = p_scenario_id
    returning updated_at into ts;

  -- keep the last 50 history rows per scenario
  delete from public.overlay_history h
    where h.scenario_id = p_scenario_id
      and h.id not in (select id from public.overlay_history
                       where scenario_id = p_scenario_id
                       order by id desc limit 50);
  return ts;
end; $$;

-- Replace a whole overlay, app side. Fails with PT409 unless the caller has
-- seen the current version, so the app must fetch + merge first.
create or replace function public.put_overlay(
  p_scenario_id    text,
  p_overlay        jsonb,
  p_expected       timestamptz default null,
  p_schema_version integer default 3
) returns timestamptz language plpgsql as $$
declare
  cur public.scenario_overlay%rowtype;
  ts  timestamptz;
begin
  select * into cur from public.scenario_overlay
    where scenario_id = p_scenario_id for update;

  if not found then
    if p_expected is not null then
      raise exception 'overlay changed (row missing)' using errcode = 'PT409';
    end if;
    insert into public.scenario_overlay (scenario_id, overlay, schema_version, updated_at)
      values (p_scenario_id, p_overlay, p_schema_version, clock_timestamp())
      returning updated_at into ts;
    return ts;
  end if;

  if p_expected is null or cur.updated_at <> p_expected then
    raise exception 'overlay changed since it was read' using errcode = 'PT409';
  end if;

  update public.scenario_overlay
    set overlay = p_overlay, schema_version = p_schema_version
    where scenario_id = p_scenario_id
    returning updated_at into ts;
  return ts;
end; $$;

-- What the binder is showing right now (single row), so Claude can resolve
-- "the page I'm on". Written by the app, read by the MCP server.
create table if not exists public.binder_view (
  id          integer primary key default 1,
  scenario_id text,
  tab         text,        -- top-level workspace tab (scenario, npcs, gmnotes, …)
  section_id  text,        -- scenario content section on screen
  gm_page_id  text,        -- GM notes page on screen
  updated_at  timestamptz not null default now()
);
insert into public.binder_view (id) values (1) on conflict do nothing;

drop trigger if exists binder_view_touch on public.binder_view;
create trigger binder_view_touch before update on public.binder_view
  for each row execute function public.touch_updated_at();

-- RLS: same intentionally-open model as the other tables (solo use, anon key).
alter table public.overlay_history enable row level security;
alter table public.binder_view     enable row level security;
drop policy if exists anon_all_overlay_history on public.overlay_history;
drop policy if exists anon_all_binder_view     on public.binder_view;
create policy anon_all_overlay_history on public.overlay_history for all to anon using (true) with check (true);
create policy anon_all_binder_view     on public.binder_view     for all to anon using (true) with check (true);

grant select, insert, update, delete on public.overlay_history, public.binder_view to anon;
grant usage, select on sequence public.overlay_history_id_seq to anon;
grant execute on function public.patch_overlay(text, jsonb, timestamptz, text, text) to anon;
grant execute on function public.put_overlay(text, jsonb, timestamptz, integer) to anon;

-- Realtime: let the app subscribe to overlay changes.
do $$ begin
  alter publication supabase_realtime add table public.scenario_overlay;
exception when duplicate_object then null; end $$;
