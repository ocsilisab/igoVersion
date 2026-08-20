import type { VercelRequest, VercelResponse } from "@vercel/node";
import { opponent } from "../../../src/utils/board.js";
import { suggestDeadGroups } from "../../../src/utils/deadStones.js";
import { buildMutationResponse } from "../../../src/online/turns.js";
import { withHandler } from "../../_lib/http.js";
import { checkRateLimit } from "../../_lib/rateLimit.js";
import { Errors } from "../../_lib/errors.js";
import { readGuestId } from "../../_lib/session.js";
import { loadActiveGameForPlayer, applyGameUpdate } from "../../_lib/gameRepo.js";

const PASSES_TO_END_ACTIVE_PLAY = 2;

export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "pass", limit: 30, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const { id } = req.query;
  if (typeof id !== "string") throw Errors.badRequest("Falta el id de la partida.");

  const guestId = readGuestId(req);
  const { game, team } = await loadActiveGameForPlayer(id, guestId);

  const consecutivePasses = game.consecutivePasses + 1;
  const turnField = team === "black" ? "black_turn_index" : "white_turn_index";
  const currentTurnIndex = team === "black" ? game.blackTurnIndex : game.whiteTurnIndex;
  const enteringScoring = consecutivePasses >= PASSES_TO_END_ACTIVE_PLAY;

  const updated = await applyGameUpdate(game, {
    consecutive_passes: consecutivePasses,
    current_player: opponent(team),
    [turnField]: currentTurnIndex + 1,
    is_scoring: enteringScoring,
    // Pre-mark anything without two eyes so the scoring phase doesn't start looking
    // untouched — same heuristic as the local modes (see utils/deadStones.ts), and just
    // as overridable: any mark can still be toggled by hand before finalizing.
    ...(enteringScoring ? { dead_stones: Array.from(suggestDeadGroups(game.board, game.boardSize)) } : {}),
  });

  res.status(200).json(buildMutationResponse(updated, guestId));
});
