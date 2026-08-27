import type { Player, ScoreResult } from "../types/game";

interface GameOverModalProps {
  /** Absent for a timeout ending -- there's no ScoreResult since the game never reached
   * finalizeScoring. */
  score?: ScoreResult | null;
  /** Only meaningful (and required) when `score` is absent. */
  winner?: Player | "draw" | null;
  winReason?: "score" | "timeout";
  onPlayAgain: () => void;
  onExit: () => void;
  /** Overrides the "Jugar de nuevo" button text -- e.g. online games show progress while the rematch is being created. */
  playAgainLabel?: string;
  playAgainDisabled?: boolean;
}

function winnerLabel(winner: Player | "draw" | null | undefined): string {
  if (winner === "draw") return "Empate";
  return winner === "black" ? "Ganan las Negras" : "Ganan las Blancas";
}

/**
 * Rendered inline right after the final board (never a blocking overlay) so the board —
 * still showing every dead group crossed out — stays visible next to the score table.
 */
export default function GameOverModal({
  score,
  winner,
  winReason = "score",
  onPlayAgain,
  onExit,
  playAgainLabel = "Jugar de nuevo",
  playAgainDisabled = false,
}: GameOverModalProps) {
  const resolvedWinner = score ? score.winner : winner;

  if (winReason === "timeout" || !score) {
    return (
      <div className="game-over-panel" role="region" aria-labelledby="game-over-title">
        <h2 id="game-over-title">Partida finalizada</h2>
        <p className="winner-label">{winnerLabel(resolvedWinner)} — por tiempo</p>

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

  return (
    <div className="game-over-panel" role="region" aria-labelledby="game-over-title">
      <h2 id="game-over-title">Partida finalizada</h2>
      <p className="winner-label">{winnerLabel(resolvedWinner)}</p>

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
