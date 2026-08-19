import { useEffect, useRef, useState } from "react";
import type { BoardSize, Player, TeamRoster } from "../types/game";
import { useGoGame } from "./useGoGame";
import { chooseAiMove } from "../ai/chooseMove";

const AI_MIN_THINK_MS = 500;
const AI_MAX_THINK_MS = 1000;
const AI_ROSTER = ["IA"];

/**
 * Wraps `useGoGame` (unchanged, still used as-is by the local two-player mode) and
 * auto-plays for `aiColor` whenever it's that color's turn: after a short "thinking"
 * delay it asks ai/chooseMove for a move and feeds it through the same `placeStone` /
 * `pass` calls a human player would use, so it goes through identical validation. The
 * AI's own team is always a single "IA" seat — only the human side can have teammates.
 */
export function useAiGoGame(initialSize: BoardSize, aiColor: Player, initialKomi: number, humanNames: string[]) {
  const teams: TeamRoster = aiColor === "black" ? { black: AI_ROSTER, white: humanNames } : { black: humanNames, white: AI_ROSTER };
  const game = useGoGame(initialSize, initialKomi, teams);
  const { state, placeStone, pass } = game;
  const [isAiThinking, setIsAiThinking] = useState(false);
  const isThinkingRef = useRef(false);

  useEffect(() => {
    if (state.gameOver || state.isScoring) return;
    if (state.currentPlayer !== aiColor) return;
    if (isThinkingRef.current) return;

    isThinkingRef.current = true;
    setIsAiThinking(true);

    const delay = AI_MIN_THINK_MS + Math.random() * (AI_MAX_THINK_MS - AI_MIN_THINK_MS);
    const timer = window.setTimeout(() => {
      const move = chooseAiMove(state, aiColor);
      if (move) {
        placeStone(move);
      } else {
        pass();
      }
      isThinkingRef.current = false;
      setIsAiThinking(false);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      isThinkingRef.current = false;
      setIsAiThinking(false);
    };
  }, [state, aiColor, placeStone, pass]);

  return { ...game, isAiThinking };
}
