import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildMutationResponse } from "../../../src/online/turns.js";
import { withHandler } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { readGuestId } from "../../_lib/session.js";
import { leaveGame } from "../../_lib/gameRepo.js";

/**
 * Voluntary leave/abandon. Idempotent: leaving an already-finished/abandoned game just
 * returns it as-is. Behavior depends on when it happens — see gameRepo.ts::leaveGame:
 * before the game starts, the creator leaving cancels the room, but anyone else leaving
 * just frees their seat back to "pending" for someone else to claim; mid-game, the game
 * continues without the leaver (their rotation slot is skipped if it was their turn)
 * unless it was the last active member of their team, which ends the game.
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
