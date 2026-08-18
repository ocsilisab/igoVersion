import { useCallback, useState } from "react";
import type { BoardSize, GameState, Position } from "../types/game";
import { cloneBoard, createEmptyBoard, opponent, serializeBoard } from "../utils/board";
import { removeDeadGroups } from "../utils/capture";
import { getGroup } from "../utils/liberties";
import { violatesKo } from "../utils/ko";
import { calculateScore } from "../utils/scoring";

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

      if (board[pos.row][pos.col] !== null) {
        setLastError("No puedes colocar una piedra sobre otra piedra.");
        return prev;
      }

      const candidateBoard = cloneBoard(board);
      candidateBoard[pos.row][pos.col] = currentPlayer;

      const opponentColor = opponent(currentPlayer);
      const { board: afterCapture, capturedCount } = removeDeadGroups(candidateBoard, opponentColor, boardSize);

      const ownGroup = getGroup(afterCapture, pos, boardSize);
      if (ownGroup.liberties.size === 0) {
        setLastError("Movimiento suicida: ese grupo se quedaría sin libertades.");
        return prev;
      }

      const candidateState = serializeBoard(afterCapture);
      if (violatesKo(candidateState, prev.history)) {
        setLastError("Movimiento no permitido por la regla del Ko.");
        return prev;
      }

      return {
        ...prev,
        board: afterCapture,
        currentPlayer: opponentColor,
        blackCaptures: prev.blackCaptures + (currentPlayer === "black" ? capturedCount : 0),
        whiteCaptures: prev.whiteCaptures + (currentPlayer === "white" ? capturedCount : 0),
        consecutivePasses: 0,
        history: [...prev.history, candidateState],
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
