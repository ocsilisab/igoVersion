interface PlayerRosterProps {
  title: string;
  players: string[];
  onChange: (players: string[]) => void;
  min: number;
  max: number;
  disabled?: boolean;
}

/** Add/remove/rename a list of player names, used by every local (solo/AI) setup screen. */
export default function PlayerRoster({ title, players, onChange, min, max, disabled }: PlayerRosterProps) {
  const addPlayer = () => {
    if (players.length >= max) return;
    onChange([...players, `Jugador ${players.length + 1}`]);
  };

  const removePlayer = (index: number) => {
    if (players.length <= min) return;
    onChange(players.filter((_, i) => i !== index));
  };

  const renamePlayer = (index: number, name: string) => {
    onChange(players.map((p, i) => (i === index ? name : p)));
  };

  return (
    <section className="setup-section">
      <h2>
        {title} ({players.length}/{max})
      </h2>
      <div className="player-roster">
        {players.map((name, index) => (
          <div className="player-roster-row" key={index}>
            <input
              className="setup-input"
              type="text"
              value={name}
              onChange={(e) => renamePlayer(index, e.target.value)}
              maxLength={24}
              disabled={disabled}
            />
            {players.length > min && (
              <button
                type="button"
                className="player-roster-remove"
                onClick={() => removePlayer(index)}
                disabled={disabled}
                aria-label={`Quitar a ${name || `jugador ${index + 1}`}`}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {players.length < max && (
        <button type="button" className="btn btn-secondary player-roster-add" onClick={addPlayer} disabled={disabled}>
          + Añadir jugador
        </button>
      )}
    </section>
  );
}
