import type { Board, BoardSize, Player, ScoreResult } from "../types/game.js";

/**
 * Identity kind. Only "guest" is usable today — see REGISTRATION_ENABLED.
 * Kept as a real discriminant now so a future `registered` user (username/email/
 * password/emailVerifiedAt) can be added without reshaping every online type.
 */
export type UserType = "guest" | "registered";

/** Feature flag: registration/login UI and endpoints stay hidden until this is true. */
export const REGISTRATION_ENABLED = false;

export type OnlineGameStatus = "waiting" | "playing" | "finished" | "abandoned";

/**
 * Server-authoritative online game record, as sent to the browser. Mirrors the `games`
 * table (see supabase/schema.sql) in camelCase; the server is the only writer.
 */
export interface OnlineGame {
  id: string;
  code: string;
  version: number;

  boardSize: BoardSize;
  komi: number;
  board: Board;
  currentPlayer: Player;
  blackCaptures: number;
  whiteCaptures: number;
  consecutivePasses: number;
  history: string[];
  isScoring: boolean;
  deadStones: string[];
  lastMove: { row: number; col: number } | null;

  status: OnlineGameStatus;
  winner: Player | "draw" | null;
  score: ScoreResult | null;

  blackPlayerId: string | null;
  whitePlayerId: string | null;
  blackName: string | null;
  whiteName: string | null;
  abandonedBy: Player | null;

  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface YouInfo {
  guestId: string;
  userType: UserType;
  color: Player | null;
  displayName: string;
}

export interface GameResponse {
  game: OnlineGame;
  you: YouInfo;
}

/** Returned by move/pass/mark-dead/finalize/leave — the caller's identity doesn't change mid-game. */
export interface GameMutationResponse {
  game: OnlineGame;
}

export type OnlineErrorCode =
  | "not_found"
  | "full"
  | "expired"
  | "invalid_code"
  | "not_your_turn"
  | "wrong_color"
  | "invalid_move"
  | "game_over"
  | "conflict"
  | "rate_limited"
  | "unauthorized"
  | "bad_request"
  | "server_error";

export interface ApiErrorBody {
  error: OnlineErrorCode;
  message: string;
}
