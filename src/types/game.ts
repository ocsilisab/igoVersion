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
