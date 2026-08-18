import { useCallback, useState } from "react";
import type { BoardSize, GameState, Position } from "../types/game";
import { createEmptyBoard, opponent, serializeBoard } from "../utils/board";
import { calculateScore } from "../utils/scoring";
import { tryMove, type MoveRejectionReason } from "../utils/move";

const MOVE_ERROR_MESSAGES: Record<MoveRejectionReason, string> = {
  occupied: "No puedes colocar una piedra sobre otra piedra.",
  suicide: "Movimiento suicida: ese grupo se quedaría sin libertades.",
  ko: "Movimiento no permitido por la regla del Ko.",
};

function createInitialState(size: BoardSize): GameState {
  const board = createEmptyBoard(size);
  return {
    board,
    boardSize: size,
    currentPlayer: "black",
    blackCaptures: 0,
    whiteCaptures: 0,
    consecutivePasses: 0,
    history: [serializeBoard(board)],
    gameOver: false,
    lastMove: null,
    winner: null,
    score: null,
  };
}

export function useGoGame(initialSize: BoardSize = 9) {
  const [state, setState] = useState<GameState>(() => createInitialState(initialSize));
  const [lastError, setLastError] = useState<string | null>(null);

  const placeStone = useCallback((pos: Position) => {
    setLastError(null);

    setState((prev) => {
      if (prev.gameOver) return prev;
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
      if (prev.gameOver) return prev;

      const consecutivePasses = prev.consecutivePasses + 1;
      const nextPlayer = opponent(prev.currentPlayer);

      if (consecutivePasses >= 2) {
        const score = calculateScore(prev.board, prev.boardSize, prev.blackCaptures, prev.whiteCaptures);
        return {
          ...prev,
          consecutivePasses,
          currentPlayer: nextPlayer,
          gameOver: true,
          winner: score.winner,
          score,
        };
      }

      return { ...prev, consecutivePasses, currentPlayer: nextPlayer };
    });
  }, []);

  const resetGame = useCallback((size?: BoardSize) => {
    setLastError(null);
    setState((prev) => createInitialState(size ?? prev.boardSize));
  }, []);

  const changeBoardSize = useCallback((size: BoardSize) => {
    setLastError(null);
    setState(() => createInitialState(size));
  }, []);

  const isGameInProgress = state.history.length > 1 && !state.gameOver;

  return { state, lastError, isGameInProgress, placeStone, pass, resetGame, changeBoardSize };
}
