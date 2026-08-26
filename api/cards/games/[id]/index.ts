import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withHandler, readBody } from "../../../_lib/http.js";
import { checkRateLimit } from "../../../_lib/rateLimit.js";
import { Errors } from "../../../_lib/errors.js";
import { ensureGuestId, readGuestId } from "../../../_lib/session.js";
import { findCardGameById, rematchCardGame, submitAnswer, submitHand } from "../../../_lib/cardGameRepo.js";

interface ActionBody {
  action?: string;
  deckIds?: unknown;
  row?: unknown;
  col?: unknown;
}

/**
 * GET fetches the current state of a card-game session (initial load, reload recovery,
 * Realtime/polling refresh). POST {action: "hand", deckIds} submits this player's deck
 * so the server can draw their 5-card hand; POST {action: "answer", row, col} answers
 * their current hand card, checked server-side against its real solution. POST
 * {action: "rematch"} resets a finished match back to 'ready' for the same two players.
 * Merged into one file (rather than separate hand.ts/answer.ts/rematch.ts) to stay under
 * Vercel Hobby's 12-serverless-function-per-deployment cap.
 */
export default withHandler(["GET", "POST"], async (req: VercelRequest, res: VercelResponse) => {
  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  if (req.method === "GET") {
    const guestId = readGuestId(req);
    const found = await findCardGameById(id, guestId);
    if (!found) throw Errors.notFound();
    res.status(200).json({ game: found.game, isHost: found.isHost(guestId) });
    return;
  }

  const body = readBody<ActionBody>(req);

  if (body.action === "hand") {
    const allowed = await checkRateLimit(req, { action: "card_game_hand", limit: 20, windowSeconds: 60 });
    if (!allowed) throw Errors.rateLimited();
    if (
      !Array.isArray(body.deckIds) ||
      body.deckIds.length === 0 ||
      body.deckIds.length > 200 ||
      !body.deckIds.every((v) => typeof v === "string")
    ) {
      throw Errors.badRequest("Baraja no válida.");
    }
    const guestId = ensureGuestId(req, res);
    const { game, isHost } = await submitHand(id, guestId, body.deckIds);
    res.status(200).json({ game, isHost });
    return;
  }

  if (body.action === "answer") {
    const allowed = await checkRateLimit(req, { action: "card_game_answer", limit: 60, windowSeconds: 60 });
    if (!allowed) throw Errors.rateLimited();
    if (typeof body.row !== "number" || typeof body.col !== "number") {
      throw Errors.badRequest("Jugada no válida.");
    }
    const guestId = ensureGuestId(req, res);
    const { game, isHost } = await submitAnswer(id, guestId, body.row, body.col);
    res.status(200).json({ game, isHost });
    return;
  }

  if (body.action === "rematch") {
    const allowed = await checkRateLimit(req, { action: "card_game_rematch", limit: 20, windowSeconds: 60 });
    if (!allowed) throw Errors.rateLimited();
    const guestId = ensureGuestId(req, res);
    const { game, isHost } = await rematchCardGame(id, guestId);
    res.status(200).json({ game, isHost });
    return;
  }

  throw Errors.badRequest("Acción no válida.");
});
