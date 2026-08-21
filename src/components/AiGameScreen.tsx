import { useState } from "react";
import { useAiGoGame } from "../hooks/useAiGoGame";
import type { AiDifficulty, BoardSize, ExtensionRules, Player } from "../types/game";
import { DEFAULT_AI_DIFFICULTY, NO_EXTENSIONS } from "../types/game";
import GoBoard from "./GoBoard";
import GameInfo from "./GameInfo";
import GameControls from "./GameControls";
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
  onExit: () => void;
}

export default function AiGameScreen({
  boardSize,
  playerColor,
  komi,
  humanNames,
  extensions = NO_EXTENSIONS,
  difficulty = DEFAULT_AI_DIFFICULTY,
  onExit,
}: AiGameScreenProps) {
  const aiColor: Player = playerColor === "black" ? "white" : "black";
  const {
    state,
    lastError,
    isAiThinking,
    scoringPreview,
    activePlayerName,
    placeStone,
    pass,
    toggleDeadGroup,
    finalizeScoring,
    resetGame,
  } = useAiGoGame(boardSize, aiColor, komi, humanNames, extensions, difficulty);
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

      {state.gameOver && state.score && (
        <GameOverModal score={state.score} onPlayAgain={() => resetGame()} onExit={onExit} />
      )}
    </div>
  );
}
