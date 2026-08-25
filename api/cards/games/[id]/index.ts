import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withHandler } from "../../../_lib/http.js";
import { Errors } from "../../../_lib/errors.js";
import { readGuestId } from "../../../_lib/session.js";
import { findCardGameById } from "../../../_lib/cardGameRepo.js";

/** Fetches the current state of a card-game pairing session -- used for the initial load, reload recovery, and the Realtime/polling refresh. */
export default withHandler(["GET"], async (req: VercelRequest, res: VercelResponse) => {
  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const found = await findCardGameById(id);
  if (!found) throw Errors.notFound();

  const guestId = readGuestId(req);
  res.status(200).json({ game: found.game, isHost: found.isHost(guestId) });
});
