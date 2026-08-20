import type { GameState, Player, Position } from "../../types/game.js";
import { runMcts } from "./search.js";

/**
 * Thinking-time budget for the "Difícil" AI — this single number is what tunes its
 * strength (see Fase 1 validation notes in mcts-check.ts / project chat log): with light
 * random-biased rollouts, low-material tactics need on the order of thousands of
 * simulations before their signal clearly separates from noise, so this errs generous.
 * Once Fase 3 moves the search into a Web Worker (so it stops blocking the UI thread),
 * this can be raised further — see Fase 4's per-board-size calibration.
 */
export const MCTS_TIME_BUDGET_MS = 3000;

/**
 * Public entry point for the MCTS engine — deliberately the same signature shape as
 * ai/chooseMove.ts's chooseAiMove(gameState, aiColor), so useAiGoGame.ts's difficulty
 * switch (see hooks/useAiGoGame.ts::pickEngine) can route to either one without any
 * other code changes.
 */
export function chooseMctsMove(gameState: GameState, aiColor: Player): Position | null {
  if (gameState.gameOver) return null;

  return runMcts(
    {
      board: gameState.board,
      boardSize: gameState.boardSize,
      history: gameState.history,
      toMove: aiColor,
      consecutivePasses: gameState.consecutivePasses,
      komi: gameState.komi,
    },
    MCTS_TIME_BUDGET_MS
  );
}
