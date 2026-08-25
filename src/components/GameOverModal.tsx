import type { ScoreResult } from "../types/game";

interface GameOverModalProps {
  score: ScoreResult;
  onPlayAgain: () => void;
  onExit: () => void;
  /** Overrides the "Jugar de nuevo" button text -- e.g. online games show progress while the rematch is being created. */
  playAgainLabel?: string;
  playAgainDisabled?: boolean;
}

function winnerLabel(score: ScoreResult): string {
  if (score.winner === "draw") return "Empate";
  return score.winner === "black" ? "Ganan las Negras" : "Ganan las Blancas";
}

/**
 * Rendered inline right after the final board (never a blocking overlay) so the board —
 * still showing every dead group crossed out — stays visible next to the score table.
 */
export default function GameOverModal({
  score,
  onPlayAgain,
  onExit,
  playAgainLabel = "Jugar de nuevo",
  playAgainDisabled = false,
}: GameOverModalProps) {
  return (
    <div className="game-over-panel" role="region" aria-labelledby="game-over-title">
      <h2 id="game-over-title">Partida finalizada</h2>
      <p className="winner-label">{winnerLabel(score)}</p>

      <table className="score-table">
        <thead>
          <tr>
            <th></th>
            <th>Negras</th>
            <th>Blancas</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Piedras</td>
            <td>{score.blackStones}</td>
            <td>{score.whiteStones}</td>
          </tr>
          <tr>
            <td>Territorio</td>
            <td>{score.blackTerritory}</td>
            <td>{score.whiteTerritory}</td>
          </tr>
          <tr>
            <td>Capturas</td>
            <td>{score.blackCaptures}</td>
            <td>{score.whiteCaptures}</td>
          </tr>
          <tr>
            <td>Komi</td>
            <td>—</td>
            <td>{score.komi}</td>
          </tr>
          <tr className="total-row">
            <td>Total</td>
            <td>{score.blackScore}</td>
            <td>{score.whiteScore}</td>
          </tr>
        </tbody>
      </table>

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onExit}>
          Volver al inicio
        </button>
        <button className="btn btn-primary" onClick={onPlayAgain} disabled={playAgainDisabled}>
          {playAgainLabel}
        </button>
      </div>
    </div>
  );
}
