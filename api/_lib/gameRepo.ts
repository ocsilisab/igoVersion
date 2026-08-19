import { randomBytes } from "node:crypto";
import type { Board, BoardSize, Player } from "../../src/types/game.js";
import { createEmptyBoard, serializeBoard } from "../../src/utils/board.js";
import type { OnlineGame, OnlineGameStatus, OnlinePlayer, PendingSeat } from "../../src/online/types.js";
import { getActivePlayer } from "../../src/online/turns.js";
import { assignSeatTeams } from "../../src/online/teamAssignment.js";
import { generateGameCode } from "./gameCode.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { Errors } from "./errors.js";

const WAITING_TTL_MINUTES = 20;
const CREATE_CODE_ATTEMPTS = 5;

interface GameRow {
  id: string;
  code: string;
  version: number;
  board_size: number;
  max_players: number;
  komi: number;
  board: Board;
  current_player: Player;
  black_turn_index: number;
  white_turn_index: number;
  black_captures: number;
  white_captures: number;
  consecutive_passes: number;
  history: string[];
  is_scoring: boolean;
  dead_stones: string[];
  last_move: { row: number; col: number } | null;
  status: OnlineGameStatus;
  winner: OnlineGame["winner"];
  score: OnlineGame["score"];
  abandoned_team: Player | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

interface PlayerRow {
  guest_id: string | null;
  display_name: string | null;
  team: Player;
  turn_order: number;
  is_creator: boolean;
  left_at: string | null;
  invite_token: string | null;
}

function rowToGame(row: GameRow, playerRows: PlayerRow[]): OnlineGame {
  const players: OnlinePlayer[] = playerRows
    .filter((p) => p.guest_id !== null)
    .map((p) => ({
      guestId: p.guest_id as string,
      displayName: p.display_name ?? "",
      team: p.team,
      turnOrder: p.turn_order,
      isCreator: p.is_creator,
      active: p.left_at === null,
    }));

  const pendingSeats: PendingSeat[] = playerRows
    .filter((p) => p.guest_id === null)
    .map((p) => ({ team: p.team, turnOrder: p.turn_order, inviteToken: p.invite_token ?? undefined }));

  return {
    id: row.id,
    code: row.code,
    version: row.version,
    boardSize: row.board_size as BoardSize,
    maxPlayers: row.max_players,
    komi: row.komi,
    board: row.board,
    currentPlayer: row.current_player,
    blackTurnIndex: row.black_turn_index,
    whiteTurnIndex: row.white_turn_index,
    blackCaptures: row.black_captures,
    whiteCaptures: row.white_captures,
    consecutivePasses: row.consecutive_passes,
    history: row.history,
    isScoring: row.is_scoring,
    deadStones: row.dead_stones,
    lastMove: row.last_move,
    status: row.status,
    winner: row.winner,
    score: row.score,
    abandonedTeam: row.abandoned_team,
    players,
    pendingSeats,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

async function fetchPlayers(gameId: string): Promise<PlayerRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("game_players")
    .select("*")
    .eq("game_id", gameId)
    .order("turn_order", { ascending: true });
  if (error) throw Errors.serverError();
  return (data ?? []) as PlayerRow[];
}

export async function findGameById(id: string): Promise<OnlineGame | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("games").select("*").eq("id", id).maybeSingle();
  if (error) throw Errors.serverError();
  if (!data) return null;
  return rowToGame(data as GameRow, await fetchPlayers(id));
}

async function findGameByCode(code: string): Promise<OnlineGame | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("games").select("*").eq("code", code).maybeSingle();
  if (error) throw Errors.serverError();
  if (!data) return null;
  return rowToGame(data as GameRow, await fetchPlayers((data as GameRow).id));
}

export interface CreateGameInput {
  boardSize: BoardSize;
  maxPlayers: number;
  komi: number;
  creatorColor: Player;
  guestId: string;
  displayName: string;
}

export async function createGame({
  boardSize,
  maxPlayers,
  komi,
  creatorColor,
  guestId,
  displayName,
}: CreateGameInput): Promise<OnlineGame> {
  const supabase = getSupabaseAdmin();
  const board = createEmptyBoard(boardSize);
  const expiresAt = new Date(Date.now() + WAITING_TTL_MINUTES * 60 * 1000).toISOString();

  for (let attempt = 0; attempt < CREATE_CODE_ATTEMPTS; attempt++) {
    const code = generateGameCode();
    const { data, error } = await supabase
      .from("games")
      .insert({
        code,
        board_size: boardSize,
        max_players: maxPlayers,
        komi,
        board,
        current_player: "black",
        history: [serializeBoard(board)],
        status: "waiting",
        expires_at: expiresAt,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") continue; // code collision — try again with a fresh one
      throw Errors.serverError();
    }

    const gameRow = data as GameRow;

    // Pre-create every seat (not just the creator's) so the team split shown at setup
    // time is exactly what gets built — see assignSeatTeams. Seats past the first are
    // "pending" (no guest_id yet) until someone claims one, by code, by the generic
    // game link, or by that seat's own invite link (see joinPendingGame/claimSeatByToken).
    const seatTeams = assignSeatTeams(creatorColor, maxPlayers);
    const teamCounters: Record<Player, number> = { black: 0, white: 0 };
    const seatRows = seatTeams.map((team, index) => {
      const turnOrder = teamCounters[team]++;
      if (index === 0) {
        return {
          game_id: gameRow.id,
          guest_id: guestId,
          display_name: displayName,
          team,
          turn_order: turnOrder,
          is_creator: true,
          joined_at: new Date().toISOString(),
        };
      }
      return {
        game_id: gameRow.id,
        team,
        turn_order: turnOrder,
        invite_token: randomBytes(16).toString("hex"),
      };
    });

    const { error: playerError } = await supabase.from("game_players").insert(seatRows);
    if (playerError) throw Errors.serverError();

    return rowToGame(gameRow, await fetchPlayers(gameRow.id));
  }

  throw Errors.serverError();
}

export interface JoinGameInput {
  code: string;
  guestId: string;
  displayName: string;
}

/**
 * Atomically claims one specific pending seat: the `guest_id is null` guard means only
 * one of two concurrent claimants can ever win the update, so callers can safely try
 * candidate seats in order without a transaction.
 */
async function tryClaimSeat(gameId: string, seat: PendingSeat, guestId: string, displayName: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("game_players")
    .update({ guest_id: guestId, display_name: displayName, joined_at: new Date().toISOString() })
    .eq("game_id", gameId)
    .eq("team", seat.team)
    .eq("turn_order", seat.turnOrder)
    .is("guest_id", null)
    .select("id")
    .maybeSingle();
  if (error) throw Errors.serverError();
  return Boolean(data);
}

/** Shared by code-join and generic-link-join: claims whichever pending seat keeps the teams most balanced. */
async function joinPendingGame(game: OnlineGame, guestId: string, displayName: string): Promise<OnlineGame> {
  // Idempotent rejoin: reloading the page while still waiting, or right after joining.
  const existing = game.players.find((p) => p.guestId === guestId);
  if (existing) return game;

  if (isExpiredWaitingGame(game)) throw Errors.expired();
  if (game.status !== "waiting") throw Errors.full();

  const blackCount = game.players.filter((p) => p.team === "black" && p.active).length;
  const whiteCount = game.players.filter((p) => p.team === "white" && p.active).length;
  const preferredTeam: Player = blackCount <= whiteCount ? "black" : "white";
  const candidates = [
    ...game.pendingSeats.filter((s) => s.team === preferredTeam).sort((a, b) => a.turnOrder - b.turnOrder),
    ...game.pendingSeats.filter((s) => s.team !== preferredTeam).sort((a, b) => a.turnOrder - b.turnOrder),
  ];
  if (candidates.length === 0) throw Errors.full();

  for (const seat of candidates) {
    if (await tryClaimSeat(game.id, seat, guestId, displayName)) {
      // Touch the parent `games` row so everyone's Realtime subscription (on `games`
      // only — see supabase/schema.sql) fires and they refetch the updated roster.
      return applyGameUpdate(game, {});
    }
  }
  // Every candidate got claimed by someone else between our read and our writes.
  throw Errors.full();
}

export async function joinGame({ code, guestId, displayName }: JoinGameInput): Promise<OnlineGame> {
  const game = await findGameByCode(code);
  if (!game) throw Errors.notFound();
  return joinPendingGame(game, guestId, displayName);
}

/** The generic per-game link (`?game=<id>`, no invite token): same balancing as a code-join. */
export async function joinGameById(id: string, guestId: string, displayName: string): Promise<OnlineGame> {
  const game = await findGameById(id);
  if (!game) throw Errors.notFound();
  return joinPendingGame(game, guestId, displayName);
}

/** A specific player's personal invite link (`?game=<id>&token=<token>`): claims exactly that seat/team. */
export async function claimSeatByToken(token: string, guestId: string, displayName: string): Promise<OnlineGame> {
  const supabase = getSupabaseAdmin();
  const { data: seatRow, error } = await supabase
    .from("game_players")
    .select("game_id, team, turn_order")
    .eq("invite_token", token)
    .is("guest_id", null)
    .maybeSingle();
  if (error) throw Errors.serverError();
  if (!seatRow) throw Errors.invalidInvite();

  const gameId = seatRow.game_id as string;
  const game = await findGameById(gameId);
  if (!game) throw Errors.notFound();

  const existing = game.players.find((p) => p.guestId === guestId);
  if (existing) return game;

  if (isExpiredWaitingGame(game)) throw Errors.expired();
  if (game.status !== "waiting") throw Errors.full();

  const seat: PendingSeat = { team: seatRow.team as Player, turnOrder: seatRow.turn_order as number };
  const claimed = await tryClaimSeat(gameId, seat, guestId, displayName);
  if (!claimed) throw Errors.invalidInvite(); // someone else claimed it a moment ago

  return applyGameUpdate(game, {});
}

export interface PlayableGameContext {
  game: OnlineGame;
  team: Player;
}

/** Shared preamble for mark-dead/finalize: any active roster member, game must be actively playing. */
export async function loadPlayableGame(id: string, guestId: string | null): Promise<PlayableGameContext> {
  if (!guestId) throw Errors.unauthorized();

  const game = await findGameById(id);
  if (!game) throw Errors.notFound();

  const me = game.players.find((p) => p.guestId === guestId && p.active);
  if (!me) throw Errors.wrongColor();

  if (game.status === "finished" || game.status === "abandoned") throw Errors.gameOver();
  if (game.status !== "playing") throw Errors.badRequest("La partida todavía no ha comenzado.");

  return { game, team: me.team };
}

/** Stricter preamble for move/pass: it must specifically be this guest's turn within their team. */
export async function loadActiveGameForPlayer(id: string, guestId: string | null): Promise<PlayableGameContext> {
  const { game, team } = await loadPlayableGame(id, guestId);

  if (game.isScoring) throw Errors.invalidMove("La partida está en fase de puntuación.");
  if (game.currentPlayer !== team) throw Errors.notYourTurn();
  if (getActivePlayer(game, team)?.guestId !== guestId) throw Errors.notYourTurn();

  return { game, team };
}

export function isExpiredWaitingGame(game: OnlineGame): boolean {
  return game.status === "waiting" && new Date(game.expiresAt).getTime() < Date.now();
}

/**
 * Optimistic-concurrency update: only succeeds if `game.version` still matches the row.
 * Every mutation (move/pass/mark-dead/finalize/leave/start/join) goes through this so
 * concurrent requests can never silently clobber each other. Always refetches the full
 * roster afterwards, since some callers (join/leave) only touch game_players directly.
 */
export async function applyGameUpdate(game: OnlineGame, patch: Record<string, unknown>): Promise<OnlineGame> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("games")
    .update({ ...patch, version: game.version + 1, updated_at: new Date().toISOString() })
    .eq("id", game.id)
    .eq("version", game.version)
    .select("*")
    .maybeSingle();

  if (error) throw Errors.serverError();
  if (!data) throw Errors.conflict();

  return rowToGame(data as GameRow, await fetchPlayers(game.id));
}

export async function startGame(id: string, guestId: string | null): Promise<OnlineGame> {
  if (!guestId) throw Errors.unauthorized();

  const game = await findGameById(id);
  if (!game) throw Errors.notFound();

  const me = game.players.find((p) => p.guestId === guestId && p.active);
  if (!me?.isCreator) throw Errors.wrongColor();
  if (game.status !== "waiting") throw Errors.badRequest("La partida ya ha empezado.");

  const blackCount = game.players.filter((p) => p.team === "black" && p.active).length;
  const whiteCount = game.players.filter((p) => p.team === "white" && p.active).length;
  if (blackCount === 0 || whiteCount === 0) {
    throw Errors.badRequest("Hace falta al menos un jugador en cada equipo para empezar.");
  }

  return applyGameUpdate(game, { status: "playing" });
}

export async function leaveGame(id: string, guestId: string | null): Promise<OnlineGame> {
  if (!guestId) throw Errors.unauthorized();

  const game = await findGameById(id);
  if (!game) throw Errors.notFound();

  const me = game.players.find((p) => p.guestId === guestId && p.active);
  if (!me) throw Errors.wrongColor();

  if (game.status === "finished" || game.status === "abandoned") return game;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("game_players")
    .update({ left_at: new Date().toISOString() })
    .eq("game_id", game.id)
    .eq("guest_id", guestId);
  if (error) throw Errors.serverError();

  const teammatesLeft = game.players.filter((p) => p.team === me.team && p.active && p.guestId !== guestId);

  if (teammatesLeft.length === 0) {
    return applyGameUpdate(game, { status: "abandoned", abandoned_team: me.team });
  }

  if (game.status === "waiting") {
    return applyGameUpdate(game, {});
  }

  // If it was exactly this player's turn, bump the rotation so their team isn't stuck
  // waiting on someone who just left.
  const wasActive = getActivePlayer(game, me.team)?.guestId === guestId;
  if (wasActive) {
    const field = me.team === "black" ? "black_turn_index" : "white_turn_index";
    const current = me.team === "black" ? game.blackTurnIndex : game.whiteTurnIndex;
    return applyGameUpdate(game, { [field]: current + 1 });
  }

  return applyGameUpdate(game, {});
}
