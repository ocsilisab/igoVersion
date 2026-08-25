import { useMemo, useState } from "react";
import type { BoardSize, ExtensionRules, Player, TeamRoster } from "../types/game";
import { DEFAULT_KOMI, MIN_TOTAL_PLAYERS, MAX_TOTAL_PLAYERS, NO_EXTENSIONS } from "../types/game";
import { assignSeatTeams } from "../online/teamAssignment";
import { createOnlineGame, joinOnlineGame, joinOnlineGameById, OnlineApiError } from "../online/api";
import { useOpenGames } from "../online/useOpenGames";
import KomiSelector from "./KomiSelector";
import TeamSplitPreview from "./TeamSplitPreview";
import ExtensionsSelector from "./ExtensionsSelector";
import OpenGamesPanel from "./OpenGamesPanel";
import "./GameSetup.css";
import "./CreateOnlineGame.css";

interface CreateOnlineGameProps {
  onCancel: () => void;
  onEntered: (gameId: string) => void;
}

const BOARD_SIZES: BoardSize[] = [9, 13, 19];

export default function CreateOnlineGame({ onCancel, onEntered }: CreateOnlineGameProps) {
  const [boardSize, setBoardSize] = useState<BoardSize>(9);
  const [maxPlayers, setMaxPlayers] = useState<number>(MIN_TOTAL_PLAYERS);
  const [creatorColor, setCreatorColor] = useState<Player>("black");
  const [komi, setKomi] = useState<number>(DEFAULT_KOMI);
  const [extensions, setExtensions] = useState<ExtensionRules>(NO_EXTENSIONS);
  const [displayName, setDisplayName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { games: openGames, loading: loadingGames } = useOpenGames();
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [isJoiningByCode, setIsJoiningByCode] = useState(false);

  const teamsPreview = useMemo<TeamRoster>(() => {
    const seatTeams = assignSeatTeams(creatorColor, maxPlayers);
    const teams: TeamRoster = { black: [], white: [] };
    seatTeams.forEach((team, index) => {
      teams[team].push(index === 0 ? "Tú" : `Jugador ${index + 1}`);
    });
    return teams;
  }, [creatorColor, maxPlayers]);

  const busy = isCreating || joiningId !== null || isJoiningByCode;

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const { game } = await createOnlineGame(
        boardSize,
        maxPlayers,
        komi,
        creatorColor,
        extensions,
        displayName.trim() || undefined
      );
      onEntered(game.id);
    } catch (err) {
      setError(err instanceof OnlineApiError ? err.message : "No se ha podido crear la partida.");
      setIsCreating(false);
    }
  };

  const handleJoinGame = async (id: string) => {
    setJoiningId(id);
    setJoinError(null);
    try {
      const { game } = await joinOnlineGameById(id, displayName.trim() || undefined);
      onEntered(game.id);
    } catch (err) {
      setJoinError(err instanceof OnlineApiError ? err.message : "No se ha podido unir a la partida.");
      setJoiningId(null);
    }
  };

  const handleJoinByCode = async () => {
    if (codeInput.trim().length === 0) return;
    setIsJoiningByCode(true);
    setJoinError(null);
    try {
      const { game } = await joinOnlineGame(codeInput.trim(), displayName.trim() || undefined);
      onEntered(game.id);
    } catch (err) {
      setJoinError(err instanceof OnlineApiError ? err.message : "No se ha podido unir a la partida.");
      setIsJoiningByCode(false);
    }
  };

  return (
    <div className="setup-screen">
      <div className="setup-content">
        <button className="link-button" onClick={onCancel} disabled={busy}>
          ← Atrás
        </button>

        <h1 className="setup-title">Jugar online</h1>
        <p className="setup-subtitle">
          Únete a una de las partidas abiertas de la lista, o elige tus parámetros y crea la tuya — cada plaza extra
          genera su propio enlace de invitación.
        </p>

        <section className="setup-section">
          <h2>Tamaño del tablero</h2>
          <div className="setup-options">
            {BOARD_SIZES.map((size) => (
              <button
                key={size}
                className={`setup-option ${boardSize === size ? "setup-option-active" : ""}`}
                onClick={() => setBoardSize(size)}
                disabled={busy}
              >
                {size} × {size}
              </button>
            ))}
          </div>
        </section>

        <section className="setup-section">
          <h2>
            Jugadores ({maxPlayers}/{MAX_TOTAL_PLAYERS})
          </h2>
          <div className="player-roster">
            {Array.from({ length: maxPlayers }, (_, index) => (
              <div className="player-roster-row" key={index}>
                <span className="setup-input online-seat-label">
                  {index === 0 ? "Tú (creador/a)" : `Jugador ${index + 1} — enlace de invitación`}
                </span>
                {index === maxPlayers - 1 && maxPlayers > MIN_TOTAL_PLAYERS && (
                  <button
                    type="button"
                    className="player-roster-remove"
                    onClick={() => setMaxPlayers((n) => n - 1)}
                    disabled={busy}
                    aria-label="Quitar plaza"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          {maxPlayers < MAX_TOTAL_PLAYERS && (
            <button
              type="button"
              className="btn btn-secondary player-roster-add"
              onClick={() => setMaxPlayers((n) => n + 1)}
              disabled={busy}
            >
              + Añadir jugador
            </button>
          )}
        </section>

        <TeamSplitPreview teams={teamsPreview} />

        <section className="setup-section">
          <h2>Tu color</h2>
          <div className="setup-options">
            <button
              className={`setup-option ${creatorColor === "black" ? "setup-option-active" : ""}`}
              onClick={() => setCreatorColor("black")}
              disabled={busy}
            >
              <span className="stone-dot stone-dot-black" /> Negras
            </button>
            <button
              className={`setup-option ${creatorColor === "white" ? "setup-option-active" : ""}`}
              onClick={() => setCreatorColor("white")}
              disabled={busy}
            >
              <span className="stone-dot stone-dot-white" /> Blancas
            </button>
          </div>
        </section>

        <KomiSelector komi={komi} onSelect={setKomi} disabled={busy} />

        <ExtensionsSelector extensions={extensions} onChange={setExtensions} disabled={busy} />

        <section className="setup-section">
          <h2>Tu nombre (opcional)</h2>
          <input
            className="setup-input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Invitado_XXXX"
            maxLength={24}
            disabled={busy}
          />
        </section>

        <section className="setup-section">
          <h2>Partidas abiertas</h2>

          <OpenGamesPanel
            games={openGames}
            loading={loadingGames}
            joiningId={joiningId}
            onJoin={(id) => void handleJoinGame(id)}
            disabled={busy}
            emptyHint="No hay partidas abiertas ahora mismo. Crea una para empezar."
          />

          <button
            type="button"
            className="link-button open-games-code-toggle"
            onClick={() => setShowCodeEntry((v) => !v)}
            disabled={busy}
          >
            {showCodeEntry ? "Ocultar código" : "¿Tienes un código?"}
          </button>

          {showCodeEntry && (
            <div className="open-games-code-entry">
              <input
                className="setup-input setup-input-code"
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="AB7K92"
                maxLength={6}
                disabled={busy}
                autoCapitalize="characters"
                autoComplete="off"
              />
              <button
                className="btn btn-secondary"
                onClick={() => void handleJoinByCode()}
                disabled={busy || codeInput.trim().length === 0}
              >
                {isJoiningByCode ? "Uniéndose…" : "Unirse con código"}
              </button>
            </div>
          )}

          {joinError && <p className="error-banner">{joinError}</p>}
        </section>

        {error && <p className="error-banner">{error}</p>}

        <button className="btn btn-primary setup-start" onClick={() => void handleCreate()} disabled={busy}>
          {isCreating ? "Creando…" : "Crear partida"}
        </button>
      </div>
    </div>
  );
}
