export type Stone = "black" | "white" | null;

export type Player = "black" | "white";

export type BoardSize = 9 | 13 | 19;

export type Board = Stone[][];

export interface Position {
  row: number;
  col: number;
}

export interface ScoreResult {
  blackStones: number;
  whiteStones: number;
  blackTerritory: number;
  whiteTerritory: number;
  blackCaptures: number;
  whiteCaptures: number;
  blackScore: number;
  whiteScore: number;
  winner: Player | "draw";
}

export interface GameState {
  board: Board;
  boardSize: BoardSize;
  currentPlayer: Player;
  blackCaptures: number;
  whiteCaptures: number;
  consecutivePasses: number;
  /** Serialized board states, one per move played (index 0 = empty board). Used to enforce the Ko rule. */
  history: string[];
  gameOver: boolean;
  lastMove: Position | null;
  winner: Player | "draw" | null;
  score: ScoreResult | null;
}

/** Reserved for future modes (AI / online) so the UI can branch without changing core game logic. */
export type GameMode = "solo" | "ai" | "online";
