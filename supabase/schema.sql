-- Go (Igo) — online mode schema
--
-- Run this once in the Supabase project's SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE / DROP+CREATE).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------
-- The server (Vercel API routes, using the service-role key) is the only writer.
-- The browser client only ever reads this table (and game_players below) directly,
-- via Supabase Realtime, to receive live updates — it can never mutate a row itself
-- (see RLS below). Per-player identity/roster lives in game_players, not here — a
-- game can have 2 to 6 players split across the two colors (teams).

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  -- Optimistic-concurrency guard: every mutation does
  -- `update games set ... , version = version + 1 where id = :id and version = :expected`
  -- so two near-simultaneous requests can never silently clobber each other.
  version integer not null default 0,

  board_size smallint not null,
  -- Compensation points awarded to White at scoring time (see types/game.ts::KOMI_OPTIONS).
  komi numeric(4,1) not null default 6.5,
  board jsonb not null,
  current_player text not null check (current_player in ('black', 'white')),
  -- Rotation position within each color's team — see src/online/turns.ts::getActivePlayer.
  -- Advances (mod that team's active player count) every time that color moves or passes.
  black_turn_index integer not null default 0,
  white_turn_index integer not null default 0,
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
  -- Set when a whole team's last active member leaves mid-game.
  abandoned_team text check (abandoned_team in ('black', 'white')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only meaningful while status = 'waiting'; a game past this point that never
  -- started can no longer be joined and is treated as expired.
  expires_at timestamptz not null default (now() + interval '20 minutes')
);

-- Migration for a `games` table created before team play existed: drops the old
-- fixed two-player columns (superseded by game_players below) and adds the new
-- rotation/abandon columns. Safe no-ops if already applied.
alter table games drop column if exists black_player_id;
alter table games drop column if exists white_player_id;
alter table games drop column if exists black_name;
alter table games drop column if exists white_name;
alter table games drop column if exists abandoned_by;
alter table games add column if not exists black_turn_index integer not null default 0;
alter table games add column if not exists white_turn_index integer not null default 0;
alter table games add column if not exists abandoned_team text check (abandoned_team in ('black', 'white'));
alter table games add column if not exists komi numeric(4,1) not null default 6.5;

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

-- Realtime: broadcast row changes so all browsers see moves/roster changes live.
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
-- game_players
-- ---------------------------------------------------------------------------
-- One row per person who has ever joined a game (2 to 6 per game): which team
-- (color) they're on, their rotation position within that team, and whether
-- they've left (soft-deleted via left_at rather than removed, so turn rotation
-- and the roster shown to other players stay stable/auditable). The client never
-- writes here directly — every mutation goes through api/_lib/gameRepo.ts, which
-- also touches the parent `games` row so Realtime (subscribed to `games` only)
-- fires and everyone refetches the full roster along with the board.

create table if not exists game_players (
  id bigint generated always as identity primary key,
  game_id uuid not null references games(id) on delete cascade,
  guest_id text not null,
  display_name text not null,
  team text not null check (team in ('black', 'white')),
  -- Join order within the team (0-based) — determines turn rotation order.
  turn_order integer not null,
  -- The player who created the game; only they can start it once ≥1 person has
  -- joined each team.
  is_creator boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz
);

create index if not exists game_players_game_idx on game_players (game_id);
create unique index if not exists game_players_unique_guest on game_players (game_id, guest_id);

alter table game_players enable row level security;

drop policy if exists "Public read access" on game_players;
create policy "Public read access" on game_players
  for select
  using (true);

-- No insert/update/delete policy: only the service role writes here, same as games.

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
