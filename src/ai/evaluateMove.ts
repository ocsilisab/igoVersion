import type { BoardSize, GameState, Player, Position } from "../types/game";
import { getNeighbors, opponent, posKey } from "../utils/board";
import { findRealEyePoints } from "../utils/eyes";
import { getGroup } from "../utils/liberties";
import type { ValidAiMove } from "./getValidMoves";

/**
 * Weights are deliberately spaced in orders of magnitude so that a higher-priority
 * consideration always dominates every lower-priority one combined — this reproduces
 * the "priority 1 > 2 > 3 > ... > 6" behaviour requested for the easy AI using a single
 * additive score instead of a chain of hard filters, which keeps evaluateMove.ts the
 * only place a future (medium/hard) difficulty would need to touch.
 */
const WEIGHTS = {
  capture: 100_000,
  selfEyeFill: -80_000,
  saveGroup: 20_000,
  atariEnemy: 5_000,
  reduceEnemyLiberty: 200,
  groupStrength: 150,
  ownProximity: 12,
  enemyProximity: 6,
  positional: 1,
} as const;

/** Liberty counts above this stop adding further group-strength reward — an 8-liberty
 * group is already about as safe as it needs to be; anything past that is diminishing
 * returns this heuristic doesn't need to keep chasing. */
const GROUP_STRENGTH_LIBERTY_CAP = 8;

export interface AiEvalContext {
  boardSize: BoardSize;
  /** posKey -> liberties of that stone's group, for own-color groups with 2 or fewer liberties (before this turn's move). */
  threatenedOwnGroupLiberties: Map<string, number>;
  ownStonePositions: Position[];
  enemyStonePositions: Position[];
  /** posKeys that are real eye points for aiColor — see utils/eyes.ts. */
  ownEyePoints: Set<string>;
  /** posKeys that are real eye points for the opponent. */
  enemyEyePoints: Set<string>;
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

  return {
    boardSize,
    threatenedOwnGroupLiberties,
    ownStonePositions,
    enemyStonePositions,
    ownEyePoints: findRealEyePoints(board, boardSize, aiColor),
    enemyEyePoints: findRealEyePoints(board, boardSize, enemyColor),
  };
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
      continue;
    }

    // A group with 2+ of its remaining liberties inside its own real eye points is
    // unconditionally alive (see utils/eyes.ts) — chasing its other liberties from here
    // on is just dame, not a real threat, so it stops earning the pressure bonus below.
    // Below 2, it's still genuinely killable and reducing it further is worth rewarding.
    const realEyeLiberties = [...group.liberties].filter((lib) => ctx.enemyEyePoints.has(lib)).length;
    if (realEyeLiberties >= 2) continue;

    score += Math.max(0, 4 - group.liberties.size) * WEIGHTS.reduceEnemyLiberty;
  }

  return score;
}

/** True when `position` is one of aiColor's own real eye points — see utils/eyes.ts. */
function isSelfEyeFill(position: Position, ctx: AiEvalContext): boolean {
  return ctx.ownEyePoints.has(posKey(position));
}

/**
 * Rewards ending up in a strong, well-connected group rather than a weak, isolated one:
 * scores the *resulting* group's liberty count after the move (capped — see
 * GROUP_STRENGTH_LIBERTY_CAP). A stone that connects to friendly stones nearby, or
 * especially one that merges two previously-separate own groups into one, ends up with
 * far more liberties than an isolated stone dropped into empty space would — so this
 * naturally favors building on what's already there over scattering new weak groups,
 * without needing to special-case "is this a merge" directly. Applies to every move, not
 * just defensive ones (see saveGroupScore for the separate, much larger bonus reserved
 * for groups that were already in real danger).
 */
function groupStrengthScore(move: ValidAiMove, ctx: AiEvalContext): number {
  const group = getGroup(move.resultingBoard, move.position, ctx.boardSize);
  return Math.min(group.liberties.size, GROUP_STRENGTH_LIBERTY_CAP) * WEIGHTS.groupStrength;
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
  score += groupStrengthScore(move, ctx); // Priority 4: build strong, connected groups
  score += proximityScore(move.position, ctx); // Priority 5: play near existing stones
  score += positionalScore(move.position, ctx.boardSize); // Priority 6: general positional value

  // Filling your own real eye is (at best) a wasted move and can turn a two-eyed group
  // into a one-eyed one — heavily discouraged regardless of what the priorities above
  // computed, short of it being the only legal move left (chooseMove.ts still picks
  // *something* even if every candidate scores this low).
  if (isSelfEyeFill(move.position, ctx)) score += WEIGHTS.selfEyeFill;

  return score;
}

export function evaluateMoves(gameState: GameState, aiColor: Player, moves: ValidAiMove[]): { move: ValidAiMove; score: number }[] {
  const ctx = buildEvalContext(gameState, aiColor);
  return moves.map((move) => ({ move, score: evaluateMove(move, aiColor, ctx) }));
}
