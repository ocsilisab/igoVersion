import type { Board, BoardSize, Player, Position } from "../types/game.js";
import { cloneBoard, posKey } from "./board.js";
import { getGroup } from "./liberties.js";

export interface CaptureResult {
  board: Board;
  capturedCount: number;
  capturedPositions: Position[];
}

/** Removes every group of `color` that has zero liberties on `board`, returning the resulting board. */
export function removeDeadGroups(board: Board, color: Player, size: BoardSize): CaptureResult {
  const newBoard = cloneBoard(board);
  const visited = new Set<string>();
  const capturedPositions: Position[] = [];

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const key = posKey({ row, col });
      if (newBoard[row][col] !== color || visited.has(key)) continue;

      const group = getGroup(newBoard, { row, col }, size);
      group.stones.forEach((p) => visited.add(posKey(p)));

      if (group.liberties.size === 0) {
        group.stones.forEach((p) => {
          newBoard[p.row][p.col] = null;
          capturedPositions.push(p);
        });
      }
    }
  }

  return { board: newBoard, capturedCount: capturedPositions.length, capturedPositions };
}
