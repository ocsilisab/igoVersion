import type { Board, BoardSize, Player, Position, Stone } from "../types/game";

export function createEmptyBoard(size: BoardSize): Board {
  return Array.from({ length: size }, () => Array<Stone>(size).fill(null));
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

export function isOnBoard(pos: Position, size: BoardSize): boolean {
  return pos.row >= 0 && pos.row < size && pos.col >= 0 && pos.col < size;
}

export function getNeighbors(pos: Position, size: BoardSize): Position[] {
  const { row, col } = pos;
  const candidates: Position[] = [
    { row: row - 1, col },
    { row: row + 1, col },
    { row, col: col - 1 },
    { row, col: col + 1 },
  ];
  return candidates.filter((p) => isOnBoard(p, size));
}

export function opponent(player: Player): Player {
  return player === "black" ? "white" : "black";
}

/** Compact string representation of a board, used to detect repeated positions (Ko rule). */
export function serializeBoard(board: Board): string {
  return board.map((row) => row.map((s) => (s === null ? "." : s === "black" ? "B" : "W")).join("")).join("/");
}

export function posKey(pos: Position): string {
  return `${pos.row},${pos.col}`;
}
