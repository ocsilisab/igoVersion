import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withHandler, readBody } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { ensureGuestId, sanitizeDisplayName, defaultGuestName } from "../../_lib/session.js";
import { normalizeGameCode, isValidGameCode } from "../../_lib/gameCode.js";
import { joinCardGame } from "../../_lib/cardGameRepo.js";

interface JoinCardGameBody {
  code?: string;
  displayName?: string;
}

/** Joins a card-game pairing session by its host's code -- flips it to 'ready' for both sides. */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "join_card_game", limit: 20, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const guestId = ensureGuestId(req, res);
  const body = readBody<JoinCardGameBody>(req);
  if (typeof body.code !== "string") throw Errors.invalidCode();

  const code = normalizeGameCode(body.code);
  if (!isValidGameCode(code)) throw Errors.invalidCode();

  const displayName = sanitizeDisplayName(body.displayName) ?? defaultGuestName(guestId);
  const { game, isHost } = await joinCardGame(code, guestId, displayName);

  res.status(200).json({ game, isHost });
});
