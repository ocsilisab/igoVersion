import type { Board, BoardSize, Player, Position, ScoreResult } from "../types/game.js";
import { cloneBoard, getNeighbors, posKey } from "./board.js";

export interface RemoveDeadStonesResult {
  board: Board;
  deadBlack: number;
  deadWhite: number;
}

/**
 * Removes every stone whose posKey is in `deadStones` from the board, returning the
 * cleaned board plus how many stones of each color were removed — those counts become
 * captures for the opponent when the final score is calculated.
 */
export function removeDeadStones(board: Board, deadStones: Set<string>): RemoveDeadStonesResult {
  const cleaned = cloneBoard(board);
  let deadBlack = 0;
  let deadWhite = 0;

  for (const key of deadStones) {
    const [row, col] = key.split(",").map(Number);
    const stone = cleaned[row][col];
    if (stone === "black") deadBlack++;
    else if (stone === "white") deadWhite++;
    if (stone !== null) cleaned[row][col] = null;
  }

  return { board: cleaned, deadBlack, deadWhite };
}

interface EmptyRegion {
  region: Position[];
  borderColors: Set<Player>;
}

function floodFillEmptyRegion(board: Board, start: Position, size: BoardSize, visited: Set<string>): EmptyRegion {
  const region: Position[] = [];
  const borderColors = new Set<Player>();
  const stack: Position[] = [start];
  visited.add(posKey(start));

  while (stack.length > 0) {
    const pos = stack.pop()!;
    region.push(pos);

    for (const neighbor of getNeighbors(pos, size)) {
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

  return { region, borderColors };
}

/**
 * Simple area-style scoring: stones on the board + surrounded territory + captures.
 * Territory is only awarded to a connected region of empty points bordered by exactly one color;
 * regions touching both colors (or no stones at all) are neutral.
 */
export function calculateScore(
  board: Board,
  size: BoardSize,
  blackCaptures: number,
  whiteCaptures: number
): ScoreResult {
  let blackStones = 0;
  let whiteStones = 0;
  let blackTerritory = 0;
  let whiteTerritory = 0;
  const visited = new Set<string>();

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const stone = board[row][col];

      if (stone === "black") {
        blackStones++;
        continue;
      }
      if (stone === "white") {
        whiteStones++;
        continue;
      }

      const key = posKey({ row, col });
      if (visited.has(key)) continue;

      const { region, borderColors } = floodFillEmptyRegion(board, { row, col }, size, visited);
      if (borderColors.size === 1) {
        const [owner] = borderColors;
        if (owner === "black") blackTerritory += region.length;
        else whiteTerritory += region.length;
      }
    }
  }

  const blackScore = blackStones + blackTerritory + blackCaptures;
  const whiteScore = whiteStones + whiteTerritory + whiteCaptures;

  let winner: Player | "draw";
  if (blackScore > whiteScore) winner = "black";
  else if (whiteScore > blackScore) winner = "white";
  else winner = "draw";

  return {
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
    blackCaptures,
    whiteCaptures,
    blackScore,
    whiteScore,
    winner,
  };
}
