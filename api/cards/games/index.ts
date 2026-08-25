import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withHandler, readBody } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { ensureGuestId, sanitizeDisplayName, defaultGuestName } from "../../_lib/session.js";
import { normalizeGameCode, isValidGameCode } from "../../_lib/gameCode.js";
import { createCardGame, joinCardGame } from "../../_lib/cardGameRepo.js";

interface CardGamesBody {
  action?: string;
  code?: string;
  displayName?: string;
}

/**
 * {action: "create"} makes a new card-game pairing session (the caller becomes its host,
 * gets a shareable code). {action: "join", code} joins one by that code -- flips it to
 * 'ready' for both sides. Merged into one file (rather than separate create/join routes)
 * to stay under Vercel Hobby's 12-serverless-function-per-deployment cap.
 */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const body = readBody<CardGamesBody>(req);

  if (body.action === "join") {
    const allowed = await checkRateLimit(req, { action: "join_card_game", limit: 20, windowSeconds: 60 });
    if (!allowed) throw Errors.rateLimited();

    const guestId = ensureGuestId(req, res);
    if (typeof body.code !== "string") throw Errors.invalidCode();
    const code = normalizeGameCode(body.code);
    if (!isValidGameCode(code)) throw Errors.invalidCode();

    const displayName = sanitizeDisplayName(body.displayName) ?? defaultGuestName(guestId);
    const { game, isHost } = await joinCardGame(code, guestId, displayName);
    res.status(200).json({ game, isHost });
    return;
  }

  const allowed = await checkRateLimit(req, { action: "create_card_game", limit: 10, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const guestId = ensureGuestId(req, res);
  const displayName = sanitizeDisplayName(body.displayName) ?? defaultGuestName(guestId);
  const game = await createCardGame(guestId, displayName);
  res.status(201).json({ game, isHost: true });
});
