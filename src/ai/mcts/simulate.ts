import type { Board, BoardSize, Player, Position } from "../../types/game.js";
import { opponent, posKey } from "../../utils/board.js";
import { findRealEyePoints } from "../../utils/eyes.js";
import { getGroup } from "../../utils/liberties.js";
import { tryMove, type MoveResult } from "../../utils/move.js";
import { calculateScore } from "../../utils/scoring.js";
import { advanceHistory } from "./node.js";

/** The subset of MoveResult that pickRolloutMove ever returns — only ever legal moves. */
type LegalMoveResult = Extract<MoveResult, { ok: true }>;

/** Hard cap on a single rollout's length, as a safety net against pathological loops. */
const ROLLOUT_MOVE_CAP_MULTIPLIER = 2;

/**
 * How many safe (non-self-atari, non-own-eye) candidate moves pickRolloutMove looks at
 * before picking the one that leaves the strongest (highest-liberty) resulting group,
 * instead of just taking literally the first one found. A small, fixed sample keeps a
 * rollout step cheap (still nowhere near comparing every legal move) while biasing
 * playouts toward connecting to and building on existing stones rather than scattering
 * new weak, isolated ones — the same "build strong, connected groups" instinct the
 * "Fácil" heuristic gets from evaluateMove.ts's groupStrengthScore, applied here so
 * simulated games play out in a way that actually reflects it.
 */
const ROLLOUT_CANDIDATE_SAMPLE_SIZE = 5;

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
 * cell and wrapping around, and play the strongest of the first few safe candidates
 * found — skipping the player's own real eye points entirely (see findRealEyePoints) —
 * that don't leave the played stone's own group in immediate atari. Stopping the scan
 * after ROLLOUT_CANDIDATE_SAMPLE_SIZE safe candidates (instead of comparing every legal
 * move, as an earlier version of this function did) is what keeps a rollout step cheap —
 * with the board mostly empty this typically still resolves in a handful of tryMove
 * calls rather than up to boardSize² of them.
 *
 * Never filling your own eyes is one of the best-known, highest-value fixes for a naive
 * Monte Carlo rollout policy: an eye point "counts" for scoring/life whether or not a
 * stone actually sits there, so a rollout that doesn't know this will happily fill both
 * players' eye spaces in on the way to the move cap — corrupting exactly the life-and-death
 * signal MCTS most needs rollouts to get right. If literally every remaining legal move
 * is one of the player's own eyes, this passes instead (see the final fallback below)
 * rather than force one — that's precisely the "nothing left to prove" case a human
 * passes on too.
 */
function pickRolloutMove(board: Board, boardSize: BoardSize, player: Player, history: string[]): LegalMoveResult | null {
  const captureAt = findAtariCapture(board, boardSize, player);
  if (captureAt) {
    const result = tryMove(board, boardSize, player, captureAt, history);
    if (result.ok) return result;
  }

  const totalCells = boardSize * boardSize;
  if (countStones(board, boardSize) / totalCells >= ROLLOUT_PASS_OCCUPANCY) return null;

  const ownEyes = findRealEyePoints(board, boardSize, player);

  const offset = Math.floor(Math.random() * totalCells);
  let fallback: LegalMoveResult | null = null;
  let bestSafe: LegalMoveResult | null = null;
  let bestSafeLiberties = 0;
  let safeCount = 0;

  for (let i = 0; i < totalCells && safeCount < ROLLOUT_CANDIDATE_SAMPLE_SIZE; i++) {
    const cell = (offset + i) % totalCells;
    const row = Math.floor(cell / boardSize);
    const col = cell % boardSize;
    if (board[row][col] !== null) continue;
    if (ownEyes.has(posKey({ row, col }))) continue; // never fill your own eye while any other legal move exists

    const result = tryMove(board, boardSize, player, { row, col }, history);
    if (!result.ok) continue;

    if (!fallback) fallback = result; // remember the first non-eye legal move in case nothing is "safe"

    const group = getGroup(result.board, { row, col }, boardSize);
    if (group.liberties.size <= 1) continue;

    safeCount++;
    if (group.liberties.size > bestSafeLiberties) {
      bestSafeLiberties = group.liberties.size;
      bestSafe = result;
    }
  }

  return bestSafe ?? fallback; // no safe move sampled — fall back to a self-atari move, or none at all
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
