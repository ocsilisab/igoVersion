interface GameControlsProps {
  onPass: () => void;
  onReset: () => void;
  disabled?: boolean;
}

export default function GameControls({ onPass, onReset, disabled }: GameControlsProps) {
  return (
    <div className="game-controls">
      <button className="btn btn-primary" onClick={onPass} disabled={disabled}>
        Pasar
      </button>
      <button className="btn btn-secondary" onClick={onReset}>
        Reiniciar partida
      </button>
    </div>
  );
}
