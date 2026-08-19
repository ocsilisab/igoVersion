import type { VercelRequest, VercelResponse } from "@vercel/node";
import { opponent } from "../../../src/utils/board.js";
import type { GameMutationResponse } from "../../../src/online/types.js";
import { withHandler } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { readGuestId } from "../../_lib/session.js";
import { loadGameForPlayer, applyGameUpdate } from "../../_lib/gameRepo.js";

const PASSES_TO_END_ACTIVE_PLAY = 2;

export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "pass", limit: 30, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = readGuestId(req);
  const { game, color } = await loadGameForPlayer(id, guestId);

  if (game.isScoring) throw Errors.invalidMove("La partida está en fase de puntuación.");
  if (game.currentPlayer !== color) throw Errors.notYourTurn();

  const consecutivePasses = game.consecutivePasses + 1;
  const nextPlayer = opponent(color);

  const updated = await applyGameUpdate(game, {
    consecutive_passes: consecutivePasses,
    current_player: nextPlayer,
    is_scoring: consecutivePasses >= PASSES_TO_END_ACTIVE_PLAY,
  });

  const response: GameMutationResponse = { game: updated };
  res.status(200).json(response);
});
