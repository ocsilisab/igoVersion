import type { Board, BoardSize, Player } from "../../src/types/game.js";
import { createEmptyBoard, serializeBoard } from "../../src/utils/board.js";
import type { OnlineGame, OnlineGameStatus, OnlinePlayer } from "../../src/online/types.js";
import { getActivePlayer } from "../../src/online/turns.js";
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
  guest_id: string;
  display_name: string;
  team: Player;
  turn_order: number;
  is_creator: boolean;
  left_at: string | null;
}

function rowToGame(row: GameRow, playerRows: PlayerRow[]): OnlineGame {
  const players: OnlinePlayer[] = playerRows.map((p) => ({
    guestId: p.guest_id,
    displayName: p.display_name,
    team: p.team,
    turnOrder: p.turn_order,
    isCreator: p.is_creator,
    active: p.left_at === null,
  }));

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
    const { error: playerError } = await supabase.from("game_players").insert({
      game_id: gameRow.id,
      guest_id: guestId,
      display_name: displayName,
      team: creatorColor,
      turn_order: 0,
      is_creator: true,
    });
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

export async function joinGame({ code, guestId, displayName }: JoinGameInput): Promise<OnlineGame> {
  const game = await findGameByCode(code);
  if (!game) throw Errors.notFound();

  // Idempotent rejoin: reloading the page while still waiting, or right after joining.
  const existing = game.players.find((p) => p.guestId === guestId);
  if (existing) return game;

  if (isExpiredWaitingGame(game)) throw Errors.expired();
  if (game.status !== "waiting") throw Errors.full();

  const activeCount = game.players.filter((p) => p.active).length;
  if (activeCount >= game.maxPlayers) throw Errors.full();

  // Balance teams as evenly as possible; ties go to black.
  const blackCount = game.players.filter((p) => p.team === "black" && p.active).length;
  const whiteCount = game.players.filter((p) => p.team === "white" && p.active).length;
  const team: Player = blackCount <= whiteCount ? "black" : "white";
  const turnOrder = game.players.filter((p) => p.team === team).length;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("game_players").insert({
    game_id: game.id,
    guest_id: guestId,
    display_name: displayName,
    team,
    turn_order: turnOrder,
    is_creator: false,
  });
  if (error) throw Errors.serverError();

  // Touch the parent `games` row so everyone's Realtime subscription (on `games`
  // only — see supabase/schema.sql) fires and they refetch the updated roster.
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
