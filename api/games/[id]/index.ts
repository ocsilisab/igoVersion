import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { GameResponse } from "../../../src/online/types.js";
import { withHandler } from "../../_lib/http.js";
import { Errors } from "../../_lib/errors.js";
import { readGuestId } from "../../_lib/session.js";
import { findGameById, resolveColor } from "../../_lib/gameRepo.js";

/**
 * Fetches the current authoritative state of a game — used both for the initial load
 * and as the reconnect/refresh fallback (a browser reload always calls this to recover
 * the game rather than trusting any client-side cache).
 */
export default withHandler(["GET"], async (req: VercelRequest, res: VercelResponse) => {
  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const game = await findGameById(id);
  if (!game) throw Errors.notFound();

  const guestId = readGuestId(req);
  const color = resolveColor(game, guestId);
  const displayName = (color === "black" ? game.blackName : color === "white" ? game.whiteName : null) ?? "";

  const response: GameResponse = {
    game,
    you: { guestId: guestId ?? "", userType: "guest", color, displayName },
  };
  res.status(200).json(response);
});
