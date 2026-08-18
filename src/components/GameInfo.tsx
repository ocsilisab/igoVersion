import type { Player } from "../types/game";

interface GameInfoProps {
  currentPlayer: Player;
  blackCaptures: number;
  whiteCaptures: number;
  consecutivePasses: number;
  gameOver: boolean;
  /** Present only in "vs IA" mode; when set together with aiColor, shows player/IA roles. */
  playerColor?: Player;
  aiColor?: Player;
  isAiThinking?: boolean;
}

export default function GameInfo({
  currentPlayer,
  blackCaptures,
  whiteCaptures,
  consecutivePasses,
  gameOver,
  playerColor,
  aiColor,
  isAiThinking,
}: GameInfoProps) {
  const isVsAi = playerColor !== undefined && aiColor !== undefined;

  return (
    <div className="game-info">
      {isVsAi && (
        <div className="vs-ai-roles">
          <span>
            <span className={`stone-dot stone-dot-${playerColor}`} /> Jugador:{" "}
            {playerColor === "black" ? "Negras" : "Blancas"}
          </span>
          <span>
            <span className={`stone-dot stone-dot-${aiColor}`} /> IA: {aiColor === "black" ? "Negras" : "Blancas"}
          </span>
        </div>
      )}

      {!gameOver && (
        <div className="turn-indicator">
          <span className={`stone-dot stone-dot-${currentPlayer}`} />
          {isVsAi
            ? currentPlayer === playerColor
              ? "Tu turno"
              : "Turno de la IA"
            : `Turno de ${currentPlayer === "black" ? "Negras" : "Blancas"}`}
        </div>
      )}

      {isVsAi && isAiThinking && !gameOver && <div className="ai-thinking">La IA está pensando…</div>}

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
