import type { GameState, Player, Position } from "../types/game";
import { getValidMoves } from "./getValidMoves";
import { countStones, evaluateMoves } from "./evaluateMove";

/** Board must be at least this full before the AI considers passing instead of playing. */
const ADVANCED_GAME_OCCUPANCY_RATIO = 0.65;
/** Below this score a move is pure filler (no capture, no defense, no threat, barely positional). */
const MIN_REASONABLE_SCORE = 3;
/** Any move within this margin of the best score is treated as "similarly good" for randomization. */
const RANDOMNESS_MARGIN = 4;

function shouldPass(gameState: GameState, bestScore: number): boolean {
  const totalCells = gameState.boardSize * gameState.boardSize;
  const occupancyRatio = countStones(gameState.board) / totalCells;
  return occupancyRatio >= ADVANCED_GAME_OCCUPANCY_RATIO && bestScore < MIN_REASONABLE_SCORE;
}

function pickWithRandomness(scored: { move: { position: Position }; score: number }[]): Position {
  const best = scored[0].score;
  const topChoices = scored.filter((s) => s.score >= best - RANDOMNESS_MARGIN);
  const pick = topChoices[Math.floor(Math.random() * topChoices.length)];
  return pick.move.position;
}

/**
 * Chooses the AI's next move for `aiColor` given the current game state, or `null` to pass.
 * Every candidate is a fully legal move (validated through the same rule engine the human
 * player uses); this function only ranks them. Board/hook state is never mutated here.
 */
export function chooseAiMove(gameState: GameState, aiColor: Player): Position | null {
  if (gameState.gameOver) return null;

  const moves = getValidMoves(gameState, aiColor);
  if (moves.length === 0) return null;

  const scored = evaluateMoves(gameState, aiColor, moves).sort((a, b) => b.score - a.score);

  if (shouldPass(gameState, scored[0].score)) return null;

  return pickWithRandomness(scored);
}
