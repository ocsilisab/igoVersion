-- Go (Igo) — online mode schema
--
-- Run this once in the Supabase project's SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE / DROP+CREATE).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------
-- The server (Vercel API routes, using the service-role key) is the only writer.
-- The browser client only ever reads this table directly, via Supabase Realtime,
-- to receive live updates — it can never mutate a row itself (see RLS below).

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  -- Optimistic-concurrency guard: every mutation does
  -- `update games set ... , version = version + 1 where id = :id and version = :expected`
  -- so two near-simultaneous requests can never silently clobber each other.
  version integer not null default 0,

  board_size smallint not null,
  board jsonb not null,
  current_player text not null check (current_player in ('black', 'white')),
  black_captures integer not null default 0,
  white_captures integer not null default 0,
  consecutive_passes integer not null default 0,
  -- Serialized board states, one per move (Ko rule) — same shape as the local game's history.
  history jsonb not null default '[]'::jsonb,
  is_scoring boolean not null default false,
  -- Array of "row,col" posKeys currently marked dead during the scoring phase.
  dead_stones jsonb not null default '[]'::jsonb,
  last_move jsonb,

  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished', 'abandoned')),
  winner text check (winner in ('black', 'white', 'draw')),
  score jsonb,

  black_player_id text not null,
  white_player_id text,
  black_name text not null,
  white_name text,
  abandoned_by text check (abandoned_by in ('black', 'white')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only meaningful while status = 'waiting'; a game past this point with no
  -- second player can no longer be joined and is treated as expired.
  expires_at timestamptz not null default (now() + interval '20 minutes')
);

create unique index if not exists games_code_key on games (code);
create index if not exists games_status_idx on games (status);

alter table games enable row level security;

drop policy if exists "Public read access" on games;
create policy "Public read access" on games
  for select
  using (true);

-- Intentionally no insert/update/delete policy for anon/authenticated roles:
-- only the service-role key (used exclusively by the /api serverless functions)
-- can write, since the service role bypasses RLS entirely. This is what makes
-- the server the sole source of truth for game state.

-- Realtime: broadcast row changes so both browsers see moves live.
-- (ALTER PUBLICATION ... ADD TABLE has no built-in IF NOT EXISTS, so this is
-- wrapped to stay re-runnable like the rest of the script.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table games;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- rate_limit_hits
-- ---------------------------------------------------------------------------
-- Minimal, best-effort request throttling (not an anti-cheat system). One row
-- per request attempt; ip is stored HMAC-hashed (never in plain text) using
-- AUTH_SECRET. Old rows are opportunistically deleted by the API itself.

create table if not exists rate_limit_hits (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_hits_lookup on rate_limit_hits (ip_hash, action, created_at);

alter table rate_limit_hits enable row level security;
-- No policies at all: only the service role touches this table.
