import { useEffect, useRef, useState } from "react";
import type { AiDifficulty, BoardSize, ExtensionRules, GameState, Player, Position, TeamRoster } from "../types/game";
import { DEFAULT_AI_DIFFICULTY, NO_EXTENSIONS } from "../types/game";
import { useGoGame } from "./useGoGame";
import { chooseAiMove } from "../ai/chooseMove";

const AI_MIN_THINK_MS = 500;
const AI_MAX_THINK_MS = 1000;
const AI_ROSTER = ["IA"];

/**
 * Picks the move-choosing function for a difficulty. "dificil" is meant to route to the
 * MCTS engine (src/ai/mcts/chooseMctsMove) once it exists — until then both difficulties
 * share the same reactive heuristic, so the UI's Fácil/Difícil selector can be built and
 * tested ahead of the engine without misbehaving.
 */
function pickEngine(difficulty: AiDifficulty): (state: GameState, aiColor: Player) => Position | null {
  void difficulty; // both branches are identical for now — see the doc comment above
  return chooseAiMove;
}

/**
 * Wraps `useGoGame` (unchanged, still used as-is by the local two-player mode) and
 * auto-plays for `aiColor` whenever it's that color's turn: after a short "thinking"
 * delay it asks the chosen engine for a move and feeds it through the same `placeStone` /
 * `pass` calls a human player would use, so it goes through identical validation. The
 * AI's own team is always a single "IA" seat — only the human side can have teammates.
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
  const engine = pickEngine(difficulty);

  useEffect(() => {
    if (state.gameOver || state.isScoring) return;
    if (state.currentPlayer !== aiColor) return;
    if (isThinkingRef.current) return;

    isThinkingRef.current = true;
    setIsAiThinking(true);

    const delay = AI_MIN_THINK_MS + Math.random() * (AI_MAX_THINK_MS - AI_MIN_THINK_MS);
    const timer = window.setTimeout(() => {
      const move = engine(state, aiColor);
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
  }, [state, aiColor, placeStone, pass, engine]);

  return { ...game, isAiThinking };
}
