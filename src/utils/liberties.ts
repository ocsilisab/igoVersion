import type { Board, BoardSize, Position } from "../types/game.js";
import { getNeighbors, posKey } from "./board.js";

export interface GroupInfo {
  stones: Position[];
  liberties: Set<string>;
}

/**
 * Flood-fills the group of same-colored, orthogonally-connected stones starting at `start`,
 * and collects the set of empty intersections adjacent to that group (its liberties).
 */
export function getGroup(board: Board, start: Position, size: BoardSize): GroupInfo {
  const color = board[start.row][start.col];
  const stones: Position[] = [];
  const liberties = new Set<string>();
  const visited = new Set<string>([posKey(start)]);
  const stack: Position[] = [start];

  while (stack.length > 0) {
    const pos = stack.pop()!;
    stones.push(pos);

    for (const neighbor of getNeighbors(pos, size)) {
      const neighborStone = board[neighbor.row][neighbor.col];
      const key = posKey(neighbor);

      if (neighborStone === null) {
        liberties.add(key);
      } else if (neighborStone === color && !visited.has(key)) {
        visited.add(key);
        stack.push(neighbor);
      }
    }
  }

  return { stones, liberties };
}

export function countLiberties(board: Board, pos: Position, size: BoardSize): number {
  if (board[pos.row][pos.col] === null) return 0;
  return getGroup(board, pos, size).liberties.size;
}
