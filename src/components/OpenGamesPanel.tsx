import type { OpenGameSummary } from "../online/types";
import "./OpenGamesPanel.css";

interface OpenGamesPanelProps {
  games: OpenGameSummary[];
  loading: boolean;
  /** Id of the game currently being joined, if any — shows its button as busy. */
  joiningId: string | null;
  onJoin: (id: string) => void;
  /** Disables every "Unirse" button, e.g. while some other action is already in flight. */
  disabled?: boolean;
  emptyHint: string;
}

/** The public lobby list — shared by CreateOnlineGame (before playing) and OnlineGameScreen's
 * waiting room (so you can jump to another game instead of waiting for yours to fill up). */
export default function OpenGamesPanel({ games, loading, joiningId, onJoin, disabled, emptyHint }: OpenGamesPanelProps) {
  if (games.length === 0) {
    return <p className="open-games-hint">{loading ? "Buscando partidas…" : emptyHint}</p>;
  }

  return (
    <div className="open-games-list">
      {games.map((g) => (
        <div className="open-game-row" key={g.id}>
          <div className="open-game-info">
            <span className="open-game-size">
              {g.boardSize} × {g.boardSize}
            </span>
            <span className="open-game-meta">
              {g.blackCount + g.whiteCount}/{g.maxPlayers} jugadores · Komi {g.komi}
              {g.extensions.bombs ? " · Bombas" : ""}
              {g.extensions.stars ? " · Estrellas" : ""}
            </span>
          </div>
          <button className="btn btn-secondary" onClick={() => onJoin(g.id)} disabled={disabled}>
            {joiningId === g.id ? "Uniéndose…" : "Unirse"}
          </button>
        </div>
      ))}
    </div>
  );
}
