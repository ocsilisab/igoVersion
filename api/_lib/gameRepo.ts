import type { Board, BoardSize, Player } from "../../src/types/game";
import { createEmptyBoard, serializeBoard } from "../../src/utils/board";
import type { OnlineGame, OnlineGameStatus } from "../../src/online/types";
import { generateGameCode } from "./gameCode";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { Errors } from "./errors";

const WAITING_TTL_MINUTES = 20;
const CREATE_CODE_ATTEMPTS = 5;

interface GameRow {
  id: string;
  code: string;
  version: number;
  board_size: number;
  board: Board;
  current_player: Player;
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
  black_player_id: string;
  white_player_id: string | null;
  black_name: string;
  white_name: string | null;
  abandoned_by: Player | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

function rowToGame(row: GameRow): OnlineGame {
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    boardSize: row.board_size as BoardSize,
    board: row.board,
    currentPlayer: row.current_player,
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
    blackPlayerId: row.black_player_id,
    whitePlayerId: row.white_player_id,
    blackName: row.black_name,
    whiteName: row.white_name,
    abandonedBy: row.abandoned_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

/** Resolves which color (if any) `guestId` plays in `game`. */
export function resolveColor(game: OnlineGame, guestId: string | null): Player | null {
  if (!guestId) return null;
  if (game.blackPlayerId === guestId) return "black";
  if (game.whitePlayerId === guestId) return "white";
  return null;
}

export function isExpiredWaitingGame(game: OnlineGame): boolean {
  return game.status === "waiting" && new Date(game.expiresAt).getTime() < Date.now();
}

export async function findGameById(id: string): Promise<OnlineGame | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("games").select("*").eq("id", id).maybeSingle();
  if (error) throw Errors.serverError();
  return data ? rowToGame(data as GameRow) : null;
}

async function findGameByCode(code: string): Promise<OnlineGame | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("games").select("*").eq("code", code).maybeSingle();
  if (error) throw Errors.serverError();
  return data ? rowToGame(data as GameRow) : null;
}

export interface CreateGameInput {
  boardSize: BoardSize;
  guestId: string;
  displayName: string;
}

export async function createGame({ boardSize, guestId, displayName }: CreateGameInput): Promise<OnlineGame> {
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
        board,
        current_player: "black",
        history: [serializeBoard(board)],
        status: "waiting",
        black_player_id: guestId,
        black_name: displayName,
        expires_at: expiresAt,
      })
      .select("*")
      .single();

    if (!error) return rowToGame(data as GameRow);
    // Unique-violation on the code column: try again with a fresh code.
    if (error.code !== "23505") throw Errors.serverError();
  }

  throw Errors.serverError();
}

export interface JoinGameInput {
  code: string;
  guestId: string;
  displayName: string;
}

export async function joinGame({ code, guestId, displayName }: JoinGameInput): Promise<OnlineGame> {
  const game = await findGameByCode(code);
  if (!game) throw Errors.notFound();

  // Idempotent rejoin: reloading the page while still waiting, or right after joining.
  if (game.blackPlayerId === guestId || game.whitePlayerId === guestId) {
    return game;
  }

  if (isExpiredWaitingGame(game)) throw Errors.expired();
  if (game.status !== "waiting" || game.whitePlayerId !== null) throw Errors.full();

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("games")
    .update({
      white_player_id: guestId,
      white_name: displayName,
      status: "playing",
      version: game.version + 1,
    })
    .eq("id", game.id)
    .eq("version", game.version)
    .is("white_player_id", null)
    .select("*")
    .maybeSingle();

  if (error) throw Errors.serverError();
  // Someone else joined first between our read and this write.
  if (!data) throw Errors.full();

  return rowToGame(data as GameRow);
}

export interface PlayableGameContext {
  game: OnlineGame;
  color: Player;
}

/**
 * Shared preamble for move/pass/mark-dead/finalize: resolves the caller's color and
 * makes sure the game is actually in an active `playing` state (which also covers the
 * post-double-pass scoring sub-phase — see OnlineGame.isScoring).
 */
export async function loadGameForPlayer(id: string, guestId: string | null): Promise<PlayableGameContext> {
  if (!guestId) throw Errors.unauthorized();

  const game = await findGameById(id);
  if (!game) throw Errors.notFound();

  const color = resolveColor(game, guestId);
  if (!color) throw Errors.wrongColor();

  if (game.status === "finished" || game.status === "abandoned") throw Errors.gameOver();
  if (game.status !== "playing") throw Errors.badRequest("La partida todavía no ha comenzado.");

  return { game, color };
}

/**
 * Optimistic-concurrency update: only succeeds if `game.version` still matches the row.
 * Every gameplay mutation (move/pass/mark-dead/finalize/leave) goes through this so two
 * near-simultaneous requests can never silently clobber each other.
 */
export async function applyGameUpdate(game: OnlineGame, patch: Record<string, unknown>): Promise<OnlineGame> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("games")
    .update({ ...patch, version: game.version + 1 })
    .eq("id", game.id)
    .eq("version", game.version)
    .select("*")
    .maybeSingle();

  if (error) throw Errors.serverError();
  if (!data) throw Errors.conflict();

  return rowToGame(data as GameRow);
}
