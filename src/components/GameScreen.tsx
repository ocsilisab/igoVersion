import { useState } from "react";
import { useGoGame } from "../hooks/useGoGame";
import type { BoardSize, ExtensionRules, TeamRoster } from "../types/game";
import { NO_EXTENSIONS } from "../types/game";
import type { TimeControl } from "../utils/clock";
import GoBoard from "./GoBoard";
import GameInfo from "./GameInfo";
import GameControls from "./GameControls";
import ClockDisplay from "./ClockDisplay";
import ConfirmModal from "./ConfirmModal";
import GameOverModal from "./GameOverModal";
import "./GameScreen.css";

interface GameScreenProps {
  boardSize: BoardSize;
  komi: number;
  teams: TeamRoster;
  extensions?: ExtensionRules;
  timeControl?: TimeControl | null;
  onExit: () => void;
}

export default function GameScreen({
  boardSize,
  komi,
  teams,
  extensions = NO_EXTENSIONS,
  timeControl = null,
  onExit,
}: GameScreenProps) {
  const {
    state,
    lastError,
    scoringPreview,
    activePlayerName,
    liveClocks,
    placeStone,
    pass,
    toggleDeadGroup,
    finalizeScoring,
    resetGame,
  } = useGoGame(boardSize, komi, teams, extensions, timeControl);
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
        isScoring={state.isScoring}
        scoringPreview={scoringPreview}
        teamsRoster={state.teams}
        activePlayerName={activePlayerName}
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
        disabled={state.gameOver || state.isScoring}
        deadStones={state.isScoring || state.gameOver ? state.deadStones : undefined}
        onToggleDead={state.isScoring ? toggleDeadGroup : undefined}
        score={state.isScoring ? scoringPreview : state.gameOver ? state.score : undefined}
        lastBomb={state.lastBomb}
      />

      {!state.gameOver && (
        <GameControls
          onPass={pass}
          onReset={() => setConfirmReset(true)}
          disabled={state.gameOver || state.isScoring}
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
