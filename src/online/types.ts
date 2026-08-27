import type { Board, BoardSize, ExtensionRules, Player, ScoreResult } from "../types/game.js";
import type { ClockState, TimeControl } from "../utils/clock.js";

/**
 * Identity kind. Only "guest" is usable today — see REGISTRATION_ENABLED.
 * Kept as a real discriminant now so a future `registered` user (username/email/
 * password/emailVerifiedAt) can be added without reshaping every online type.
 */
export type UserType = "guest" | "registered";

/** Feature flag: registration/login UI and endpoints stay hidden until this is true. */
export const REGISTRATION_ENABLED = false;

export type OnlineGameStatus = "waiting" | "playing" | "finished" | "abandoned";

/** One person in an online game's roster — see supabase/schema.sql::game_players. */
export interface OnlinePlayer {
  guestId: string;
  displayName: string;
  team: Player;
  turnOrder: number;
  isCreator: boolean;
  /** False once they've left (leave.ts soft-deletes rather than removing the row). */
  active: boolean;
}

/**
 * A seat reserved at creation time but not yet claimed by anyone — see
 * assignSeatTeams (src/online/teamAssignment.ts) for how its team was pre-decided, and
 * gameRepo.ts::claimSeatByToken for how a specific person fills it. `inviteToken` is a
 * secret: the server only includes it in responses sent to the game's creator (see
 * turns.ts::buildGameResponse), since it's the direct-join link for this seat.
 */
export interface PendingSeat {
  team: Player;
  turnOrder: number;
  inviteToken?: string;
}

/**
 * Server-authoritative online game record, as sent to the browser. Mirrors the `games`
 * table (see supabase/schema.sql) in camelCase, plus its full player roster; the server
 * is the only writer. A game has 2 to 6 players split across the two colors (teams) —
 * see src/online/turns.ts for whose turn it specifically is within a team.
 */
export interface OnlineGame {
  id: string;
  code: string;
  version: number;

  boardSize: BoardSize;
  /** Total player cap chosen at creation (2 to 6) — see supabase/schema.sql::games.max_players. */
  maxPlayers: number;
  komi: number;
  board: Board;
  currentPlayer: Player;
  blackTurnIndex: number;
  whiteTurnIndex: number;
  blackCaptures: number;
  whiteCaptures: number;
  consecutivePasses: number;
  history: string[];
  isScoring: boolean;
  deadStones: string[];
  /** Teams that have confirmed the *current* deadStones as correct -- reset whenever
   * deadStones itself changes. finalize.ts refuses to close the game until both
   * "black" and "white" are present here (see mark-dead.ts's "confirm" action). */
  deadStonesConfirmedTeams: Player[];
  lastMove: { row: number; col: number } | null;

  extensions: ExtensionRules;
  /** Stone placements played so far (passes don't count) — drives the "bombas" interval. */
  moveCount: number;
  lastBomb: { center: { row: number; col: number }; affected: { row: number; col: number }[] } | null;

  status: OnlineGameStatus;
  winner: Player | "draw" | null;
  /** Distinguishes a normal score-based ending from a clock running out. Null while the
   * game hasn't ended (or ended before this field existed). */
  winReason: "score" | "timeout" | null;
  score: ScoreResult | null;
  abandonedTeam: Player | null;

  /** null = untimed game. Set once at creation, never changes afterwards. */
  timeControl: TimeControl | null;
  /** Only meaningful when `timeControl` is set. */
  blackClock: ClockState | null;
  whiteClock: ClockState | null;
  /** When the *current* mover's clock started running -- server-authoritative; the client
   * only ever uses this to project a live display forward via Date.now(), never to decide
   * anything itself. Null while untimed or the game hasn't started. */
  turnStartedAt: string | null;

  players: OnlinePlayer[];
  /** Reserved seats nobody has claimed yet — always `maxPlayers - players.length` of them. */
  pendingSeats: PendingSeat[];

  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

/** One row in the public lobby list (GET /api/games) — enough to decide whether to join, no board state. */
export interface OpenGameSummary {
  id: string;
  boardSize: BoardSize;
  maxPlayers: number;
  komi: number;
  extensions: ExtensionRules;
  blackCount: number;
  whiteCount: number;
  createdAt: string;
}

export interface OpenGamesResponse {
  games: OpenGameSummary[];
}

export interface YouInfo {
  guestId: string;
  userType: UserType;
  team: Player | null;
  displayName: string;
  isCreator: boolean;
  /** Whether it's specifically this guest's turn right now (not just their team's). */
  isYourTurn: boolean;
}

export interface GameResponse {
  game: OnlineGame;
  you: YouInfo;
}

/** Returned by move/pass/mark-dead/finalize/leave/start — the caller's identity doesn't change mid-game. */
export interface GameMutationResponse {
  game: OnlineGame;
}

export type OnlineErrorCode =
  | "not_found"
  | "full"
  | "expired"
  | "invalid_code"
  | "invalid_invite"
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
