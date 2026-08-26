import type { VercelRequest, VercelResponse } from "@vercel/node";
import { toggleDeadStoneGroup } from "../../../src/utils/deadStones.js";
import { buildMutationResponse } from "../../../src/online/turns.js";
import { withHandler, readBody } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { readGuestId } from "../../_lib/session.js";
import { loadPlayableGame, applyGameUpdate } from "../../_lib/gameRepo.js";

interface MarkDeadBody {
  action?: "toggle" | "confirm";
  row?: number;
  col?: number;
}

/**
 * Two actions during the post-double-pass scoring phase, both requiring an active player
 * on either team:
 *
 * "toggle" (default, for backward compatibility with clients that only ever send
 * {row, col}) -- either player can mark/unmark any group, including the opponent's.
 * Always resets dead_stones_confirmed_teams to [], since whatever was previously agreed
 * on no longer describes the current board -- see finalize.ts, which refuses to close
 * the game until both teams re-confirm whatever the board shows *now*. Without this
 * reset, one player could mark the opponent's live groups dead and finalize before the
 * opponent even sees the change.
 *
 * "confirm" -- the caller's own team signs off on the dead_stones exactly as they stand
 * right now. Idempotent (confirming twice is a no-op); the other team still has to
 * confirm separately before finalize.ts will accept the result.
 */
export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "mark_dead", limit: 60, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = readGuestId(req);
  const { game, team } = await loadPlayableGame(id, guestId);

  if (!game.isScoring) throw Errors.invalidMove("La partida no está en fase de puntuación.");

  const body = readBody<MarkDeadBody>(req);

  if (body.action === "confirm") {
    if (game.deadStonesConfirmedTeams.includes(team)) {
      res.status(200).json(buildMutationResponse(game, guestId));
      return;
    }
    const updated = await applyGameUpdate(game, {
      dead_stones_confirmed_teams: [...game.deadStonesConfirmedTeams, team],
    });
    res.status(200).json(buildMutationResponse(updated, guestId));
    return;
  }

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

  const updated = await applyGameUpdate(game, {
    dead_stones: Array.from(nextDeadStones),
    dead_stones_confirmed_teams: [],
  });

  res.status(200).json(buildMutationResponse(updated, guestId));
});
