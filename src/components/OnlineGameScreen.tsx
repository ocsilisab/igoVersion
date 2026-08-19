import { useEffect, useMemo, useRef, useState } from "react";
import { useOnlineGame } from "../online/useOnlineGame";
import { activeRoster, getActivePlayer, rosterNames } from "../online/turns";
import type { OnlinePlayer, PendingSeat } from "../online/types";
import { calculateScore, removeDeadStones } from "../utils/scoring";
import GoBoard from "./GoBoard";
import GameInfo from "./GameInfo";
import ConfirmModal from "./ConfirmModal";
import GameOverModal from "./GameOverModal";
import "./GameScreen.css";
import "./OnlineGameScreen.css";

interface OnlineGameScreenProps {
  gameId: string;
  /** Present when this tab was opened from a specific seat's personal invite link. */
  inviteToken?: string | null;
  onExit: () => void;
}

function gameUrl(gameId: string): string {
  return `${window.location.origin}${window.location.pathname}?game=${gameId}`;
}

function PlayerDot({ player, connected }: { player: OnlinePlayer; connected: boolean }) {
  return (
    <span className={`connection-line connection-${connected ? "connected" : "reconnecting"}`}>
      {connected ? "●" : "○"} {player.displayName}
      {player.isCreator && " (host)"}
    </span>
  );
}

function PendingSeatRow({
  seat,
  onCopy,
  copied,
}: {
  seat: PendingSeat;
  onCopy: (token: string) => void;
  copied: boolean;
}) {
  return (
    <span className="connection-line pending-seat">
      ○ Plaza vacante
      {seat.inviteToken && (
        <button type="button" className="link-button invite-copy" onClick={() => onCopy(seat.inviteToken!)}>
          {copied ? "¡Copiado!" : "Copiar enlace"}
        </button>
      )}
    </span>
  );
}

export default function OnlineGameScreen({ gameId, inviteToken, onExit }: OnlineGameScreenProps) {
  const {
    game,
    you,
    loading,
    loadError,
    connectionStatus,
    connectedGuestIds,
    actionError,
    clearActionError,
    placeStone,
    pass,
    toggleDeadGroup,
    finalize,
    leave,
    start,
    join,
  } = useOnlineGame(gameId);

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedSeatToken, setCopiedSeatToken] = useState<string | null>(null);
  const [joinName, setJoinName] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const autoJoinAttempted = useRef(false);

  // A personal invite link: claim that seat automatically, then drop the token from the
  // URL so a refresh doesn't try (harmlessly, but pointlessly) to reclaim it.
  useEffect(() => {
    if (!inviteToken || !game || !you || autoJoinAttempted.current) return;
    if (you.team !== null || game.status !== "waiting") return;
    autoJoinAttempted.current = true;
    void join({ token: inviteToken }).then(() => {
      window.history.replaceState(null, "", `?game=${gameId}`);
    });
  }, [inviteToken, game, you, join, gameId]);

  const scoringPreview = useMemo(() => {
    if (!game || !game.isScoring) return null;
    const { board: cleaned, deadBlack, deadWhite } = removeDeadStones(game.board, new Set(game.deadStones));
    return calculateScore(
      cleaned,
      game.boardSize,
      game.blackCaptures + deadWhite,
      game.whiteCaptures + deadBlack,
      game.komi
    );
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

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(game.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied/unavailable — the code is still visible on screen.
    }
  };

  const handleCopyGameLink = async () => {
    try {
      await navigator.clipboard.writeText(gameUrl(game.id));
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1500);
    } catch {
      // Clipboard permission denied/unavailable.
    }
  };

  const handleCopySeatInvite = async (token: string) => {
    try {
      await navigator.clipboard.writeText(`${gameUrl(game.id)}&token=${token}`);
      setCopiedSeatToken(token);
      window.setTimeout(() => setCopiedSeatToken((t) => (t === token ? null : t)), 1500);
    } catch {
      // Clipboard permission denied/unavailable.
    }
  };

  const handleLeave = async () => {
    setConfirmLeave(false);
    await leave();
  };

  const handleJoin = async () => {
    setIsJoining(true);
    await join({ displayName: joinName.trim() || undefined });
    setIsJoining(false);
  };

  if (game.status === "waiting") {
    const blackRoster = activeRoster(game, "black");
    const whiteRoster = activeRoster(game, "white");
    const blackPending = game.pendingSeats.filter((s) => s.team === "black").sort((a, b) => a.turnOrder - b.turnOrder);
    const whitePending = game.pendingSeats.filter((s) => s.team === "white").sort((a, b) => a.turnOrder - b.turnOrder);
    const totalActive = blackRoster.length + whiteRoster.length;
    const canStart = you?.isCreator && blackRoster.length > 0 && whiteRoster.length > 0;
    const isFull = game.pendingSeats.length === 0;
    const isMember = Boolean(you?.team);

    return (
      <div className="online-status-screen">
        <h1 className="game-title">Partida creada</h1>
        <div className="online-code-card">
          <span className="online-code-label">Código</span>
          <span className="online-code-value">{game.code}</span>
          <div className="online-code-actions">
            <button className="btn btn-secondary" onClick={() => void handleCopyCode()}>
              {copied ? "¡Copiado!" : "Copiar código"}
            </button>
            <button className="btn btn-secondary" onClick={() => void handleCopyGameLink()}>
              {copiedLink ? "¡Copiado!" : "Copiar enlace"}
            </button>
          </div>
        </div>
        <p>
          Tablero: {game.boardSize} × {game.boardSize} · Komi {game.komi}
        </p>

        <div className="online-roster">
          <div className="online-roster-team">
            <h2>
              <span className="stone-dot stone-dot-black" /> Negras ({blackRoster.length}/
              {blackRoster.length + blackPending.length})
            </h2>
            {blackRoster.map((p) => (
              <PlayerDot key={p.guestId} player={p} connected={connectedGuestIds.has(p.guestId)} />
            ))}
            {blackPending.map((seat, i) => (
              <PendingSeatRow
                key={`black-pending-${i}`}
                seat={seat}
                onCopy={(token) => void handleCopySeatInvite(token)}
                copied={copiedSeatToken === seat.inviteToken}
              />
            ))}
          </div>
          <div className="online-roster-team">
            <h2>
              <span className="stone-dot stone-dot-white" /> Blancas ({whiteRoster.length}/
              {whiteRoster.length + whitePending.length})
            </h2>
            {whiteRoster.map((p) => (
              <PlayerDot key={p.guestId} player={p} connected={connectedGuestIds.has(p.guestId)} />
            ))}
            {whitePending.map((seat, i) => (
              <PendingSeatRow
                key={`white-pending-${i}`}
                seat={seat}
                onCopy={(token) => void handleCopySeatInvite(token)}
                copied={copiedSeatToken === seat.inviteToken}
              />
            ))}
          </div>
        </div>

        <p className="online-waiting">
          {isFull ? "Sala completa. Ya podéis empezar." : `Esperando más jugadores… (${totalActive}/${game.maxPlayers})`}
        </p>
        {canStart && !isFull && (
          <p className="online-waiting">Ya hay al menos uno en cada color: puedes empezar cuando quieras.</p>
        )}

        {actionError && <p className="error-banner">{actionError}</p>}

        {isMember ? (
          <div className="online-waiting-actions">
            {you?.isCreator && (
              <button className="btn btn-primary" onClick={() => void start()} disabled={!canStart}>
                Empezar partida
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => void handleLeave()}>
              {you?.isCreator ? "Cancelar partida" : "Salir"}
            </button>
          </div>
        ) : (
          !isFull && (
            <div className="online-join-panel">
              <input
                className="setup-input"
                type="text"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                placeholder="Tu nombre (opcional)"
                maxLength={24}
                disabled={isJoining}
              />
              <button className="btn btn-primary" onClick={() => void handleJoin()} disabled={isJoining}>
                {isJoining ? "Uniéndose…" : "Unirse a esta partida"}
              </button>
            </div>
          )
        )}
      </div>
    );
  }

  if (game.status === "abandoned") {
    const myTeamAbandoned = game.abandonedTeam === you?.team;
    return (
      <div className="online-status-screen">
        <h1 className="game-title">Partida abandonada</h1>
        <p>
          {myTeamAbandoned
            ? "Tu equipo se ha quedado sin jugadores. Partida abandonada."
            : "El equipo rival se ha quedado sin jugadores. Partida abandonada."}
        </p>
        <button className="btn btn-secondary" onClick={onExit}>
          Volver al inicio
        </button>
      </div>
    );
  }

  const isMyTurn = Boolean(you?.isYourTurn);
  const boardDisabled = game.status !== "playing" || game.isScoring || !isMyTurn;
  const activePlayer = getActivePlayer(game, game.currentPlayer);

  return (
    <div className="game-screen">
      <header className="game-header">
        <button className="link-button" onClick={onExit}>
          ← Inicio
        </button>
        <h1 className="game-title">Partida {game.code}</h1>
        <span className="board-size-label">
          {game.boardSize} × {game.boardSize} · Komi {game.komi}
        </span>
      </header>

      <div className="online-players-row">
        <span className={`connection-line connection-${connectionStatus}`}>
          {connectionStatus === "connected" ? "●" : "○"} Tú: {you?.displayName}
        </span>
        {game.players
          .filter((p) => p.active && p.guestId !== you?.guestId)
          .map((p) => (
            <PlayerDot key={p.guestId} player={p} connected={connectedGuestIds.has(p.guestId)} />
          ))}
      </div>

      <GameInfo
        currentPlayer={game.currentPlayer}
        blackCaptures={game.blackCaptures}
        whiteCaptures={game.whiteCaptures}
        consecutivePasses={game.consecutivePasses}
        gameOver={game.status === "finished"}
        isScoring={game.isScoring}
        scoringPreview={scoringPreview}
        teamsRoster={rosterNames(game)}
        activePlayerName={activePlayer?.displayName}
        alwaysShowRoster
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
          message="¿Seguro que quieres abandonar? Si eras el último de tu equipo, la partida terminará para todos."
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
