import type { BoardSize, GameState, Player, Position } from "../../types/game.js";
import { getValidMoves } from "../getValidMoves.js";
import { bestBeneficialMove, isGameEffectivelyOver, lifeAwareMargin, MIN_BENEFICIAL_MARGIN } from "../detectGameEnd.js";

/**
 * HTTP client for the standalone Python inference service (ai-service/, see its
 * src/service.py) — a PyTorch policy network trained on 7-9 dan games. Unlike the local
 * "facil" heuristic and the in-browser "dificil" MCTS worker, this AI runs as a separate
 * process the developer starts themselves (`uvicorn src.service:app`); the app never
 * bundles or loads PyTorch.
 *
 * The service can hold more than one checkpoint at once, keyed by board size (see
 * service.py's `ModelState.models`). As of writing it has real, natively-trained
 * checkpoints for all three supported sizes (9x9, 13x13, 19x19). Any size that ever
 * lacked one falls back to embed_in_canvas (see ai-service/src/adapters/game_adapter.py):
 * the smaller board is placed in a corner of a virtual 19x19 canvas before being handed
 * to the 19x19 model, since that model's final layer is sized for exactly 19x19 and can't
 * accept any other input shape at all. This is a best-effort adaptation, not an
 * equivalent one — the 19x19 model has never seen a real game at the fallback size, so
 * expect visibly weaker play there than on a size it was actually trained for. See
 * `checkNeuralServiceHealth`'s `nativeBoardSizes` for which sizes currently avoid the
 * fallback (GameSetup.tsx checks this live rather than assuming it from this comment).
 */
export const NEURAL_AI_SUPPORTED_BOARD_SIZES: readonly BoardSize[] = [9, 13, 19];

export interface NeuralServiceHealth {
  available: boolean;
  /** Board sizes the service currently has a natively-trained checkpoint for. */
  nativeBoardSizes: readonly BoardSize[];
}

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
async function probeOnce(timeoutMs: number): Promise<NeuralServiceHealth | null> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${serviceUrl()}/health`, { signal: controller.signal });
    window.clearTimeout(timer);
    if (!response.ok) return null;
    const body = (await response.json()) as { model_loaded?: boolean; models_loaded?: BoardSize[] };
    if (body.model_loaded !== true) return null;
    return { available: true, nativeBoardSizes: body.models_loaded ?? [] };
  } catch {
    return null;
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
export async function checkNeuralServiceHealth(
  totalBudgetMs = 75_000,
  attemptTimeoutMs = 8_000
): Promise<NeuralServiceHealth> {
  const deadline = Date.now() + totalBudgetMs;

  while (true) {
    const result = await probeOnce(attemptTimeoutMs);
    if (result) return result;
    if (Date.now() >= deadline) return { available: false, nativeBoardSizes: [] };
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
 *
 * Getting past that check only means *some* legal move still gains something — it doesn't
 * mean the network's own top pick is that move. Real professional game records essentially
 * never show the actual dame-filling sequence at all (the exporting server stops recording
 * at the last stone that mattered — see ai-service/config.yaml's dataset notes), so the
 * network has barely any training signal for "which neutral point to take" and can pick
 * one that gains nothing (e.g. filling its own already-settled territory) while a real
 * point sits unclaimed elsewhere. This is caught below by checking the network's own
 * choice against the same margin isGameEffectivelyOver uses, and overridden with
 * bestBeneficialMove only when the network's pick provably gained nothing — never merely
 * because a bigger margin existed elsewhere, which would second-guess real reading/shape
 * judgment the margin heuristic can't do.
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
  const networkMove = body.move;

  const before = lifeAwareMargin(gameState.board, gameState.boardSize, aiColor, 0, gameState.komi);
  const networkCandidate = networkMove
    ? moves.find((m) => m.position.row === networkMove.row && m.position.col === networkMove.col)
    : null;
  const networkMargin = networkCandidate
    // 0, not networkCandidate.capturedCount -- see detectGameEnd.ts::isGameEffectivelyOver's
    // docstring: passing the real capture count here would double-count a group
    // findHopelessEnemyGroups already wrote off, making "finish the kill on a group
    // that's already dead" look like a real gain and never trigger the override below.
    ? lifeAwareMargin(networkCandidate.resultingBoard, gameState.boardSize, aiColor, 0, gameState.komi) - before
    : 0; // the network chose to pass (or, defensively, an unrecognized point) -- same as "gains nothing"

  if (networkMargin < MIN_BENEFICIAL_MARGIN) {
    const better = bestBeneficialMove(gameState.board, gameState.boardSize, gameState.komi, aiColor, moves);
    if (better) return better.position;
  }

  return networkMove;
}
