import type { Board, BoardSize, Player, Position } from "../types/game.js";
import { getNeighbors, posKey } from "./board.js";

/**
 * Only a connected empty region up to this size counts as a real eye. A genuine
 * single-eye shape (including big false eyes, bent/L shapes) is comfortably smaller than
 * this; a bigger region is either a real living eye-space that hasn't been narrowed down
 * yet, or just ordinary open board — this heuristic can't tell those two apart, so it
 * deliberately refuses to judge them at all rather than risk a wrong call in either
 * direction. Same reasoning, and same value, as ai/detectGameEnd.ts's identical constant;
 * kept as a separate copy rather than a shared import so each caller's tuning can drift
 * independently if a future difficulty ever needs to.
 */
const EYE_REGION_SIZE_CAP = 6;

interface EmptyRegion {
  cells: Position[];
  borderColors: Set<Player>;
}

function floodFillEmpty(board: Board, start: Position, boardSize: BoardSize, visited: Set<string>): EmptyRegion {
  const cells: Position[] = [];
  const borderColors = new Set<Player>();
  const stack: Position[] = [start];
  visited.add(posKey(start));

  while (stack.length > 0) {
    const pos = stack.pop()!;
    cells.push(pos);

    for (const neighbor of getNeighbors(pos, boardSize)) {
      const stone = board[neighbor.row][neighbor.col];
      const key = posKey(neighbor);
      if (stone === null) {
        if (!visited.has(key)) {
          visited.add(key);
          stack.push(neighbor);
        }
      } else {
        borderColors.add(stone);
      }
    }
  }

  return { cells, borderColors };
}

/**
 * Every empty point that's part of a small, fully-enclosed region bordered ONLY by
 * `color` — a real eye point for that color, as opposed to a false eye (this check only
 * looks at orthogonal borders, not diagonal control, so it can't tell those apart —
 * accepted limitation, same as suggestDeadGroups/detectGameEnd.ts), a shared/contested
 * point, or plain open board.
 *
 * Used to stop both "Difícil" (MCTS rollouts) and "Fácil" from wasting a move filling in
 * their own group's eye space — a classic mistake for any naive Go-playing policy, since
 * an eye point almost always still "counts" whether or not a stone sits there, so filling
 * it in is either neutral (wasted) or actively harmful (it can turn a two-eyed group into
 * a one-eyed one if the two eyes shared a liberty) — and, from the opponent's side, to
 * recognize the vital point of a small group that doesn't have two of these yet.
 */
export function findRealEyePoints(board: Board, boardSize: BoardSize, color: Player): Set<string> {
  const eyePoints = new Set<string>();
  const visited = new Set<string>();

  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (board[row][col] !== null) continue;
      const key = posKey({ row, col });
      if (visited.has(key)) continue;

      const { cells, borderColors } = floodFillEmpty(board, { row, col }, boardSize, visited);
      if (cells.length > EYE_REGION_SIZE_CAP) continue;
      if (borderColors.size !== 1) continue;
      const [owner] = borderColors;
      if (owner !== color) continue;

      for (const cell of cells) eyePoints.add(posKey(cell));
    }
  }

  return eyePoints;
}
