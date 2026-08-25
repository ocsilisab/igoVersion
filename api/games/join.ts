import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildGameResponse } from "../../src/online/turns.js";
import { withHandler, readBody } from "../_lib/http.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import { Errors } from "../_lib/errors.js";
import { ensureGuestId, sanitizeDisplayName, defaultGuestName } from "../_lib/session.js";
import { joinGame, claimSeatByToken } from "../_lib/gameRepo.js";
import { normalizeGameCode, isValidGameCode } from "../_lib/gameCode.js";

interface JoinGameBody {
  code?: string;
  token?: string;
  displayName?: string;
}

/**
 * Joins a game either by its share code or by a specific seat's personal invite token --
 * merged into one file (rather than a separate join-by-token.ts) to stay under Vercel
 * Hobby's 12-serverless-function-per-deployment cap; see [id]/index.ts's doc comment.
 */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "join_game", limit: 20, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const body = readBody<JoinGameBody>(req);
  const guestId = ensureGuestId(req, res);
  const displayName = sanitizeDisplayName(body.displayName) ?? defaultGuestName(guestId);

  if (typeof body.token === "string" && body.token.length > 0) {
    const game = await claimSeatByToken(body.token, guestId, displayName);
    res.status(200).json(buildGameResponse(game, guestId));
    return;
  }

  const code = normalizeGameCode(body.code ?? "");
  if (!isValidGameCode(code)) throw Errors.invalidCode();
  const game = await joinGame({ code, guestId, displayName });
  res.status(200).json(buildGameResponse(game, guestId));
});
