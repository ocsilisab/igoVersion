import type { BoardSize, GameState, Player, Position } from "../../types/game.js";
import { getValidMoves } from "../getValidMoves.js";
import { isGameEffectivelyOver } from "../detectGameEnd.js";

/**
 * HTTP client for the standalone Python inference service (ai-service/, see its
 * src/service.py) — a PyTorch policy network trained on 7-9 dan games. Unlike the local
 * "facil" heuristic and the in-browser "dificil" MCTS worker, this AI runs as a separate
 * process the developer starts themselves (`uvicorn src.service:app`); the app never
 * bundles or loads PyTorch.
 *
 * There is only ever the one checkpoint, trained on 19x19 games. 9x9 and 13x13 run via
 * the service's embed_in_canvas (see ai-service/src/adapters/game_adapter.py): the
 * smaller board is placed in a corner of a virtual 19x19 canvas before being handed to
 * the same model, since its final layer is sized for exactly 19x19 and can't accept any
 * other input shape at all. This is a best-effort adaptation, not an equivalent one — the
 * model has never seen a real 9x9/13x13 game (everything it learned came from full-board
 * 19x19 professional games), so expect visibly weaker play on the smaller sizes than on
 * 19x19 itself.
 */
export const NEURAL_AI_SUPPORTED_BOARD_SIZES: readonly BoardSize[] = [9, 13, 19];

const DEFAULT_SERVICE_URL = "http://localhost:8000";

function serviceUrl(): string {
  const fromEnv = import.meta.env.VITE_AI_SERVICE_URL as string | undefined;
  return (fromEnv && fromEnv.trim()) || DEFAULT_SERVICE_URL;
}

interface MoveResponseBody {
  move: Position | null;
  probability: number;
  top_moves: { move: Position | null; probability: number }[];
}

/** One fetch attempt against /health, with its own timeout. Never throws. */
async function probeOnce(timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${serviceUrl()}/health`, { signal: controller.signal });
    window.clearTimeout(timer);
    if (!response.ok) return false;
    const body = (await response.json()) as { model_loaded?: boolean };
    return body.model_loaded === true;
  } catch {
    return false;
  }
}

/**
 * Reachability probe — GameSetup.tsx uses this to decide whether to offer "Experta" at
 * all, instead of only failing once the game has already started.
 *
 * Retries several shorter attempts instead of holding one single long-lived connection
 * open: a cold start on Render's free tier (the service spins down after ~15 minutes idle
 * and can take 30-50s to wake back up) needs *some* request to eventually get through, but
 * a single fetch held open for the full wait is exactly the shape of request some mobile
 * networks and carrier proxies silently kill after 20-30s of apparent inactivity — killing
 * it right as the cold dyno was about to answer. Re-issuing a fresh short-lived request
 * every few seconds gives every attempt a real chance to land in a mobile browser too, and
 * costs nothing extra once the service is already warm (the very first attempt succeeds).
 */
export async function checkNeuralServiceHealth(totalBudgetMs = 75_000, attemptTimeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + totalBudgetMs;

  while (true) {
    if (await probeOnce(attemptTimeoutMs)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
}

/**
 * Asks the neural service for its top move given the current position. Throws on any
 * network/HTTP failure — useAiGoGame.ts catches this and falls back to the "facil"
 * heuristic so a single unreachable request never stalls the game.
 *
 * Before ever calling the network, this defers to the same rule-based endgame check the
 * heuristic AIs use (see ai/detectGameEnd.ts): the policy network was trained by imitating
 * professional games, the vast majority of which end by resignation rather than an actual
 * double pass, so it rarely saw "pass" as the right answer and doesn't reliably predict it
 * even once the position is fully settled. Running isGameEffectivelyOver first means
 * "Experta" passes correctly regardless of what the model itself would have guessed, and
 * skips an unnecessary request to the (possibly cold) hosted service in that case too.
 */
export async function chooseNeuralMove(gameState: GameState, aiColor: Player): Promise<Position | null> {
  if (!NEURAL_AI_SUPPORTED_BOARD_SIZES.includes(gameState.boardSize)) {
    throw new Error(`El servicio de IA neuronal no soporta tableros de ${gameState.boardSize}x${gameState.boardSize}.`);
  }

  const moves = getValidMoves(gameState, aiColor);
  if (isGameEffectivelyOver(gameState.board, gameState.boardSize, gameState.komi, aiColor, moves)) {
    return null;
  }

  const response = await fetch(`${serviceUrl()}/ai/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      board: gameState.board,
      board_size: gameState.boardSize,
      current_player: aiColor,
      recent_moves: gameState.recentMoves,
      history: gameState.history,
      top_n: 5,
    }),
  });

  if (!response.ok) {
    throw new Error(`El servicio de IA neuronal respondio ${response.status}`);
  }

  const body = (await response.json()) as MoveResponseBody;
  return body.move;
}
