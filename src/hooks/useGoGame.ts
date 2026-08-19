import { useCallback, useMemo, useState } from "react";
import type { BoardSize, GameState, Player, Position, ScoreResult, TeamRoster } from "../types/game";
import { DEFAULT_KOMI } from "../types/game";
import { createEmptyBoard, opponent, serializeBoard } from "../utils/board";
import { calculateScore, removeDeadStones } from "../utils/scoring";
import { toggleDeadStoneGroup } from "../utils/deadStones";
import { activeTeamMember } from "../utils/teams";
import { tryMove, MOVE_ERROR_MESSAGES } from "../utils/move";

const DEFAULT_TEAMS: TeamRoster = { black: ["Negras"], white: ["Blancas"] };

function createInitialState(size: BoardSize, komi: number, teams: TeamRoster): GameState {
  const board = createEmptyBoard(size);
  return {
    board,
    boardSize: size,
    komi,
    teams,
    turnIndex: { black: 0, white: 0 },
    currentPlayer: "black",
    blackCaptures: 0,
    whiteCaptures: 0,
    consecutivePasses: 0,
    history: [serializeBoard(board)],
    isScoring: false,
    deadStones: new Set<string>(),
    gameOver: false,
    lastMove: null,
    winner: null,
    score: null,
  };
}

/** Advances the rotation for whichever color just took a turn (move or pass) to the next roster member. */
function advanceTurn(turnIndex: Record<Player, number>, color: Player, teams: TeamRoster): Record<Player, number> {
  const size = teams[color].length || 1;
  return { ...turnIndex, [color]: (turnIndex[color] + 1) % size };
}

export function useGoGame(initialSize: BoardSize = 9, initialKomi: number = DEFAULT_KOMI, initialTeams: TeamRoster = DEFAULT_TEAMS) {
  const [state, setState] = useState<GameState>(() => createInitialState(initialSize, initialKomi, initialTeams));
  const [lastError, setLastError] = useState<string | null>(null);

  const placeStone = useCallback((pos: Position) => {
    setLastError(null);

    setState((prev) => {
      if (prev.gameOver || prev.isScoring) return prev;
      const { board, boardSize, currentPlayer } = prev;

      const result = tryMove(board, boardSize, currentPlayer, pos, prev.history);
      if (!result.ok) {
        setLastError(MOVE_ERROR_MESSAGES[result.reason]);
        return prev;
      }

      const opponentColor = opponent(currentPlayer);
      return {
        ...prev,
        board: result.board,
        currentPlayer: opponentColor,
        turnIndex: advanceTurn(prev.turnIndex, currentPlayer, prev.teams),
        blackCaptures: prev.blackCaptures + (currentPlayer === "black" ? result.capturedCount : 0),
        whiteCaptures: prev.whiteCaptures + (currentPlayer === "white" ? result.capturedCount : 0),
        consecutivePasses: 0,
        history: [...prev.history, result.boardState],
        lastMove: pos,
      };
    });
  }, []);

  const pass = useCallback(() => {
    setLastError(null);

    setState((prev) => {
      if (prev.gameOver || prev.isScoring) return prev;

      const consecutivePasses = prev.consecutivePasses + 1;
      const nextPlayer = opponent(prev.currentPlayer);
      const turnIndex = advanceTurn(prev.turnIndex, prev.currentPlayer, prev.teams);

      if (consecutivePasses >= 2) {
        // Two passes in a row end active play, but the game isn't over yet: players
        // first mark dead stones (toggleDeadGroup) and confirm with finalizeScoring.
        return { ...prev, consecutivePasses, currentPlayer: nextPlayer, turnIndex, isScoring: true };
      }

      return { ...prev, consecutivePasses, currentPlayer: nextPlayer, turnIndex };
    });
  }, []);

  const toggleDeadGroup = useCallback((pos: Position) => {
    setState((prev) => {
      if (!prev.isScoring) return prev;
      const nextDeadStones = toggleDeadStoneGroup(prev.board, prev.boardSize, pos, prev.deadStones);
      return { ...prev, deadStones: nextDeadStones };
    });
  }, []);

  const finalizeScoring = useCallback(() => {
    setState((prev) => {
      if (!prev.isScoring) return prev;

      const { board: cleanedBoard, deadBlack, deadWhite } = removeDeadStones(prev.board, prev.deadStones);
      const blackCaptures = prev.blackCaptures + deadWhite;
      const whiteCaptures = prev.whiteCaptures + deadBlack;
      const score = calculateScore(cleanedBoard, prev.boardSize, blackCaptures, whiteCaptures, prev.komi);

      return {
        ...prev,
        board: cleanedBoard,
        blackCaptures,
        whiteCaptures,
        isScoring: false,
        gameOver: true,
        winner: score.winner,
        score,
      };
    });
  }, []);

  const resetGame = useCallback(() => {
    setLastError(null);
    setState((prev) => createInitialState(prev.boardSize, prev.komi, prev.teams));
  }, []);

  const scoringPreview: ScoreResult | null = useMemo(() => {
    if (!state.isScoring) return null;
    const { board: cleanedBoard, deadBlack, deadWhite } = removeDeadStones(state.board, state.deadStones);
    return calculateScore(
      cleanedBoard,
      state.boardSize,
      state.blackCaptures + deadWhite,
      state.whiteCaptures + deadBlack,
      state.komi
    );
  }, [state.isScoring, state.board, state.deadStones, state.boardSize, state.blackCaptures, state.whiteCaptures, state.komi]);

  const activePlayerName = useMemo(
    () => activeTeamMember(state.teams, state.turnIndex, state.currentPlayer),
    [state.teams, state.turnIndex, state.currentPlayer]
  );

  return {
    state,
    lastError,
    scoringPreview,
    activePlayerName,
    placeStone,
    pass,
    toggleDeadGroup,
    finalizeScoring,
    resetGame,
  };
}
