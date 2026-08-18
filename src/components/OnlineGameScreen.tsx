import { useMemo, useState } from "react";
import { useOnlineGame } from "../online/useOnlineGame";
import { calculateScore, removeDeadStones } from "../utils/scoring";
import GoBoard from "./GoBoard";
import GameInfo from "./GameInfo";
import ConfirmModal from "./ConfirmModal";
import GameOverModal from "./GameOverModal";
import "./GameScreen.css";
import "./OnlineGameScreen.css";

interface OnlineGameScreenProps {
  gameId: string;
  onExit: () => void;
}

const colorLabel = (color: "black" | "white" | null): string =>
  color === "black" ? "Negras" : color === "white" ? "Blancas" : "";

export default function OnlineGameScreen({ gameId, onExit }: OnlineGameScreenProps) {
  const {
    game,
    you,
    loading,
    loadError,
    connectionStatus,
    opponentConnectionStatus,
    actionError,
    clearActionError,
    placeStone,
    pass,
    toggleDeadGroup,
    finalize,
    leave,
  } = useOnlineGame(gameId);

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copied, setCopied] = useState(false);

  const scoringPreview = useMemo(() => {
    if (!game || !game.isScoring) return null;
    const { board: cleaned, deadBlack, deadWhite } = removeDeadStones(game.board, new Set(game.deadStones));
    return calculateScore(cleaned, game.boardSize, game.blackCaptures + deadWhite, game.whiteCaptures + deadBlack);
  }, [game]);

  if (loading) {
    return (
      <div className="online-status-screen">
        <p>Cargando partida…</p>
      </div>
    );
  }

  if (loadError || !game) {
    return (
      <div className="online-status-screen">
        <p className="error-banner">{loadError ?? "No se ha encontrado la partida."}</p>
        <button className="btn btn-secondary" onClick={onExit}>
          Volver al inicio
        </button>
      </div>
    );
  }

  const myColor = you?.color ?? null;
  const opponentColor = myColor === "black" ? "white" : myColor === "white" ? "black" : null;
  const opponentName = opponentColor === "black" ? game.blackName : opponentColor === "white" ? game.whiteName : null;
  const myName = myColor === "black" ? game.blackName : myColor === "white" ? game.whiteName : null;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(game.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied/unavailable — the code is still visible on screen.
    }
  };

  const handleLeave = async () => {
    setConfirmLeave(false);
    await leave();
  };

  if (game.status === "waiting") {
    return (
      <div className="online-status-screen">
        <h1 className="game-title">Partida creada</h1>
        <div className="online-code-card">
          <span className="online-code-label">Código</span>
          <span className="online-code-value">{game.code}</span>
          <button className="btn btn-secondary" onClick={() => void handleCopyCode()}>
            {copied ? "¡Copiado!" : "Copiar código"}
          </button>
        </div>
        <p>
          Tablero: {game.boardSize} × {game.boardSize}
        </p>
        <p>
          Jugador: {game.blackName} · Negras
        </p>
        <p className="online-waiting">Esperando rival…</p>
        <button className="btn btn-secondary" onClick={() => void handleLeave()}>
          Cancelar partida
        </button>
      </div>
    );
  }

  if (game.status === "abandoned") {
    const iLeft = game.abandonedBy === myColor;
    return (
      <div className="online-status-screen">
        <h1 className="game-title">Partida abandonada</h1>
        <p>{iLeft ? "Has abandonado la partida." : "El rival se ha desconectado y ha abandonado la partida."}</p>
        <button className="btn btn-secondary" onClick={onExit}>
          Volver al inicio
        </button>
      </div>
    );
  }

  const isMyTurn = myColor !== null && game.status === "playing" && !game.isScoring && game.currentPlayer === myColor;
  const boardDisabled = game.status !== "playing" || game.isScoring || !isMyTurn;

  return (
    <div className="game-screen">
      <header className="game-header">
        <button className="link-button" onClick={onExit}>
          ← Inicio
        </button>
        <h1 className="game-title">Partida {game.code}</h1>
        <span className="board-size-label">
          {game.boardSize} × {game.boardSize}
        </span>
      </header>

      <div className="online-players-row">
        <span className={`connection-line connection-${connectionStatus}`}>
          {connectionStatus === "connected" ? "●" : "○"} Tú: {myName ?? "—"}
          {myColor && ` (${colorLabel(myColor)})`}
        </span>
        <span className={`connection-line connection-${opponentConnectionStatus}`}>
          {opponentConnectionStatus === "connected" ? "●" : "○"} Rival: {opponentName ?? "esperando…"}
          {opponentColor && ` (${colorLabel(opponentColor)})`}
        </span>
      </div>

      <GameInfo
        currentPlayer={game.currentPlayer}
        blackCaptures={game.blackCaptures}
        whiteCaptures={game.whiteCaptures}
        consecutivePasses={game.consecutivePasses}
        gameOver={game.status === "finished"}
        isScoring={game.isScoring}
        scoringPreview={scoringPreview}
      />

      {actionError && (
        <p className="error-banner" onClick={clearActionError}>
          {actionError}
        </p>
      )}

      <GoBoard
        board={game.board}
        boardSize={game.boardSize}
        lastMove={game.lastMove}
        onPlaceStone={(pos) => void placeStone(pos.row, pos.col)}
        disabled={boardDisabled}
        deadStones={game.isScoring ? new Set(game.deadStones) : undefined}
        onToggleDead={game.isScoring ? (pos) => void toggleDeadGroup(pos.row, pos.col) : undefined}
      />

      <div className="game-controls">
        {game.isScoring ? (
          <button className="btn btn-primary" onClick={() => void finalize()}>
            Finalizar partida
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => void pass()} disabled={!isMyTurn}>
            Pasar
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => setConfirmLeave(true)}>
          Abandonar partida
        </button>
      </div>

      {confirmLeave && (
        <ConfirmModal
          title="Abandonar partida"
          message="¿Seguro que quieres abandonar? El rival será notificado y la partida terminará."
          onConfirm={() => void handleLeave()}
          onCancel={() => setConfirmLeave(false)}
        />
      )}

      {game.status === "finished" && game.score && (
        <GameOverModal score={game.score} onPlayAgain={onExit} onExit={onExit} />
      )}
    </div>
  );
}
