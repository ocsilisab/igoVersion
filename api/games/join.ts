import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { GameResponse } from "../../src/online/types";
import { withHandler, readBody } from "../_lib/http";
import { checkRateLimit } from "../_lib/rateLimit";
import { Errors } from "../_lib/errors";
import { ensureGuestId, sanitizeDisplayName, defaultGuestName } from "../_lib/session";
import { joinGame, resolveColor } from "../_lib/gameRepo";
import { normalizeGameCode, isValidGameCode } from "../_lib/gameCode";

interface JoinGameBody {
  code?: string;
  displayName?: string;
}

export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "join_game", limit: 20, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const guestId = ensureGuestId(req, res);
  const body = readBody<JoinGameBody>(req);
  const code = normalizeGameCode(body.code ?? "");

  if (!isValidGameCode(code)) throw Errors.invalidCode();

  const displayName = sanitizeDisplayName(body.displayName) ?? defaultGuestName(guestId);
  const game = await joinGame({ code, guestId, displayName });
  const color = resolveColor(game, guestId);

  const response: GameResponse = {
    game,
    you: { guestId, userType: "guest", color, displayName: color === "white" ? displayName : game.blackName },
  };
  res.status(200).json(response);
});
