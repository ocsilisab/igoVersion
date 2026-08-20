import type { BoardSize, GameState, Player, Position } from "../../types/game.js";
import { runMcts } from "./search.js";

/**
 * Thinking-time budget for the "Difícil" AI, per board size — this is what tunes its
 * strength (see Fase 1 validation notes: with light random-biased rollouts, low-material
 * tactics need on the order of thousands of simulations before their signal clearly
 * separates from noise). Larger boards need proportionally more time for comparable
 * quality: both the branching factor (legal moves per ply) and typical rollout length
 * grow with board size, so a fixed budget would let "Difícil" degrade noticeably on
 * 13x13/19x19 relative to 9x9. Fase 3 moved the search into a Web Worker, so raising
 * these no longer costs any UI responsiveness — only how long a move takes to arrive.
 */
const MCTS_TIME_BUDGET_BY_SIZE: Record<BoardSize, number> = {
  9: 3000,
  13: 6000,
  19: 9000,
};

export function mctsTimeBudgetMs(boardSize: BoardSize): number {
  return MCTS_TIME_BUDGET_BY_SIZE[boardSize];
}

/**
 * Public entry point for the MCTS engine — deliberately the same signature shape as
 * ai/chooseMove.ts's chooseAiMove(gameState, aiColor). Not currently called by the app
 * itself (hooks/useAiGoGame.ts talks to the Web Worker directly — see
 * hooks/useMctsWorker.ts — since runMcts is synchronous and would block if called here
 * on the main thread), but kept as the module's documented synchronous entry point for
 * scripts/tests that don't need a worker.
 */
export function chooseMctsMove(gameState: GameState, aiColor: Player): Position | null {
  if (gameState.gameOver) return null;

  return runMcts(
    {
      board: gameState.board,
      boardSize: gameState.boardSize,
      history: gameState.history.slice(-2),
      toMove: aiColor,
      consecutivePasses: gameState.consecutivePasses,
      komi: gameState.komi,
    },
    mctsTimeBudgetMs(gameState.boardSize)
  );
}
