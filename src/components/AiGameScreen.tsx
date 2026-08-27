import { useState } from "react";
import { useAiGoGame } from "../hooks/useAiGoGame";
import type { AiDifficulty, BoardSize, ExtensionRules, Player } from "../types/game";
import { DEFAULT_AI_DIFFICULTY, NO_EXTENSIONS } from "../types/game";
import type { TimeControl } from "../utils/clock";
import GoBoard from "./GoBoard";
import GameInfo from "./GameInfo";
import GameControls from "./GameControls";
import ClockDisplay from "./ClockDisplay";
import ConfirmModal from "./ConfirmModal";
import GameOverModal from "./GameOverModal";
import "./GameScreen.css";

const DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  facil: "Fácil",
  dificil: "Difícil",
  experta: "Experta",
};

interface AiGameScreenProps {
  boardSize: BoardSize;
  playerColor: Player;
  komi: number;
  humanNames: string[];
  extensions?: ExtensionRules;
  difficulty?: AiDifficulty;
  timeControl?: TimeControl | null;
  onExit: () => void;
}

export default function AiGameScreen({
  boardSize,
  playerColor,
  komi,
  humanNames,
  extensions = NO_EXTENSIONS,
  difficulty = DEFAULT_AI_DIFFICULTY,
  timeControl = null,
  onExit,
}: AiGameScreenProps) {
  const aiColor: Player = playerColor === "black" ? "white" : "black";
  const {
    state,
    lastError,
    isAiThinking,
    scoringPreview,
    activePlayerName,
    liveClocks,
    placeStone,
    pass,
    toggleDeadGroup,
    finalizeScoring,
    resetGame,
  } = useAiGoGame(boardSize, aiColor, komi, humanNames, extensions, difficulty, timeControl);
  const [confirmReset, setConfirmReset] = useState(false);

  const isPlayerTurn = !state.gameOver && !state.isScoring && !isAiThinking && state.currentPlayer === playerColor;

  const confirmResetGame = () => {
    resetGame();
    setConfirmReset(false);
  };

  return (
    <div className="game-screen">
      <header className="game-header">
        <button className="link-button" onClick={onExit}>
          ← Inicio
        </button>
        <h1 className="game-title">Go · vs IA ({DIFFICULTY_LABELS[difficulty]})</h1>
        <span className="board-size-label">
          {state.boardSize} × {state.boardSize} · Komi {state.komi}
        </span>
      </header>

      {liveClocks && state.timeControl && (
        <ClockDisplay
          clocks={liveClocks}
          style={state.timeControl.style}
          currentPlayer={state.currentPlayer}
          gameOver={state.gameOver}
        />
      )}

      <GameInfo
        currentPlayer={state.currentPlayer}
        blackCaptures={state.blackCaptures}
        whiteCaptures={state.whiteCaptures}
        consecutivePasses={state.consecutivePasses}
        gameOver={state.gameOver}
        isAiThinking={isAiThinking}
        isScoring={state.isScoring}
        scoringPreview={scoringPreview}
        teamsRoster={state.teams}
        activePlayerName={activePlayerName}
        alwaysShowRoster
      />

      {lastError && <p className="error-banner">{lastError}</p>}
      {state.lastBomb && !state.gameOver && (
        <p className="setup-hint">
          💣 Última bomba en fila {state.lastBomb.center.row + 1}, columna {state.lastBomb.center.col + 1}.
        </p>
      )}

      <GoBoard
        board={state.board}
        boardSize={state.boardSize}
        lastMove={state.lastMove}
        onPlaceStone={placeStone}
        disabled={!isPlayerTurn}
        overlayText={isAiThinking ? "La IA está pensando…" : undefined}
        deadStones={state.isScoring || state.gameOver ? state.deadStones : undefined}
        onToggleDead={state.isScoring ? toggleDeadGroup : undefined}
        score={state.isScoring ? scoringPreview : state.gameOver ? state.score : undefined}
        lastBomb={state.lastBomb}
      />

      {!state.gameOver && (
        <GameControls
          onPass={pass}
          onReset={() => setConfirmReset(true)}
          disabled={!isPlayerTurn}
          isScoring={state.isScoring}
          onFinalize={finalizeScoring}
        />
      )}

      {confirmReset && (
        <ConfirmModal
          title="Reiniciar partida"
          message="¿Seguro que quieres reiniciar la partida? Se perderá el progreso actual."
          onConfirm={confirmResetGame}
          onCancel={() => setConfirmReset(false)}
        />
      )}

      {state.gameOver && (
        <GameOverModal
          score={state.score}
          winner={state.winner}
          winReason={state.winReason ?? "score"}
          onPlayAgain={() => resetGame()}
          onExit={onExit}
        />
      )}
    </div>
  );
}
