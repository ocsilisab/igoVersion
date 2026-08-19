import { useState } from "react";
import { useAiGoGame } from "../hooks/useAiGoGame";
import type { BoardSize, Player } from "../types/game";
import GoBoard from "./GoBoard";
import GameInfo from "./GameInfo";
import GameControls from "./GameControls";
import ConfirmModal from "./ConfirmModal";
import GameOverModal from "./GameOverModal";
import "./GameScreen.css";

interface AiGameScreenProps {
  boardSize: BoardSize;
  playerColor: Player;
  komi: number;
  onExit: () => void;
}

export default function AiGameScreen({ boardSize, playerColor, komi, onExit }: AiGameScreenProps) {
  const aiColor: Player = playerColor === "black" ? "white" : "black";
  const {
    state,
    lastError,
    isAiThinking,
    scoringPreview,
    placeStone,
    pass,
    toggleDeadGroup,
    finalizeScoring,
    resetGame,
  } = useAiGoGame(boardSize, aiColor, komi);
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
        <h1 className="game-title">Go · vs IA</h1>
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
        playerColor={playerColor}
        aiColor={aiColor}
        isAiThinking={isAiThinking}
        isScoring={state.isScoring}
        scoringPreview={scoringPreview}
      />

      {lastError && <p className="error-banner">{lastError}</p>}

      <GoBoard
        board={state.board}
        boardSize={state.boardSize}
        lastMove={state.lastMove}
        onPlaceStone={placeStone}
        disabled={!isPlayerTurn}
        overlayText={isAiThinking ? "La IA está pensando…" : undefined}
        deadStones={state.isScoring ? state.deadStones : undefined}
        onToggleDead={state.isScoring ? toggleDeadGroup : undefined}
      />

      <GameControls
        onPass={pass}
        onReset={() => setConfirmReset(true)}
        disabled={!isPlayerTurn}
        isScoring={state.isScoring}
        onFinalize={finalizeScoring}
      />

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
