import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildMutationResponse } from "../../../src/online/turns.js";
import { withHandler } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { readGuestId } from "../../_lib/session.js";
import { startGame } from "../../_lib/gameRepo.js";

/**
 * Creator-only: moves the game from `waiting` to `playing` once at least one active
 * player is on each team. Lets a game grow past the classic 1v1 (up to 6 total) before
 * anyone actually starts, instead of auto-starting the moment a second player joins.
 */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "start_game", limit: 20, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = readGuestId(req);
  const updated = await startGame(id, guestId);

  res.status(200).json(buildMutationResponse(updated, guestId));
});
