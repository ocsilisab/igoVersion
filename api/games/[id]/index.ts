import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildGameResponse, buildMutationResponse } from "../../../src/online/turns.js";
import { withHandler, readBody } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { ensureGuestId, readGuestId, sanitizeDisplayName, defaultGuestName } from "../../_lib/session.js";
import { findGameById, joinGameById, leaveGame, startGame } from "../../_lib/gameRepo.js";

interface ActionBody {
  action?: string;
  displayName?: string;
}

/**
 * GET fetches the current authoritative state of a game (initial load / reconnect
 * fallback). POST with {action: "join"|"start"|"leave"} runs the corresponding mutation
 * -- merged into this one file (rather than separate join.ts/start.ts/leave.ts) to stay
 * under Vercel Hobby's 12-serverless-function-per-deployment cap, now that the card
 * game's own routes need some of that budget too.
 */
export default withHandler(["GET", "POST"], async (req: VercelRequest, res: VercelResponse) => {
  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  if (req.method === "GET") {
    const game = await findGameById(id);
    if (!game) throw Errors.notFound();
    const guestId = readGuestId(req);
    res.status(200).json(buildGameResponse(game, guestId));
    return;
  }

  const body = readBody<ActionBody>(req);

  if (body.action === "join") {
    const allowed = await checkRateLimit(req, { action: "join_game", limit: 20, windowSeconds: 60 });
    if (!allowed) throw Errors.rateLimited();
    const guestId = ensureGuestId(req, res);
    const displayName = sanitizeDisplayName(body.displayName) ?? defaultGuestName(guestId);
    const game = await joinGameById(id, guestId, displayName);
    res.status(200).json(buildGameResponse(game, guestId));
    return;
  }

  if (body.action === "start") {
    const allowed = await checkRateLimit(req, { action: "start_game", limit: 20, windowSeconds: 60 });
    if (!allowed) throw Errors.rateLimited();
    const guestId = readGuestId(req);
    const updated = await startGame(id, guestId);
    res.status(200).json(buildMutationResponse(updated, guestId));
    return;
  }

  if (body.action === "leave") {
    const allowed = await checkRateLimit(req, { action: "leave", limit: 20, windowSeconds: 60 });
    if (!allowed) throw Errors.rateLimited();
    const guestId = readGuestId(req);
    const updated = await leaveGame(id, guestId);
    res.status(200).json(buildMutationResponse(updated, guestId));
    return;
  }

  throw Errors.badRequest("Acción no válida.");
});
