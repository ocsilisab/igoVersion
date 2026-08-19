import { KOMI_OPTIONS } from "../types/game";

interface KomiSelectorProps {
  komi: number;
  onSelect: (komi: number) => void;
  disabled?: boolean;
}

export default function KomiSelector({ komi, onSelect, disabled }: KomiSelectorProps) {
  return (
    <section className="setup-section">
      <h2>Komi</h2>
      <div className="setup-options">
        {KOMI_OPTIONS.map((value) => (
          <button
            key={value}
            className={`setup-option ${komi === value ? "setup-option-active" : ""}`}
            onClick={() => onSelect(value)}
            disabled={disabled}
          >
            {value}
          </button>
        ))}
      </div>
      <p className="setup-hint">Puntos de compensación para Blancas al finalizar la partida.</p>
    </section>
  );
}
