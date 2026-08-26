import type { VercelRequest, VercelResponse } from "@vercel/node";
import { calculateScore, removeDeadStones } from "../../../src/utils/scoring.js";
import { buildMutationResponse } from "../../../src/online/turns.js";
import { withHandler } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { readGuestId } from "../../_lib/session.js";
import { loadPlayableGame, applyGameUpdate } from "../../_lib/gameRepo.js";

/**
 * Either player can *call* this, but it only succeeds once both teams have confirmed the
 * current dead_stones (see mark-dead.ts's "confirm" action) -- otherwise one player could
 * mark the opponent's live groups dead and lock in the score before the opponent gets a
 * chance to object or re-mark anything. This is the one check that actually enforces
 * mutual agreement; the confirmation itself is just data until this route reads it.
 */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "finalize", limit: 20, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = readGuestId(req);
  const { game } = await loadPlayableGame(id, guestId);

  if (!game.isScoring) throw Errors.invalidMove("La partida no está en fase de puntuación.");

  const confirmedByBoth =
    game.deadStonesConfirmedTeams.includes("black") && game.deadStonesConfirmedTeams.includes("white");
  if (!confirmedByBoth) {
    throw Errors.badRequest("Ambos equipos deben confirmar qué piedras están muertas antes de finalizar.");
  }

  // Dead stones are only removed for the *score calculation* — the stored board keeps
  // showing them (still crossed out via dead_stones) so the final board stays reviewable
  // next to the score table instead of jumping straight to an empty-looking result.
  const { board: cleanedBoard, deadBlack, deadWhite } = removeDeadStones(game.board, new Set(game.deadStones));
  const blackCaptures = game.blackCaptures + deadWhite;
  const whiteCaptures = game.whiteCaptures + deadBlack;
  const score = calculateScore(cleanedBoard, game.boardSize, blackCaptures, whiteCaptures, game.komi);

  const updated = await applyGameUpdate(game, {
    black_captures: blackCaptures,
    white_captures: whiteCaptures,
    is_scoring: false,
    status: "finished",
    winner: score.winner,
    score,
  });

  res.status(200).json(buildMutationResponse(updated, guestId));
});
