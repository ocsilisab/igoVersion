import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withHandler, readBody } from "../../../_lib/http.js";
import { checkRateLimit } from "../../../_lib/rateLimit.js";
import { Errors } from "../../../_lib/errors.js";
import { ensureGuestId } from "../../../_lib/session.js";
import { submitHand } from "../../../_lib/cardGameRepo.js";

interface SubmitHandBody {
  deckIds?: unknown;
}

/** Submits this player's deck (their own 50-card selection, or fewer) so the server can draw their 5-card hand. */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "card_game_hand", limit: 20, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = ensureGuestId(req, res);
  const body = readBody<SubmitHandBody>(req);
  if (!Array.isArray(body.deckIds) || !body.deckIds.every((v) => typeof v === "string")) {
    throw Errors.badRequest("Baraja no válida.");
  }

  const { game, isHost } = await submitHand(id, guestId, body.deckIds);
  res.status(200).json({ game, isHost });
});
