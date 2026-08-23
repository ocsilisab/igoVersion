import type { GameState, Player, Position } from "../types/game";
import { getValidMoves } from "./getValidMoves";
import { evaluateMoves } from "./evaluateMove";
import { isGameEffectivelyOver } from "./detectGameEnd";

/** Any move within this margin of the best score is treated as "similarly good" for randomization. */
const RANDOMNESS_MARGIN = 4;

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
  if (isGameEffectivelyOver(gameState.board, gameState.boardSize, gameState.komi, aiColor, moves)) return null;

  const scored = evaluateMoves(gameState, aiColor, moves).sort((a, b) => b.score - a.score);

  return pickWithRandomness(scored);
}
