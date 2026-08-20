export type Stone = "black" | "white" | null;

export type Player = "black" | "white";

export type BoardSize = 9 | 13 | 19;

export type Board = Stone[][];

export interface Position {
  row: number;
  col: number;
}

/** Standard compensation points awarded to White at scoring time, to offset Black's first-move advantage. */
export const KOMI_OPTIONS: readonly number[] = [0, 6.5, 7.5];
export const DEFAULT_KOMI = 6.5;

/** Every mode starts at a plain 1v1 and can grow to team play, up to this many people total. */
export const MIN_TOTAL_PLAYERS = 2;
export const MAX_TOTAL_PLAYERS = 6;

/** Each color's roster of player names/labels for the local (solo/AI) team modes. */
export interface TeamRoster {
  black: string[];
  white: string[];
}

/**
 * Optional house rules, chosen at setup time. "bombs": every BOMB_INTERVAL moves (see
 * utils/extensions.ts) a random point is cleared, along with its neighbors. "stars": a
 * stone played next to an empty hoshi point auto-converts that hoshi into a stone of the
 * same color too. Currently wired up for solo mode only.
 */
export interface ExtensionRules {
  bombs: boolean;
  stars: boolean;
}

export const NO_EXTENSIONS: ExtensionRules = { bombs: false, stars: false };

export interface ScoreResult {
  blackStones: number;
  whiteStones: number;
  blackTerritory: number;
  whiteTerritory: number;
  blackCaptures: number;
  whiteCaptures: number;
  komi: number;
  blackScore: number;
  whiteScore: number;
  winner: Player | "draw";
}

export interface GameState {
  board: Board;
  boardSize: BoardSize;
  komi: number;
  teams: TeamRoster;
  /** Index of the roster member whose turn it is next, per color — advances (mod team size) each time that color moves or passes. */
  turnIndex: Record<Player, number>;
  extensions: ExtensionRules;
  /** Stone placements played so far (passes don't count) — drives the "bombas" interval. */
  moveCount: number;
  /** The most recent bomb drop, if any this game, for the board to show where it hit. */
  lastBomb: { center: Position; affected: Position[] } | null;
  currentPlayer: Player;
  blackCaptures: number;
  whiteCaptures: number;
  consecutivePasses: number;
  /** Serialized board states, one per move played (index 0 = empty board). Used to enforce the Ko rule. */
  history: string[];
  /** True after both players pass in a row: no more moves, board is shown for dead-stone marking. */
  isScoring: boolean;
  /** posKey ("row,col") of every stone currently marked dead during the scoring phase. */
  deadStones: Set<string>;
  gameOver: boolean;
  lastMove: Position | null;
  winner: Player | "draw" | null;
  score: ScoreResult | null;
}

/** Reserved for future modes (AI / online) so the UI can branch without changing core game logic. */
export type GameMode = "solo" | "ai" | "online";

/**
 * AI opponent strength for "Jugar con IA". "facil" is the reactive one-ply heuristic in
 * src/ai/chooseMove.ts; "dificil" is meant to route to a Monte Carlo Tree Search engine
 * (src/ai/mcts/) with real lookahead, planned in phases — until that lands, both
 * difficulties call the same chooseAiMove, so this type is wired up ahead of the engine.
 */
export type AiDifficulty = "facil" | "dificil";

export const DEFAULT_AI_DIFFICULTY: AiDifficulty = "facil";
