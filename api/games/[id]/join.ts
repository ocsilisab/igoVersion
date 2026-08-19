import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildGameResponse } from "../../../src/online/turns.js";
import { withHandler, readBody } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { ensureGuestId, sanitizeDisplayName, defaultGuestName } from "../../_lib/session.js";
import { joinGameById } from "../../_lib/gameRepo.js";

interface JoinBody {
  displayName?: string;
}

/** The generic per-game link (`?game=<id>`, no invite token): claims whichever pending seat balances the teams. */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "join_game", limit: 20, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = ensureGuestId(req, res);
  const body = readBody<JoinBody>(req);
  const displayName = sanitizeDisplayName(body.displayName) ?? defaultGuestName(guestId);
  const game = await joinGameById(id, guestId, displayName);

  res.status(200).json(buildGameResponse(game, guestId));
});
