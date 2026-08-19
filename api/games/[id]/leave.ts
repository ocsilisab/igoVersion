import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { GameMutationResponse } from "../../../src/online/types.js";
import { withHandler } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { readGuestId } from "../../_lib/session.js";
import { findGameById, resolveColor, applyGameUpdate } from "../../_lib/gameRepo.js";

/** Voluntary abandon. Idempotent: leaving an already-finished/abandoned game just returns it as-is. */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "leave", limit: 20, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = readGuestId(req);
  const game = await findGameById(id);
  if (!game) throw Errors.notFound();

  const color = resolveColor(game, guestId);
  if (!color) throw Errors.wrongColor();

  if (game.status === "finished" || game.status === "abandoned") {
    const response: GameMutationResponse = { game };
    res.status(200).json(response);
    return;
  }

  const updated = await applyGameUpdate(game, { status: "abandoned", abandoned_by: color });

  const response: GameMutationResponse = { game: updated };
  res.status(200).json(response);
});
