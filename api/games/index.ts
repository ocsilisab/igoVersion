import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { BoardSize } from "../../src/types/game";
import type { GameResponse } from "../../src/online/types";
import { withHandler, readBody } from "../_lib/http";
import { checkRateLimit } from "../_lib/rateLimit";
import { Errors } from "../_lib/errors";
import { ensureGuestId, sanitizeDisplayName, defaultGuestName } from "../_lib/session";
import { createGame } from "../_lib/gameRepo";

const VALID_SIZES: BoardSize[] = [9, 13, 19];

interface CreateGameBody {
  boardSize?: number;
  displayName?: string;
}

export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "create_game", limit: 10, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const guestId = ensureGuestId(req, res);
  const body = readBody<CreateGameBody>(req);

  if (!VALID_SIZES.includes(body.boardSize as BoardSize)) {
    throw Errors.badRequest("Tamaño de tablero no válido.");
  }

  const displayName = sanitizeDisplayName(body.displayName) ?? defaultGuestName(guestId);
  const game = await createGame({ boardSize: body.boardSize as BoardSize, guestId, displayName });

  const response: GameResponse = {
    game,
    you: { guestId, userType: "guest", color: "black", displayName },
  };
  res.status(201).json(response);
});
