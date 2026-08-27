import type { VercelRequest, VercelResponse } from "@vercel/node";
import { opponent, serializeBoard } from "../../../src/utils/board.js";
import { tryMove, MOVE_ERROR_MESSAGES } from "../../../src/utils/move.js";
import { applyHoshiConversion, dropBomb, BOMB_INTERVAL } from "../../../src/utils/extensions.js";
import { tickClock, type ClockState } from "../../../src/utils/clock.js";
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

  // Real clock deduction for the thinking time this move took -- resolveGameClock (inside
  // loadActiveGameForPlayer, above) already lazily catches most timeouts before a move
  // handler ever runs, but this is the real, authoritative check for the rare case where
  // the clock ran out in the narrow window between that read and this write.
  let clockPatch: { black_clock?: ClockState; white_clock?: ClockState; turn_started_at?: string } = {};
  if (game.timeControl && game.turnStartedAt) {
    const clock = team === "black" ? game.blackClock : game.whiteClock;
    if (clock) {
      const elapsedMs = Date.now() - new Date(game.turnStartedAt).getTime();
      const tick = tickClock(clock, elapsedMs, game.timeControl, true);
      if (tick.timedOut) {
        const updated = await applyGameUpdate(game, { status: "finished", winner: opponent(team), win_reason: "timeout" });
        res.status(200).json(buildMutationResponse(updated, guestId));
        return;
      }
      clockPatch = team === "black" ? { black_clock: tick.clock } : { white_clock: tick.clock };
      clockPatch.turn_started_at = new Date().toISOString();
    }
  }

  // Same "estrellas"/"bombas" house rules the local modes apply — see utils/extensions.ts
  // and useGoGame.ts::placeStone, which this mirrors so the server never diverges from
  // what a local game would do with the same rules enabled.
  let finalBoard = result.board;
  let extraCaptured = 0;
  if (game.extensions.stars) {
    const conversion = applyHoshiConversion(finalBoard, game.boardSize, { row, col }, team);
    finalBoard = conversion.board;
    extraCaptured = conversion.extraCaptured;
  }

  const moveCount = game.moveCount + 1;
  let lastBomb = game.lastBomb;
  if (game.extensions.bombs && moveCount % BOMB_INTERVAL === 0) {
    const bomb = dropBomb(finalBoard, game.boardSize);
    finalBoard = bomb.board;
    lastBomb = { center: bomb.center, affected: bomb.affected };
  }

  const capturedCount = result.capturedCount + extraCaptured;
  const turnField = team === "black" ? "black_turn_index" : "white_turn_index";
  const currentTurnIndex = team === "black" ? game.blackTurnIndex : game.whiteTurnIndex;

  const updated = await applyGameUpdate(game, {
    board: finalBoard,
    current_player: opponent(team),
    [turnField]: currentTurnIndex + 1,
    black_captures: game.blackCaptures + (team === "black" ? capturedCount : 0),
    white_captures: game.whiteCaptures + (team === "white" ? capturedCount : 0),
    consecutive_passes: 0,
    history: [...game.history, serializeBoard(finalBoard)],
    last_move: { row, col },
    move_count: moveCount,
    last_bomb: lastBomb,
    ...clockPatch,
  });

  res.status(200).json(buildMutationResponse(updated, guestId));
});
