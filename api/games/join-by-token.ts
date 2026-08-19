import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildGameResponse } from "../../src/online/turns.js";
import { withHandler, readBody } from "../_lib/http.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import { Errors } from "../_lib/errors.js";
import { ensureGuestId, sanitizeDisplayName, defaultGuestName } from "../_lib/session.js";
import { claimSeatByToken } from "../_lib/gameRepo.js";

interface JoinByTokenBody {
  token?: string;
  displayName?: string;
}

/** A specific player's personal invite link (`?game=<id>&token=<token>`): claims exactly that seat/team. */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "join_game", limit: 20, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const body = readBody<JoinByTokenBody>(req);
  if (typeof body.token !== "string" || body.token.length === 0) {
    throw Errors.badRequest("Enlace de invitación no válido.");
  }

  const guestId = ensureGuestId(req, res);
  const displayName = sanitizeDisplayName(body.displayName) ?? defaultGuestName(guestId);
  const game = await claimSeatByToken(body.token, guestId, displayName);

  res.status(200).json(buildGameResponse(game, guestId));
});
