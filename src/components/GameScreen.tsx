import { useState } from "react";
import { useGoGame } from "../hooks/useGoGame";
import type { BoardSize } from "../types/game";
import GoBoard from "./GoBoard";
import GameInfo from "./GameInfo";
import GameControls from "./GameControls";
import ConfirmModal from "./ConfirmModal";
import GameOverModal from "./GameOverModal";
import "./GameScreen.css";

interface GameScreenProps {
  boardSize: BoardSize;
  komi: number;
  onExit: () => void;
}

export default function GameScreen({ boardSize, komi, onExit }: GameScreenProps) {
  const { state, lastError, scoringPreview, placeStone, pass, toggleDeadGroup, finalizeScoring, resetGame } = useGoGame(
    boardSize,
    komi
  );
  const [confirmReset, setConfirmReset] = useState(false);

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
        <h1 className="game-title">Go</h1>
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
        isScoring={state.isScoring}
        scoringPreview={scoringPreview}
      />

      {lastError && <p className="error-banner">{lastError}</p>}

      <GoBoard
        board={state.board}
        boardSize={state.boardSize}
        lastMove={state.lastMove}
        onPlaceStone={placeStone}
        disabled={state.gameOver || state.isScoring}
        deadStones={state.isScoring ? state.deadStones : undefined}
        onToggleDead={state.isScoring ? toggleDeadGroup : undefined}
      />

      <GameControls
        onPass={pass}
        onReset={() => setConfirmReset(true)}
        disabled={state.gameOver || state.isScoring}
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
