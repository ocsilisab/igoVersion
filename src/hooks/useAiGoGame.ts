import { useEffect, useRef, useState } from "react";
import type { AiDifficulty, BoardSize, ExtensionRules, Player, Position, TeamRoster } from "../types/game";
import { DEFAULT_AI_DIFFICULTY, NO_EXTENSIONS } from "../types/game";
import { opponent } from "../utils/board";
import type { TimeControl } from "../utils/clock";
import { useGoGame } from "./useGoGame";
import { useMctsWorker } from "./useMctsWorker";
import { chooseAiMove } from "../ai/chooseMove";
import { mctsTimeBudgetMs } from "../ai/mcts/chooseMctsMove";
import { chooseNeuralMove } from "../ai/neural/chooseNeuralMove";

const AI_MIN_THINK_MS = 500;
const AI_MAX_THINK_MS = 1000;
const AI_ROSTER = ["IA"];

/**
 * Wraps `useGoGame` (unchanged, still used as-is by the local two-player mode) and
 * auto-plays for `aiColor` whenever it's that color's turn, then feeds the chosen move
 * through the same `placeStone` / `pass` calls a human player would use, so it goes
 * through identical validation. The AI's own team is always a single "IA" seat — only
 * the human side can have teammates.
 *
 * "Fácil" (ai/chooseMove.ts) is synchronous and near-instant, so it runs on the main
 * thread behind a short cosmetic "thinking" delay. "Difícil" (ai/mcts/) runs a real,
 * multi-second search — see useMctsWorker.ts — inside a Web Worker, so that search never
 * blocks the UI thread the way it did before Fase 3. "Experta" (ai/neural/) calls the
 * standalone Python inference service over HTTP and falls back to "Fácil" if that
 * request fails for any reason (service not running, network error, etc.).
 */
export function useAiGoGame(
  initialSize: BoardSize,
  aiColor: Player,
  initialKomi: number,
  humanNames: string[],
  initialExtensions: ExtensionRules = NO_EXTENSIONS,
  difficulty: AiDifficulty = DEFAULT_AI_DIFFICULTY,
  timeControl: TimeControl | null = null
) {
  const teams: TeamRoster = aiColor === "black" ? { black: AI_ROSTER, white: humanNames } : { black: humanNames, white: AI_ROSTER };
  // Only the human's side ever gets a clock -- the AI never consumes time or times out,
  // regardless of how long "Dificil"/"Experta" actually take to pick a move.
  const game = useGoGame(initialSize, initialKomi, teams, initialExtensions, timeControl, [opponent(aiColor)]);
  const { state, placeStone, pass } = game;
  const [isAiThinking, setIsAiThinking] = useState(false);
  const isThinkingRef = useRef(false);
  const requestMctsMove = useMctsWorker();

  useEffect(() => {
    if (state.gameOver || state.isScoring) return;
    if (state.currentPlayer !== aiColor) return;
    if (isThinkingRef.current) return;

    isThinkingRef.current = true;
    setIsAiThinking(true);
    let cancelled = false;

    const finish = (move: Position | null) => {
      if (cancelled) return;
      if (move) placeStone(move);
      else pass();
      isThinkingRef.current = false;
      setIsAiThinking(false);
    };

    if (difficulty === "dificil") {
      void requestMctsMove(
        {
          board: state.board,
          boardSize: state.boardSize,
          // Only the last 2 board states are ever read (Ko-checking) — trimming here
          // keeps the postMessage payload small even deep into a long game instead of
          // structured-cloning the whole move history on every single AI turn.
          history: state.history.slice(-2),
          toMove: aiColor,
          consecutivePasses: state.consecutivePasses,
          komi: state.komi,
        },
        mctsTimeBudgetMs(state.boardSize)
      ).then(finish);

      return () => {
        cancelled = true;
        isThinkingRef.current = false;
        setIsAiThinking(false);
      };
    }

    if (difficulty === "experta") {
      chooseNeuralMove(state, aiColor)
        .catch((error) => {
          // The neural service is a separate local process the developer has to start
          // themselves — if it's down or a single request fails, fall back to "facil"
          // rather than stalling the game on an AI turn that will never resolve.
          console.warn("IA neuronal no disponible, usando la IA facil para esta jugada:", error);
          return chooseAiMove(state, aiColor);
        })
        .then(finish);

      return () => {
        cancelled = true;
        isThinkingRef.current = false;
        setIsAiThinking(false);
      };
    }

    const delay = AI_MIN_THINK_MS + Math.random() * (AI_MAX_THINK_MS - AI_MIN_THINK_MS);
    const timer = window.setTimeout(() => finish(chooseAiMove(state, aiColor)), delay);

    return () => {
      window.clearTimeout(timer);
      isThinkingRef.current = false;
      setIsAiThinking(false);
    };
  }, [state, aiColor, placeStone, pass, difficulty, requestMctsMove]);

  return { ...game, isAiThinking };
}
