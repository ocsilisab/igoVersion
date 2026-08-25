import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withHandler, readBody } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { ensureGuestId, sanitizeDisplayName, defaultGuestName } from "../../_lib/session.js";
import { createCardGame } from "../../_lib/cardGameRepo.js";

interface CreateCardGameBody {
  displayName?: string;
}

/** Creates a new card-game pairing session: the caller becomes its host and gets a shareable code. */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "create_card_game", limit: 10, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const guestId = ensureGuestId(req, res);
  const body = readBody<CreateCardGameBody>(req);
  const displayName = sanitizeDisplayName(body.displayName) ?? defaultGuestName(guestId);

  const game = await createCardGame(guestId, displayName);
  res.status(201).json({ game, isHost: true });
});
