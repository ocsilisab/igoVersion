import type { VercelRequest, VercelResponse } from "@vercel/node";
import { opponent } from "../../../src/utils/board.js";
import { tryMove, MOVE_ERROR_MESSAGES } from "../../../src/utils/move.js";
import { buildMutationResponse } from "../../../src/online/turns.js";
import { withHandler, readBody } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { readGuestId } from "../../_lib/session.js";
import { loadActiveGameForPlayer, applyGameUpdate } from "../../_lib/gameRepo.js";

interface MoveBody {
  row?: number;
  col?: number;
}

/**
 * The authoritative move endpoint. Everything the client claims (which team it's on,
 * whose turn it specifically is within that team, whether the move is legal) is
 * re-derived and re-validated here from the stored game row — the request body only
 * ever supplies the target (row, col). Reuses `tryMove`, the exact same rule engine
 * the local/AI modes use, so Go rules are never duplicated.
 */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "move", limit: 60, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = readGuestId(req);
  const { game, team } = await loadActiveGameForPlayer(id, guestId);

  const body = readBody<MoveBody>(req);
  const { row, col } = body;
  if (
    typeof row !== "number" ||
    typeof col !== "number" ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    col < 0 ||
    row >= game.boardSize ||
    col >= game.boardSize
  ) {
    throw Errors.badRequest("Posición fuera del tablero.");
  }

  const result = tryMove(game.board, game.boardSize, team, { row, col }, game.history);
  if (!result.ok) throw Errors.invalidMove(MOVE_ERROR_MESSAGES[result.reason]);

  const turnField = team === "black" ? "black_turn_index" : "white_turn_index";
  const currentTurnIndex = team === "black" ? game.blackTurnIndex : game.whiteTurnIndex;

  const updated = await applyGameUpdate(game, {
    board: result.board,
    current_player: opponent(team),
    [turnField]: currentTurnIndex + 1,
    black_captures: game.blackCaptures + (team === "black" ? result.capturedCount : 0),
    white_captures: game.whiteCaptures + (team === "white" ? result.capturedCount : 0),
    consecutive_passes: 0,
    history: [...game.history, result.boardState],
    last_move: { row, col },
  });

  res.status(200).json(buildMutationResponse(updated, guestId));
});
