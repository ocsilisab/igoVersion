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
  onExit: () => void;
}

export default function AiGameScreen({ boardSize, playerColor, onExit }: AiGameScreenProps) {
  const aiColor: Player = playerColor === "black" ? "white" : "black";
  const { state, lastError, isAiThinking, placeStone, pass, resetGame } = useAiGoGame(boardSize, aiColor);
  const [confirmReset, setConfirmReset] = useState(false);

  const isPlayerTurn = !state.gameOver && !isAiThinking && state.currentPlayer === playerColor;

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
          {state.boardSize} × {state.boardSize}
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
      />

      {lastError && <p className="error-banner">{lastError}</p>}

      <GoBoard
        board={state.board}
        boardSize={state.boardSize}
        lastMove={state.lastMove}
        onPlaceStone={placeStone}
        disabled={!isPlayerTurn}
        overlayText={isAiThinking ? "La IA está pensando…" : undefined}
      />

      <GameControls onPass={pass} onReset={() => setConfirmReset(true)} disabled={!isPlayerTurn} />

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
