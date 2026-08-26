import { useEffect, useMemo, useRef, useState } from "react";
import { useOnlineGame } from "../online/useOnlineGame";
import { activeRoster, getActivePlayer, rosterNames } from "../online/turns";
import { createOnlineGame, joinOnlineGameById, OnlineApiError } from "../online/api";
import { useOpenGames } from "../online/useOpenGames";
import type { OnlinePlayer, PendingSeat } from "../online/types";
import { calculateScore, removeDeadStones } from "../utils/scoring";
import GoBoard from "./GoBoard";
import GameInfo from "./GameInfo";
import OpenGamesPanel from "./OpenGamesPanel";
import ConfirmModal from "./ConfirmModal";
import GameOverModal from "./GameOverModal";
import "./GameScreen.css";
import "./OnlineGameScreen.css";

interface OnlineGameScreenProps {
  gameId: string;
  /** Present when this tab was opened from a specific seat's personal invite link. */
  inviteToken?: string | null;
  onExit: () => void;
  /** Creates a fresh game with the same settings and takes this browser into its waiting room. */
  onRematch: (newGameId: string) => void;
  /** Leaves the current (still-waiting) game and takes this browser into a different one. */
  onJoinAnother: (gameId: string) => void;
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

export default function OnlineGameScreen({ gameId, inviteToken, onExit, onRematch, onJoinAnother }: OnlineGameScreenProps) {
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
    confirmScoring,
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
  const [rematching, setRematching] = useState(false);
  const [rematchError, setRematchError] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const autoJoinAttempted = useRef(false);

  const { games: openGames, loading: loadingOpenGames } = useOpenGames();

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

  /** Creates a fresh game with the same settings this one had, and jumps this browser into
   * its waiting room -- the other player(s) need the new code, same as any new online game. */
  const handleRematch = async () => {
    setRematching(true);
    setRematchError(null);
    try {
      const { game: newGame } = await createOnlineGame(
        game.boardSize,
        game.maxPlayers,
        game.komi,
        you?.team ?? "black",
        game.extensions,
        you?.displayName
      );
      onRematch(newGame.id);
    } catch (err) {
      setRematchError(err instanceof OnlineApiError ? err.message : "No se ha podido crear la revancha.");
      setRematching(false);
    }
  };

  const handleJoin = async () => {
    setIsJoining(true);
    await join({ displayName: joinName.trim() || undefined });
    setIsJoining(false);
  };

  /** Picking another open game while still waiting on this one: leave this one first (frees
   * your seat, or cancels it outright if you're the creator — same as the "Cancelar
   * partida"/"Salir" button), then join the one just picked. */
  const handleSwitchGame = async (targetId: string) => {
    setSwitchingId(targetId);
    setSwitchError(null);
    try {
      await leave();
      const { game: joined } = await joinOnlineGameById(targetId, you?.displayName);
      onJoinAnother(joined.id);
    } catch (err) {
      setSwitchError(err instanceof OnlineApiError ? err.message : "No se ha podido unir a esa partida.");
      setSwitchingId(null);
    }
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
          {game.extensions.bombs && " · 💣 Bombas"}
          {game.extensions.stars && " · ⭐ Estrellas"}
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

        {isMember && (
          <section className="online-other-games">
            <h2>Partidas abiertas</h2>
            <OpenGamesPanel
              games={openGames}
              loading={loadingOpenGames}
              joiningId={switchingId}
              onJoin={(id) => void handleSwitchGame(id)}
              disabled={switchingId !== null}
              emptyHint="No hay partidas abiertas ahora mismo."
              currentGameId={game.id}
            />
            {switchError && <p className="error-banner">{switchError}</p>}
          </section>
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
  const myTeamConfirmedScoring = Boolean(you?.team && game.deadStonesConfirmedTeams.includes(you.team));
  const bothTeamsConfirmedScoring =
    game.deadStonesConfirmedTeams.includes("black") && game.deadStonesConfirmedTeams.includes("white");

  return (
    <div className="game-screen">
      <header className="game-header">
        <button className="link-button" onClick={onExit}>
          ← Inicio
        </button>
        <h1 className="game-title">Partida {game.code}</h1>
        <span className="board-size-label">
          {game.boardSize} × {game.boardSize} · Komi {game.komi}
          {game.extensions.bombs && " · 💣"}
          {game.extensions.stars && " · ⭐"}
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
      {game.lastBomb && game.status !== "finished" && (
        <p className="setup-hint">
          💣 Última bomba en fila {game.lastBomb.center.row + 1}, columna {game.lastBomb.center.col + 1}.
        </p>
      )}

      <GoBoard
        board={game.board}
        boardSize={game.boardSize}
        lastMove={game.lastMove}
        onPlaceStone={(pos) => void placeStone(pos.row, pos.col)}
        disabled={boardDisabled}
        deadStones={game.isScoring || game.status === "finished" ? new Set(game.deadStones) : undefined}
        onToggleDead={game.isScoring ? (pos) => void toggleDeadGroup(pos.row, pos.col) : undefined}
        score={game.isScoring ? scoringPreview : game.status === "finished" ? game.score : undefined}
        lastBomb={game.lastBomb}
      />

      {game.status !== "finished" && (
        <div className="game-controls">
          {game.isScoring ? (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => void confirmScoring()}
                disabled={myTeamConfirmedScoring}
              >
                {myTeamConfirmedScoring ? "Marcador confirmado ✓" : "Confirmar marcador"}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void finalize()}
                disabled={!bothTeamsConfirmedScoring}
                title={bothTeamsConfirmedScoring ? undefined : "Los dos equipos deben confirmar el marcador primero"}
              >
                Finalizar partida
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => void pass()} disabled={!isMyTurn}>
              Pasar
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setConfirmLeave(true)}>
            Abandonar partida
          </button>
        </div>
      )}

      {game.isScoring && (
        <p className="online-waiting">
          {bothTeamsConfirmedScoring
            ? "Ambos equipos han confirmado el marcador."
            : "Marca las piedras muertas y confirma el marcador — si alguien marca o desmarca algo, hay que volver a confirmar."}
        </p>
      )}

      {confirmLeave && (
        <ConfirmModal
          title="Abandonar partida"
          message="¿Seguro que quieres abandonar? Si eras el último de tu equipo, la partida terminará para todos."
          onConfirm={() => void handleLeave()}
          onCancel={() => setConfirmLeave(false)}
        />
      )}

      {game.status === "finished" && game.score && (
        <>
          <GameOverModal
            score={game.score}
            onPlayAgain={() => void handleRematch()}
            onExit={onExit}
            playAgainLabel={rematching ? "Creando revancha…" : "Jugar de nuevo"}
            playAgainDisabled={rematching}
          />
          {rematchError && <p className="error-banner">{rematchError}</p>}
        </>
      )}
    </div>
  );
}
