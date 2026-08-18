interface GameControlsProps {
  onPass: () => void;
  onReset: () => void;
  disabled?: boolean;
  /** True once both players have passed in a row: shows "Finalizar partida" instead of "Pasar". */
  isScoring?: boolean;
  onFinalize?: () => void;
}

export default function GameControls({ onPass, onReset, disabled, isScoring, onFinalize }: GameControlsProps) {
  return (
    <div className="game-controls">
      {isScoring ? (
        <button className="btn btn-primary" onClick={onFinalize}>
          Finalizar partida
        </button>
      ) : (
        <button className="btn btn-primary" onClick={onPass} disabled={disabled}>
          Pasar
        </button>
      )}
      <button className="btn btn-secondary" onClick={onReset}>
        Reiniciar partida
      </button>
    </div>
  );
}
