-- Go (Igo) — online mode schema
--
-- Run this once in the Supabase project's SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE / DROP+CREATE).
--
-- Last change: 2026-08-26 — added check_and_record_rate_limit() and
-- dead_stones_confirmed_teams. There's no migration tooling here, so this file is the
-- only record of what production should look like: bump this date whenever you add a
-- statement below, and re-run the whole file in the SQL editor after pulling a change
-- to it -- there is no automatic way to tell a deployed database's schema is behind.

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
  -- Total seats the creator chose at setup (2 to 6) — exactly this many game_players
  -- rows get pre-created (see gameRepo.ts::createGame), each with its team already
  -- decided so the setup screen's team-split preview always matches reality.
  max_players smallint not null default 2 check (max_players between 2 and 6),
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
  -- Which teams ('black'/'white') have confirmed the *current* dead_stones as correct.
  -- Reset to '[]' every time dead_stones itself changes (see mark-dead.ts) -- finalize.ts
  -- requires both teams present here before it will accept a result, so one player can
  -- no longer mark the opponent's live groups dead and immediately lock in the score
  -- before the opponent gets a chance to object.
  dead_stones_confirmed_teams jsonb not null default '[]'::jsonb,
  last_move jsonb,

  -- Optional house rules chosen at setup — see src/utils/extensions.ts. move_count and
  -- last_bomb only matter while extension_bombs is true (move.ts increments move_count
  -- on every stone placement and drops a bomb every BOMB_INTERVAL of them).
  extension_bombs boolean not null default false,
  extension_stars boolean not null default false,
  move_count integer not null default 0,
  last_bomb jsonb,

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
alter table games add column if not exists max_players smallint not null default 2 check (max_players between 2 and 6);
alter table games add column if not exists extension_bombs boolean not null default false;
alter table games add column if not exists extension_stars boolean not null default false;
alter table games add column if not exists move_count integer not null default 0;
alter table games add column if not exists last_bomb jsonb;
alter table games add column if not exists dead_stones_confirmed_teams jsonb not null default '[]'::jsonb;

create unique index if not exists games_code_key on games (code);
create index if not exists games_status_idx on games (status);

alter table games enable row level security;

drop policy if exists "Public read access" on games;
create policy "Public read access" on games
  for select
  using (true);

-- Known, deliberately-accepted tradeoff: `using (true)` lets anyone holding the anon key
-- list every game ever played directly via REST (not just what the app's own lobby
-- exposes), bypassing the app's rate limiting for that read. Board state itself isn't
-- sensitive (no hidden information in Go), so the impact is just enumeration + a
-- rate-limit bypass, not data exposure. Restricting this (e.g. to `status = 'waiting'`)
-- was considered and rejected: Realtime's postgres_changes delivery for a row a client
-- can no longer SELECT could plausibly stop firing for that client, breaking live
-- updates for in-progress games -- a real risk that can't be verified without a live
-- Supabase project to test against.

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
-- One row per seat in a game (exactly max_players per game — see games above): which
-- team (color) it's on, its rotation position within that team, and whether it's still
-- pending, claimed, or claimed-then-left (see the block comment below for the pending
-- lifecycle; "left" is soft-deleted via left_at rather than removed, so turn rotation
-- and the roster shown to other players stay stable/auditable). The client never writes
-- here directly — every mutation goes through api/_lib/gameRepo.ts, which also touches
-- the parent `games` row so Realtime (subscribed to `games` only) fires and everyone
-- refetches the full roster along with the board.

-- All maxPlayers seats are created up front (see gameRepo.ts::createGame), each with its
-- team already decided (assignSeatTeams). A seat starts "pending" — guest_id/display_name/
-- joined_at all null, invite_token set — until someone claims it (by code, by the generic
-- game link, or by that seat's own invite link), at which point those three columns get
-- filled in and the token becomes irrelevant (claiming again is blocked by `guest_id is null`).
create table if not exists game_players (
  id bigint generated always as identity primary key,
  game_id uuid not null references games(id) on delete cascade,
  guest_id text,
  display_name text,
  team text not null check (team in ('black', 'white')),
  -- Join order within the team (0-based) — determines turn rotation order.
  turn_order integer not null,
  -- The player who created the game; only they can start it once ≥1 person has
  -- joined each team.
  is_creator boolean not null default false,
  joined_at timestamptz,
  left_at timestamptz,
  -- Secret used to claim this specific pending seat (its own invite link). Null once
  -- irrelevant isn't required — claiming is guarded by `guest_id is null`, not by this.
  invite_token text
);

-- Migration for a `game_players` table created before invite links existed. Safe no-ops
-- if already applied. Must run before the indexes below: on an existing table,
-- `create table if not exists` above is a no-op, so `invite_token` doesn't exist yet
-- until this adds it.
alter table game_players alter column guest_id drop not null;
alter table game_players alter column display_name drop not null;
alter table game_players alter column joined_at drop not null;
alter table game_players alter column joined_at drop default;
alter table game_players add column if not exists invite_token text;

create index if not exists game_players_game_idx on game_players (game_id);
create unique index if not exists game_players_unique_guest on game_players (game_id, guest_id);
create unique index if not exists game_players_invite_token_key on game_players (invite_token);

alter table game_players enable row level security;

-- No select/insert/update/delete policy for anon/authenticated: this table now also
-- holds invite_token secrets, and the client never queries it directly anyway — every
-- read goes through /api (service role), which decides what to expose (an invite token
-- only ever goes to that game's creator — see turns.ts::buildGameResponse). Previously
-- had a public-read policy; removed once invite_token was added, since RLS can't easily
-- exclude just one column from a SELECT.
drop policy if exists "Public read access" on game_players;

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

-- Counts this key's recent hits and records a new one in a single call, instead of the
-- API doing a separate select then insert (two round trips a concurrent burst of requests
-- could both pass before either's insert lands, letting the burst exceed `p_limit`). The
-- advisory lock serializes concurrent callers for the *same* ip_hash+action so the
-- count-then-insert below is effectively atomic for that key, without locking the whole
-- table or affecting unrelated keys. Released automatically when the calling transaction
-- ends (each RPC call from Supabase runs in its own transaction).
create or replace function check_and_record_rate_limit(
  p_ip_hash text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_ip_hash || ':' || p_action, 0));

  select count(*) into v_count
  from rate_limit_hits
  where ip_hash = p_ip_hash
    and action = p_action
    and created_at >= now() - (p_window_seconds || ' seconds')::interval;

  if v_count >= p_limit then
    return false;
  end if;

  insert into rate_limit_hits (ip_hash, action) values (p_ip_hash, p_action);
  return true;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, and Supabase exposes
-- every public-schema function as a callable RPC endpoint (/rest/v1/rpc/...) -- without
-- this, anyone holding the anon key (public by design) could call this function directly
-- with their own arbitrary p_limit/p_ip_hash/p_action, bypassing the /api layer entirely.
revoke execute on function check_and_record_rate_limit(text, text, integer, integer) from public;
grant execute on function check_and_record_rate_limit(text, text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- card_games
-- ---------------------------------------------------------------------------
-- Pairing *and* the match itself for the card game's "Jugar" flow: whoever clicks Jugar
-- becomes the host and gets a code to share; whoever enters that code becomes the guest,
-- which flips status to 'ready'. Once both have submitted a hand (see hand.ts), status
-- becomes 'playing' and a race starts: each side answers their own 5-card hand, the
-- server checks every answer against that card's real solution (src/cards/tesujiCards.ts,
-- reused as-is from Node -- it has no browser-only dependencies), and whoever's progress
-- first reaches 5 wins outright, ending the match for both. Deliberately its own table,
-- unrelated to games/game_players above -- no board/turns in the Go sense.

create table if not exists card_games (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version integer not null default 0,
  host_guest_id text not null,
  host_name text not null,
  guest_guest_id text,
  guest_name text,
  status text not null default 'waiting' check (status in ('waiting', 'ready', 'playing', 'finished', 'abandoned')),
  -- Each a length-5 array of tesuji card ids (see src/cards/tesujiCards.ts), drawn
  -- server-side with replacement from that player's own submitted deck once they reach
  -- the 'ready' screen -- see hand.ts. Null until that player has submitted one.
  host_hand jsonb,
  guest_hand jsonb,
  -- How many of their 5 hand cards each side has solved correctly so far, in order --
  -- the card they're currently on is hand[progress]. First to reach 5 wins.
  host_progress smallint not null default 0,
  guest_progress smallint not null default 0,
  -- Total wrong attempts so far -- purely informational/for the on-screen "+5s" counter,
  -- doesn't gate anything server-side (a wrong answer doesn't advance progress, so the
  -- player just has to try that same card again).
  host_mistakes integer not null default 0,
  guest_mistakes integer not null default 0,
  -- Set once both hands exist, i.e. when status flips to 'playing' -- the race's t=0.
  started_at timestamptz,
  winner text check (winner in ('host', 'guest')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only meaningful while status = 'waiting'; same expiry idea as games.expires_at.
  expires_at timestamptz not null default (now() + interval '20 minutes')
);

-- Migration for a card_games table created before the match itself existed (just
-- pairing). Safe no-ops if already applied.
alter table card_games drop constraint if exists card_games_status_check;
alter table card_games add constraint card_games_status_check check (status in ('waiting', 'ready', 'playing', 'finished', 'abandoned'));
alter table card_games add column if not exists host_hand jsonb;
alter table card_games add column if not exists guest_hand jsonb;
alter table card_games add column if not exists host_progress smallint not null default 0;
alter table card_games add column if not exists guest_progress smallint not null default 0;
alter table card_games add column if not exists host_mistakes integer not null default 0;
alter table card_games add column if not exists guest_mistakes integer not null default 0;
alter table card_games add column if not exists started_at timestamptz;
alter table card_games add column if not exists winner text check (winner in ('host', 'guest'));

create unique index if not exists card_games_code_key on card_games (code);
create index if not exists card_games_status_idx on card_games (status);

alter table card_games enable row level security;

-- Unlike `games`, this table is NOT publicly readable: host_hand/guest_hand hold the
-- other side's still-unsolved tesuji ids, and knowing an id is enough to look up its
-- exact solution in src/cards/tesujiCards.ts (shipped in the client bundle). A public
-- "using (true)" policy here -- even though the API itself already redacts the
-- opponent's hand in every response (see cardGameRepo.ts::rowToGame) -- would still let
-- anyone with the anon key query this table directly and read both hands raw. Only the
-- service role (the /api routes, which bypasses RLS entirely) can read or write.
-- The one visible cost: the browser's Supabase Realtime subscription on this table (see
-- useCardGame.ts) can no longer receive change events without a matching read policy,
-- so card games rely on the existing polling fallback (~3-4s) instead of instant
-- Realtime updates -- the same fallback already used when Realtime isn't configured at
-- all, not a new code path.
drop policy if exists "Public read access" on card_games;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'card_games'
  ) then
    alter publication supabase_realtime add table card_games;
  end if;
end $$;
