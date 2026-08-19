import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { GameResponse } from "../../src/online/types.js";
import { buildYouInfo } from "../../src/online/turns.js";
import { withHandler, readBody } from "../_lib/http.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import { Errors } from "../_lib/errors.js";
import { ensureGuestId, sanitizeDisplayName, defaultGuestName } from "../_lib/session.js";
import { joinGame } from "../_lib/gameRepo.js";
import { normalizeGameCode, isValidGameCode } from "../_lib/gameCode.js";

interface JoinGameBody {
  code?: string;
  displayName?: string;
}

/** Joins the roster of a `waiting` game — auto-assigned to whichever team is smaller. */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "join_game", limit: 20, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const guestId = ensureGuestId(req, res);
  const body = readBody<JoinGameBody>(req);
  const code = normalizeGameCode(body.code ?? "");

  if (!isValidGameCode(code)) throw Errors.invalidCode();

  const displayName = sanitizeDisplayName(body.displayName) ?? defaultGuestName(guestId);
  const game = await joinGame({ code, guestId, displayName });

  const response: GameResponse = { game, you: buildYouInfo(game, guestId) };
  res.status(200).json(response);
});
