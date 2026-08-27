import { useMemo, useState } from "react";
import { BOARD_SIZES, type BoardSize, type ExtensionRules, type TeamRoster } from "../types/game";
import { DEFAULT_KOMI, MAX_TOTAL_PLAYERS, MIN_TOTAL_PLAYERS, NO_EXTENSIONS } from "../types/game";
import type { TimeControl } from "../utils/clock";
import { splitIntoTeams } from "../utils/teams";
import KomiSelector from "./KomiSelector";
import PlayerRoster from "./PlayerRoster";
import TeamSplitPreview from "./TeamSplitPreview";
import ExtensionsSelector from "./ExtensionsSelector";
import TimeControlSelector from "./TimeControlSelector";
import "./GameSetup.css";

interface SoloSetupProps {
  onStart: (
    boardSize: BoardSize,
    komi: number,
    teams: TeamRoster,
    extensions: ExtensionRules,
    timeControl: TimeControl | null
  ) => void;
  onCancel: () => void;
}


export default function SoloSetup({ onStart, onCancel }: SoloSetupProps) {
  const [boardSize, setBoardSize] = useState<BoardSize>(9);
  const [komi, setKomi] = useState<number>(DEFAULT_KOMI);
  const [players, setPlayers] = useState<string[]>(["Negras", "Blancas"]);
  const [extensions, setExtensions] = useState<ExtensionRules>(NO_EXTENSIONS);
  const [timeControl, setTimeControl] = useState<TimeControl | null>(null);

  const teams = useMemo(() => splitIntoTeams(players), [players]);

  return (
    <div className="setup-screen">
      <div className="setup-content">
        <button className="link-button" onClick={onCancel}>
          ← Inicio
        </button>

        <h1 className="setup-title">Jugar solo</h1>
        <p className="setup-subtitle">
          Configura la partida antes de empezar. Mismo dispositivo — añade jugadores para formar equipos.
        </p>

        <section className="setup-section">
          <h2>Tamaño del tablero</h2>
          <div className="setup-options">
            {BOARD_SIZES.map((size) => (
              <button
                key={size}
                className={`setup-option ${boardSize === size ? "setup-option-active" : ""}`}
                onClick={() => setBoardSize(size)}
              >
                {size} × {size}
              </button>
            ))}
          </div>
        </section>

        <PlayerRoster
          title="Jugadores"
          players={players}
          onChange={setPlayers}
          min={MIN_TOTAL_PLAYERS}
          max={MAX_TOTAL_PLAYERS}
        />

        <TeamSplitPreview teams={teams} />

        <KomiSelector komi={komi} onSelect={setKomi} />

        <ExtensionsSelector extensions={extensions} onChange={setExtensions} />

        <TimeControlSelector value={timeControl} onChange={setTimeControl} />

        <button
          className="btn btn-primary setup-start"
          onClick={() => onStart(boardSize, komi, teams, extensions, timeControl)}
        >
          Empezar partida
        </button>
      </div>
    </div>
  );
}
