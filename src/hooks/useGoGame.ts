import { useCallback, useMemo, useState } from "react";
import type { BoardSize, ExtensionRules, GameState, Player, Position, ScoreResult, TeamRoster } from "../types/game";
import { DEFAULT_KOMI, NO_EXTENSIONS } from "../types/game";
import { createEmptyBoard, opponent, serializeBoard } from "../utils/board";
import { calculateScore, removeDeadStones } from "../utils/scoring";
import { toggleDeadStoneGroup, suggestDeadGroups } from "../utils/deadStones";
import { activeTeamMember } from "../utils/teams";
import { tryMove, MOVE_ERROR_MESSAGES } from "../utils/move";
import { applyHoshiConversion, dropBomb, BOMB_INTERVAL } from "../utils/extensions";

const DEFAULT_TEAMS: TeamRoster = { black: ["Negras"], white: ["Blancas"] };

function createInitialState(size: BoardSize, komi: number, teams: TeamRoster, extensions: ExtensionRules): GameState {
  const board = createEmptyBoard(size);
  return {
    board,
    boardSize: size,
    komi,
    teams,
    turnIndex: { black: 0, white: 0 },
    extensions,
    moveCount: 0,
    lastBomb: null,
    currentPlayer: "black",
    blackCaptures: 0,
    whiteCaptures: 0,
    consecutivePasses: 0,
    history: [serializeBoard(board)],
    isScoring: false,
    deadStones: new Set<string>(),
    gameOver: false,
    lastMove: null,
    recentMoves: [],
    winner: null,
    score: null,
  };
}

const RECENT_MOVES_WINDOW = 3;

function pushRecentMove(recentMoves: (Position | null)[], move: Position | null): (Position | null)[] {
  return [move, ...recentMoves].slice(0, RECENT_MOVES_WINDOW);
}

/** Advances the rotation for whichever color just took a turn (move or pass) to the next roster member. */
function advanceTurn(turnIndex: Record<Player, number>, color: Player, teams: TeamRoster): Record<Player, number> {
  const size = teams[color].length || 1;
  return { ...turnIndex, [color]: (turnIndex[color] + 1) % size };
}

export function useGoGame(
  initialSize: BoardSize = 9,
  initialKomi: number = DEFAULT_KOMI,
  initialTeams: TeamRoster = DEFAULT_TEAMS,
  initialExtensions: ExtensionRules = NO_EXTENSIONS
) {
  const [state, setState] = useState<GameState>(() =>
    createInitialState(initialSize, initialKomi, initialTeams, initialExtensions)
  );
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

      let nextBoard = result.board;
      let extraCaptured = 0;
      if (prev.extensions.stars) {
        const conversion = applyHoshiConversion(nextBoard, boardSize, pos, currentPlayer);
        nextBoard = conversion.board;
        extraCaptured = conversion.extraCaptured;
      }

      const moveCount = prev.moveCount + 1;
      let lastBomb = prev.lastBomb;
      if (prev.extensions.bombs && moveCount % BOMB_INTERVAL === 0) {
        const bomb = dropBomb(nextBoard, boardSize);
        nextBoard = bomb.board;
        lastBomb = { center: bomb.center, affected: bomb.affected };
      }

      const capturedCount = result.capturedCount + extraCaptured;
      const opponentColor = opponent(currentPlayer);
      return {
        ...prev,
        board: nextBoard,
        currentPlayer: opponentColor,
        turnIndex: advanceTurn(prev.turnIndex, currentPlayer, prev.teams),
        blackCaptures: prev.blackCaptures + (currentPlayer === "black" ? capturedCount : 0),
        whiteCaptures: prev.whiteCaptures + (currentPlayer === "white" ? capturedCount : 0),
        consecutivePasses: 0,
        history: [...prev.history, serializeBoard(nextBoard)],
        lastMove: pos,
        recentMoves: pushRecentMove(prev.recentMoves, pos),
        moveCount,
        lastBomb,
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
      const recentMoves = pushRecentMove(prev.recentMoves, null);

      if (consecutivePasses >= 2) {
        // Two passes in a row end active play, but the game isn't over yet: players
        // review/adjust the dead-group suggestion (toggleDeadGroup) and confirm with
        // finalizeScoring. suggestDeadGroups pre-marks anything without two eyes so the
        // board doesn't start the scoring phase looking untouched.
        return {
          ...prev,
          consecutivePasses,
          currentPlayer: nextPlayer,
          turnIndex,
          recentMoves,
          isScoring: true,
          deadStones: suggestDeadGroups(prev.board, prev.boardSize),
        };
      }

      return { ...prev, consecutivePasses, currentPlayer: nextPlayer, turnIndex, recentMoves };
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

      // Dead stones are only removed for the *score calculation* — the board itself keeps
      // showing them (still crossed out via deadStones) so the final board stays reviewable
      // next to the score table instead of jumping straight to an empty-looking result.
      const { board: cleanedBoard, deadBlack, deadWhite } = removeDeadStones(prev.board, prev.deadStones);
      const blackCaptures = prev.blackCaptures + deadWhite;
      const whiteCaptures = prev.whiteCaptures + deadBlack;
      const score = calculateScore(cleanedBoard, prev.boardSize, blackCaptures, whiteCaptures, prev.komi);

      return {
        ...prev,
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
    setState((prev) => createInitialState(prev.boardSize, prev.komi, prev.teams, prev.extensions));
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
