import type { Board, BoardSize, Player, Position } from "../../types/game.js";
import { opponent, posKey } from "../../utils/board.js";
import { getGroup } from "../../utils/liberties.js";
import { tryMove, type MoveResult } from "../../utils/move.js";
import { calculateScore } from "../../utils/scoring.js";
import { advanceHistory } from "./node.js";

/** The subset of MoveResult that pickRolloutMove ever returns — only ever legal moves. */
type LegalMoveResult = Extract<MoveResult, { ok: true }>;

/** Hard cap on a single rollout's length, as a safety net against pathological loops. */
const ROLLOUT_MOVE_CAP_MULTIPLIER = 2;

/**
 * Once the board is at least this full, a "player" in a rollout passes instead of hunting
 * for a fill-in move, as long as there's nothing worth capturing. Without this, a rollout
 * has no notion of "this move is pointless" and happily plays on toward the move cap on
 * every single simulation — which is both slow (every rollout runs maximally long) and
 * noisy (100+ extra near-random moves dilute whatever the position actually decided
 * early on, burying the very signal MCTS is trying to measure).
 */
const ROLLOUT_PASS_OCCUPANCY = 0.7;

/**
 * Cheap capture check: scans the board (no cloning, just reading) for any opponent group
 * already down to one liberty, and returns that liberty — i.e. the move that captures it.
 * This is the one deliberately "heavy" (non-random) bias in an otherwise light playout:
 * real MCTS-for-Go implementations consistently find that biasing rollouts toward capturing
 * moves specifically improves strength far more than biasing anything else.
 */
function findAtariCapture(board: Board, boardSize: BoardSize, player: Player): Position | null {
  const opponentColor = opponent(player);
  const visited = new Set<string>();

  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (board[row][col] !== opponentColor) continue;
      const key = posKey({ row, col });
      if (visited.has(key)) continue;

      const group = getGroup(board, { row, col }, boardSize);
      group.stones.forEach((p) => visited.add(posKey(p)));

      if (group.liberties.size === 1) {
        const [libKey] = group.liberties;
        const [libRow, libCol] = libKey.split(",").map(Number);
        return { row: libRow, col: libCol };
      }
    }
  }

  return null;
}

function countStones(board: Board, boardSize: BoardSize): number {
  let count = 0;
  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (board[row][col] !== null) count++;
    }
  }
  return count;
}

/**
 * Light playout policy: capture an enemy group in atari if one exists (see
 * findAtariCapture); pass once the board is mostly full and there's nothing to capture
 * (see ROLLOUT_PASS_OCCUPANCY); otherwise scan the board once, starting from a random
 * cell and wrapping around, and play the *first* legal move found that doesn't leave the
 * played stone's own group in immediate atari. Stopping at the first acceptable move
 * (instead of comparing every legal move, as an earlier version of this function did) is
 * what makes a rollout step cheap — with the board mostly empty this typically resolves
 * in a handful of tryMove calls rather than up to boardSize² of them.
 */
function pickRolloutMove(board: Board, boardSize: BoardSize, player: Player, history: string[]): LegalMoveResult | null {
  const captureAt = findAtariCapture(board, boardSize, player);
  if (captureAt) {
    const result = tryMove(board, boardSize, player, captureAt, history);
    if (result.ok) return result;
  }

  const totalCells = boardSize * boardSize;
  if (countStones(board, boardSize) / totalCells >= ROLLOUT_PASS_OCCUPANCY) return null;

  const offset = Math.floor(Math.random() * totalCells);
  let fallback: LegalMoveResult | null = null;

  for (let i = 0; i < totalCells; i++) {
    const cell = (offset + i) % totalCells;
    const row = Math.floor(cell / boardSize);
    const col = cell % boardSize;
    if (board[row][col] !== null) continue;

    const result = tryMove(board, boardSize, player, { row, col }, history);
    if (!result.ok) continue;

    if (!fallback) fallback = result; // remember the first legal move in case nothing is "safe"

    const group = getGroup(result.board, { row, col }, boardSize);
    if (group.liberties.size > 1) return result; // first safe move — take it immediately
  }

  return fallback; // every legal move self-ataris (or there were none) — null means "pass"
}

/**
 * Plays a full game to the end from the given position using `pickRolloutMove` for both
 * sides, and returns who won — scored the same way computer-Go rollouts conventionally
 * are: stones + surrounded territory only (Tromp-Taylor style, capture counts passed as
 * 0). This is a standard, accepted simplification for evaluating a simulation's outcome,
 * not a scoring bug: in area scoring a captured stone's point almost always ends up
 * counted as the capturing color's territory anyway (see utils/scoring.ts::calculateScore
 * — the real end-of-game score, shown to players, is computed separately and does account
 * for captures via the dead-stone-marking flow).
 */
export function rollout(
  board: Board,
  boardSize: BoardSize,
  history: string[],
  toMove: Player,
  consecutivePasses: number,
  komi: number
): Player | "draw" {
  let currentBoard = board;
  let currentHistory = history;
  let currentPlayer = toMove;
  let passes = consecutivePasses;
  let movesPlayed = 0;
  const moveCap = boardSize * boardSize * ROLLOUT_MOVE_CAP_MULTIPLIER;

  while (passes < 2 && movesPlayed < moveCap) {
    const result = pickRolloutMove(currentBoard, boardSize, currentPlayer, currentHistory);

    if (result === null) {
      passes++;
    } else {
      currentBoard = result.board;
      currentHistory = advanceHistory(currentHistory, result.boardState);
      passes = 0;
    }

    currentPlayer = opponent(currentPlayer);
    movesPlayed++;
  }

  return calculateScore(currentBoard, boardSize, 0, 0, komi).winner;
}
