import type { VercelRequest, VercelResponse } from "@vercel/node";
import { toggleDeadStoneGroup } from "../../../src/utils/deadStones.js";
import type { GameMutationResponse } from "../../../src/online/types.js";
import { withHandler, readBody } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { readGuestId } from "../../_lib/session.js";
import { loadGameForPlayer, applyGameUpdate } from "../../_lib/gameRepo.js";

interface MarkDeadBody {
  row?: number;
  col?: number;
}

/** Either player can mark/unmark a group during the post-double-pass scoring phase. */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "mark_dead", limit: 60, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = readGuestId(req);
  const { game } = await loadGameForPlayer(id, guestId);

  if (!game.isScoring) throw Errors.invalidMove("La partida no está en fase de puntuación.");

  const body = readBody<MarkDeadBody>(req);
  const { row, col } = body;
  if (
    typeof row !== "number" ||
    typeof col !== "number" ||
    row < 0 ||
    col < 0 ||
    row >= game.boardSize ||
    col >= game.boardSize
  ) {
    throw Errors.badRequest("Posición fuera del tablero.");
  }
  if (game.board[row][col] === null) throw Errors.badRequest("Esa intersección está vacía.");

  const nextDeadStones = toggleDeadStoneGroup(game.board, game.boardSize, { row, col }, new Set(game.deadStones));

  const updated = await applyGameUpdate(game, { dead_stones: Array.from(nextDeadStones) });

  const response: GameMutationResponse = { game: updated };
  res.status(200).json(response);
});
