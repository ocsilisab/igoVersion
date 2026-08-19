import type { Board, BoardSize, Player, Position } from "../types/game.js";
import { cloneBoard, getNeighbors, opponent } from "./board.js";
import { getGroup } from "./liberties.js";
import { removeDeadGroups } from "./capture.js";
import { isHoshiPosition } from "./hoshi.js";

/** Moves between random bomb drops when the "bombas" extension is on. */
export const BOMB_INTERVAL = 20;

export interface HoshiConversionResult {
  board: Board;
  convertedHoshi: Position[];
  extraCaptured: number;
}

/**
 * "Estrellas" extension: any empty hoshi point orthogonally adjacent to the stone just
 * played automatically becomes a stone of the same color too. A conversion that would
 * leave the resulting group with zero liberties (a self-atari the player never chose) is
 * skipped rather than applied — it can still legitimately capture an enemy group, just
 * never suicide.
 */
export function applyHoshiConversion(
  board: Board,
  boardSize: BoardSize,
  movePos: Position,
  player: Player
): HoshiConversionResult {
  let working = board;
  const convertedHoshi: Position[] = [];
  let extraCaptured = 0;
  const opponentColor = opponent(player);

  const candidates = getNeighbors(movePos, boardSize).filter(
    (n) => working[n.row][n.col] === null && isHoshiPosition(n, boardSize)
  );

  for (const hoshi of candidates) {
    const candidateBoard = cloneBoard(working);
    candidateBoard[hoshi.row][hoshi.col] = player;

    const { board: afterCapture, capturedCount } = removeDeadGroups(candidateBoard, opponentColor, boardSize);
    const group = getGroup(afterCapture, hoshi, boardSize);
    if (group.liberties.size === 0) continue;

    working = afterCapture;
    convertedHoshi.push(hoshi);
    extraCaptured += capturedCount;
  }

  return { board: working, convertedHoshi, extraCaptured };
}

export interface BombDropResult {
  board: Board;
  center: Position;
  affected: Position[];
}

/**
 * "Bombas" extension: clears a random point plus its orthogonal neighbors. Only ever
 * removes stones, so it can never create a suicide/zero-liberty state for a surviving
 * group — removing stones can only add liberties to whatever's left standing.
 */
export function dropBomb(board: Board, boardSize: BoardSize): BombDropResult {
  const center: Position = {
    row: Math.floor(Math.random() * boardSize),
    col: Math.floor(Math.random() * boardSize),
  };
  const affected = [center, ...getNeighbors(center, boardSize)];

  const working = cloneBoard(board);
  for (const pos of affected) {
    working[pos.row][pos.col] = null;
  }

  return { board: working, center, affected };
}
