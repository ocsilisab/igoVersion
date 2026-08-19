import type { VercelRequest, VercelResponse } from "@vercel/node";
import { calculateScore, removeDeadStones } from "../../../src/utils/scoring.js";
import type { GameMutationResponse } from "../../../src/online/types.js";
import { withHandler } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { readGuestId } from "../../_lib/session.js";
import { loadPlayableGame, applyGameUpdate } from "../../_lib/gameRepo.js";

/** Either player can confirm the final score once dead stones are marked. */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "finalize", limit: 20, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = readGuestId(req);
  const { game } = await loadPlayableGame(id, guestId);

  if (!game.isScoring) throw Errors.invalidMove("La partida no está en fase de puntuación.");

  const { board: cleanedBoard, deadBlack, deadWhite } = removeDeadStones(game.board, new Set(game.deadStones));
  const blackCaptures = game.blackCaptures + deadWhite;
  const whiteCaptures = game.whiteCaptures + deadBlack;
  const score = calculateScore(cleanedBoard, game.boardSize, blackCaptures, whiteCaptures, game.komi);

  const updated = await applyGameUpdate(game, {
    board: cleanedBoard,
    black_captures: blackCaptures,
    white_captures: whiteCaptures,
    is_scoring: false,
    status: "finished",
    winner: score.winner,
    score,
  });

  const response: GameMutationResponse = { game: updated };
  res.status(200).json(response);
});
