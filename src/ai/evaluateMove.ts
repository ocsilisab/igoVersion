import type { Board, BoardSize, GameState, Player, Position } from "../types/game";
import { getNeighbors, opponent, posKey } from "../utils/board";
import { getGroup } from "../utils/liberties";
import type { ValidAiMove } from "./getValidMoves";

/**
 * Weights are deliberately spaced in orders of magnitude so that a higher-priority
 * consideration always dominates every lower-priority one combined — this reproduces
 * the "priority 1 > 2 > 3 > 4 > 5" behaviour requested for the easy AI using a single
 * additive score instead of a chain of hard filters, which keeps evaluateMove.ts the
 * only place a future (medium/hard) difficulty would need to touch.
 */
const WEIGHTS = {
  capture: 100_000,
  saveGroup: 20_000,
  atariEnemy: 5_000,
  reduceEnemyLiberty: 200,
  ownProximity: 12,
  enemyProximity: 6,
  positional: 1,
} as const;

export interface AiEvalContext {
  boardSize: BoardSize;
  /** posKey -> liberties of that stone's group, for own-color groups with 2 or fewer liberties (before this turn's move). */
  threatenedOwnGroupLiberties: Map<string, number>;
  ownStonePositions: Position[];
  enemyStonePositions: Position[];
}

export function buildEvalContext(gameState: GameState, aiColor: Player): AiEvalContext {
  const { board, boardSize } = gameState;
  const enemyColor = opponent(aiColor);
  const threatenedOwnGroupLiberties = new Map<string, number>();
  const ownStonePositions: Position[] = [];
  const enemyStonePositions: Position[] = [];
  const visited = new Set<string>();

  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      const stone = board[row][col];
      if (stone === null) continue;

      if (stone === aiColor) ownStonePositions.push({ row, col });
      else if (stone === enemyColor) enemyStonePositions.push({ row, col });

      const key = posKey({ row, col });
      if (stone !== aiColor || visited.has(key)) continue;

      const group = getGroup(board, { row, col }, boardSize);
      group.stones.forEach((p) => visited.add(posKey(p)));

      if (group.liberties.size <= 2) {
        group.stones.forEach((p) => threatenedOwnGroupLiberties.set(posKey(p), group.liberties.size));
      }
    }
  }

  return { boardSize, threatenedOwnGroupLiberties, ownStonePositions, enemyStonePositions };
}

function groupIdentity(stones: Position[]): string {
  return stones
    .map(posKey)
    .sort()
    .join("|");
}

function saveGroupScore(move: ValidAiMove, aiColor: Player, ctx: AiEvalContext): number {
  const { resultingBoard, position } = move;
  const considered = new Set<string>();
  let score = 0;

  for (const neighbor of getNeighbors(position, ctx.boardSize)) {
    const key = posKey(neighbor);
    const priorLiberties = ctx.threatenedOwnGroupLiberties.get(key);
    if (priorLiberties === undefined) continue;
    if (resultingBoard[neighbor.row][neighbor.col] !== aiColor) continue;

    const group = getGroup(resultingBoard, neighbor, ctx.boardSize);
    const groupId = groupIdentity(group.stones);
    if (considered.has(groupId)) continue;
    considered.add(groupId);

    if (group.liberties.size > priorLiberties) {
      const urgency = priorLiberties === 1 ? 1.5 : 1;
      score += WEIGHTS.saveGroup * urgency * Math.min(group.liberties.size, 4);
    }
  }

  return score;
}

function pressureEnemyScore(move: ValidAiMove, aiColor: Player, ctx: AiEvalContext): number {
  const enemyColor = opponent(aiColor);
  const { resultingBoard, position } = move;
  const considered = new Set<string>();
  let score = 0;

  for (const neighbor of getNeighbors(position, ctx.boardSize)) {
    if (resultingBoard[neighbor.row][neighbor.col] !== enemyColor) continue;

    const group = getGroup(resultingBoard, neighbor, ctx.boardSize);
    const groupId = groupIdentity(group.stones);
    if (considered.has(groupId)) continue;
    considered.add(groupId);

    if (group.liberties.size === 1) {
      score += WEIGHTS.atariEnemy + group.stones.length * 100;
    } else {
      score += Math.max(0, 4 - group.liberties.size) * WEIGHTS.reduceEnemyLiberty;
    }
  }

  return score;
}

function proximityScore(position: Position, ctx: AiEvalContext): number {
  let score = 0;

  if (ctx.ownStonePositions.length > 0) {
    const minOwnDist = Math.min(
      ...ctx.ownStonePositions.map((p) => Math.abs(p.row - position.row) + Math.abs(p.col - position.col))
    );
    score += WEIGHTS.ownProximity / (1 + minOwnDist);
  }

  if (ctx.enemyStonePositions.length > 0) {
    const minEnemyDist = Math.min(
      ...ctx.enemyStonePositions.map((p) => Math.abs(p.row - position.row) + Math.abs(p.col - position.col))
    );
    score += WEIGHTS.enemyProximity / (1 + minEnemyDist);
  }

  return score;
}

function positionalScore(position: Position, boardSize: BoardSize): number {
  const distFromEdge = Math.min(position.row, position.col, boardSize - 1 - position.row, boardSize - 1 - position.col);

  if (distFromEdge === 0) return -WEIGHTS.positional * 3;
  if (distFromEdge === 1) return WEIGHTS.positional * 1;
  if (distFromEdge <= 3) return WEIGHTS.positional * 3;
  return WEIGHTS.positional * 1;
}

export function evaluateMove(move: ValidAiMove, aiColor: Player, ctx: AiEvalContext): number {
  let score = move.capturedCount * WEIGHTS.capture; // Priority 1: capture

  score += saveGroupScore(move, aiColor, ctx); // Priority 2: save own threatened groups
  score += pressureEnemyScore(move, aiColor, ctx); // Priority 3: pressure / atari enemy groups
  score += proximityScore(move.position, ctx); // Priority 4: play near existing stones
  score += positionalScore(move.position, ctx.boardSize); // Priority 5: general positional value

  return score;
}

export function evaluateMoves(gameState: GameState, aiColor: Player, moves: ValidAiMove[]): { move: ValidAiMove; score: number }[] {
  const ctx = buildEvalContext(gameState, aiColor);
  return moves.map((move) => ({ move, score: evaluateMove(move, aiColor, ctx) }));
}

// Exposed for chooseMove's advanced-game "nothing useful to do" pass heuristic.
export function countStones(board: Board): number {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell !== null) count++;
    }
  }
  return count;
}
