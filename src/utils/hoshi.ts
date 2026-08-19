import type { BoardSize, Position } from "../types/game.js";

/** Standard Go star points (hoshi) per board size — the fixed reference dots on the board. */
const HOSHI_POSITIONS: Record<BoardSize, Position[]> = {
  9: [
    { row: 2, col: 2 },
    { row: 2, col: 6 },
    { row: 6, col: 2 },
    { row: 6, col: 6 },
    { row: 4, col: 4 },
  ],
  13: [
    { row: 3, col: 3 },
    { row: 3, col: 9 },
    { row: 9, col: 3 },
    { row: 9, col: 9 },
    { row: 6, col: 6 },
  ],
  19: [
    { row: 3, col: 3 },
    { row: 3, col: 9 },
    { row: 3, col: 15 },
    { row: 9, col: 3 },
    { row: 9, col: 9 },
    { row: 9, col: 15 },
    { row: 15, col: 3 },
    { row: 15, col: 9 },
    { row: 15, col: 15 },
  ],
};

export function getHoshiPositions(boardSize: BoardSize): Position[] {
  return HOSHI_POSITIONS[boardSize] ?? [];
}

export function isHoshiPosition(pos: Position, boardSize: BoardSize): boolean {
  return getHoshiPositions(boardSize).some((p) => p.row === pos.row && p.col === pos.col);
}
