import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withHandler, readBody } from "../../../_lib/http.js";
import { checkRateLimit } from "../../../_lib/rateLimit.js";
import { Errors } from "../../../_lib/errors.js";
import { ensureGuestId } from "../../../_lib/session.js";
import { submitAnswer } from "../../../_lib/cardGameRepo.js";

interface AnswerBody {
  row?: unknown;
  col?: unknown;
}

/** Answers the player's current hand card -- checked server-side against its real solution. */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "card_game_answer", limit: 60, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = ensureGuestId(req, res);
  const body = readBody<AnswerBody>(req);
  if (typeof body.row !== "number" || typeof body.col !== "number") {
    throw Errors.badRequest("Jugada no válida.");
  }

  const { game, isHost } = await submitAnswer(id, guestId, body.row, body.col);
  res.status(200).json({ game, isHost });
});
