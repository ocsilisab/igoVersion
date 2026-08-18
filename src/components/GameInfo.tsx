import type { Player } from "../types/game";

interface GameInfoProps {
  currentPlayer: Player;
  blackCaptures: number;
  whiteCaptures: number;
  consecutivePasses: number;
  gameOver: boolean;
}

export default function GameInfo({
  currentPlayer,
  blackCaptures,
  whiteCaptures,
  consecutivePasses,
  gameOver,
}: GameInfoProps) {
  return (
    <div className="game-info">
      {!gameOver && (
        <div className="turn-indicator">
          <span className={`stone-dot stone-dot-${currentPlayer}`} />
          Turno de {currentPlayer === "black" ? "Negras" : "Blancas"}
        </div>
      )}

      <div className="captures-row">
        <span className="capture-item">
          <span className="stone-dot stone-dot-black" /> Capturas: {blackCaptures}
        </span>
        <span className="capture-item">
          <span className="stone-dot stone-dot-white" /> Capturas: {whiteCaptures}
        </span>
      </div>

      {consecutivePasses > 0 && !gameOver && (
        <div className="pass-indicator">
          {consecutivePasses === 1 ? "Un jugador ha pasado" : "Ambos jugadores han pasado"}
        </div>
      )}
    </div>
  );
}
