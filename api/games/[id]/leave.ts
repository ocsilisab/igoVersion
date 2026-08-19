import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildMutationResponse } from "../../../src/online/turns.js";
import { withHandler } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { readGuestId } from "../../_lib/session.js";
import { leaveGame } from "../../_lib/gameRepo.js";

/**
 * Voluntary abandon. Idempotent: leaving an already-finished/abandoned game just
 * returns it as-is. If the leaver's team still has other active members, the game
 * continues without them (their rotation slot is skipped if it was their turn); only
 * once a whole team hits zero active members does the game become `abandoned`.
 */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "leave", limit: 20, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = readGuestId(req);
  const updated = await leaveGame(id, guestId);

  res.status(200).json(buildMutationResponse(updated, guestId));
});
