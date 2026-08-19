import type { Player, ScoreResult } from "../types/game";

interface GameInfoProps {
  currentPlayer: Player;
  blackCaptures: number;
  whiteCaptures: number;
  consecutivePasses: number;
  gameOver: boolean;
  isAiThinking?: boolean;
  /** True once both players have passed in a row and dead stones are being marked. */
  isScoring?: boolean;
  scoringPreview?: ScoreResult | null;
  /** Full team rosters (names/labels) — shown as a roles row whenever a team has more than one member. */
  teamsRoster?: { black: string[]; white: string[] };
  /** Whoever's turn it specifically is within the active color's team, e.g. "Ana". */
  activePlayerName?: string;
  /** AI/online screens always show the roster row (identifies who's who), even for a plain 1v1. */
  alwaysShowRoster?: boolean;
}

export default function GameInfo({
  currentPlayer,
  blackCaptures,
  whiteCaptures,
  consecutivePasses,
  gameOver,
  isAiThinking,
  isScoring,
  scoringPreview,
  teamsRoster,
  activePlayerName,
  alwaysShowRoster,
}: GameInfoProps) {
  const showRoster =
    teamsRoster !== undefined && (alwaysShowRoster || teamsRoster.black.length > 1 || teamsRoster.white.length > 1);

  return (
    <div className="game-info">
      {showRoster && teamsRoster && (
        <div className="vs-ai-roles">
          <span>
            <span className="stone-dot stone-dot-black" /> Negras: {teamsRoster.black.join(", ")}
          </span>
          <span>
            <span className="stone-dot stone-dot-white" /> Blancas: {teamsRoster.white.join(", ")}
          </span>
        </div>
      )}

      {isScoring ? (
        <div className="scoring-notice">
          Fin de la partida: marca las piedras muertas y pulsa <strong>Finalizar partida</strong>.
        </div>
      ) : (
        !gameOver && (
          <div className="turn-indicator">
            <span className={`stone-dot stone-dot-${currentPlayer}`} />
            {`Turno de ${currentPlayer === "black" ? "Negras" : "Blancas"}`}
            {activePlayerName && ` — ${activePlayerName}`}
          </div>
        )
      )}

      {isAiThinking && !gameOver && <div className="ai-thinking">La IA está pensando…</div>}

      <div className="captures-row">
        <span className="capture-item">
          <span className="stone-dot stone-dot-black" /> Capturas: {blackCaptures}
        </span>
        <span className="capture-item">
          <span className="stone-dot stone-dot-white" /> Capturas: {whiteCaptures}
        </span>
      </div>

      {isScoring && scoringPreview && (
        <div className="scoring-estimate">
          Estimado: Negras {scoringPreview.blackScore} · Blancas {scoringPreview.whiteScore}
        </div>
      )}

      {!isScoring && consecutivePasses > 0 && !gameOver && (
        <div className="pass-indicator">
          {consecutivePasses === 1 ? "Un jugador ha pasado" : "Ambos jugadores han pasado"}
        </div>
      )}
    </div>
  );
}
