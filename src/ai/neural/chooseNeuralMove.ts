import type { GameState, Player, Position } from "../../types/game.js";

/**
 * HTTP client for the standalone Python inference service (ai-service/, see its
 * src/service.py) — a PyTorch policy network trained on 7-9 dan games. Unlike the local
 * "facil" heuristic and the in-browser "dificil" MCTS worker, this AI runs as a separate
 * process the developer starts themselves (`uvicorn src.service:app`); the app never
 * bundles or loads PyTorch. Only trained for 19x19 boards — see NEURAL_AI_BOARD_SIZE.
 */
export const NEURAL_AI_BOARD_SIZE = 19;

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

/**
 * Reachability probe — GameSetup.tsx uses this to decide whether to offer "Experta" at
 * all, instead of only failing once the game has already started. The default timeout is
 * long enough to cover a cold start on Render's free tier (the service spins down after
 * ~15 minutes idle and can take 30-50s to wake back up on the next request) — a short
 * timeout here would report "unavailable" for a service that's simply still waking up.
 */
export async function checkNeuralServiceHealth(timeoutMs = 60_000): Promise<boolean> {
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
 * Asks the neural service for its top move given the current position. Throws on any
 * network/HTTP failure — useAiGoGame.ts catches this and falls back to the "facil"
 * heuristic so a single unreachable request never stalls the game.
 */
export async function chooseNeuralMove(gameState: GameState, aiColor: Player): Promise<Position | null> {
  if (gameState.boardSize !== NEURAL_AI_BOARD_SIZE) {
    throw new Error(`El servicio de IA neuronal solo soporta tableros de ${NEURAL_AI_BOARD_SIZE}x${NEURAL_AI_BOARD_SIZE}.`);
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
