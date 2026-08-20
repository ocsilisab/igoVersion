import { useEffect, useRef, useState } from "react";
import type { AiDifficulty, BoardSize, ExtensionRules, Player, Position, TeamRoster } from "../types/game";
import { DEFAULT_AI_DIFFICULTY, NO_EXTENSIONS } from "../types/game";
import { useGoGame } from "./useGoGame";
import { useMctsWorker } from "./useMctsWorker";
import { chooseAiMove } from "../ai/chooseMove";
import { MCTS_TIME_BUDGET_MS } from "../ai/mcts/chooseMctsMove";

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
 * blocks the UI thread the way it did before Fase 3.
 */
export function useAiGoGame(
  initialSize: BoardSize,
  aiColor: Player,
  initialKomi: number,
  humanNames: string[],
  initialExtensions: ExtensionRules = NO_EXTENSIONS,
  difficulty: AiDifficulty = DEFAULT_AI_DIFFICULTY
) {
  const teams: TeamRoster = aiColor === "black" ? { black: AI_ROSTER, white: humanNames } : { black: humanNames, white: AI_ROSTER };
  const game = useGoGame(initialSize, initialKomi, teams, initialExtensions);
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
          history: state.history,
          toMove: aiColor,
          consecutivePasses: state.consecutivePasses,
          komi: state.komi,
        },
        MCTS_TIME_BUDGET_MS
      ).then(finish);

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
