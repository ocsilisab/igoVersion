import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { BoardSize, Player } from "../../src/types/game.js";
import { KOMI_OPTIONS, MIN_TOTAL_PLAYERS, MAX_TOTAL_PLAYERS } from "../../src/types/game.js";
import { buildGameResponse } from "../../src/online/turns.js";
import { withHandler, readBody } from "../_lib/http.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import { Errors } from "../_lib/errors.js";
import { ensureGuestId, sanitizeDisplayName, defaultGuestName } from "../_lib/session.js";
import { createGame } from "../_lib/gameRepo.js";

const VALID_SIZES: BoardSize[] = [9, 13, 19];

interface CreateGameBody {
  boardSize?: number;
  maxPlayers?: number;
  komi?: number;
  creatorColor?: string;
  displayName?: string;
  extensionBombs?: boolean;
  extensionStars?: boolean;
}

export default withHandler(["POST"], async (req: VercelRequest, res: VercelResponse) => {
  const allowed = await checkRateLimit(req, { action: "create_game", limit: 10, windowSeconds: 60 });
  if (!allowed) throw Errors.rateLimited();

  const guestId = ensureGuestId(req, res);
  const body = readBody<CreateGameBody>(req);

  if (!VALID_SIZES.includes(body.boardSize as BoardSize)) {
    throw Errors.badRequest("Tamaño de tablero no válido.");
  }
  if (
    typeof body.maxPlayers !== "number" ||
    !Number.isInteger(body.maxPlayers) ||
    body.maxPlayers < MIN_TOTAL_PLAYERS ||
    body.maxPlayers > MAX_TOTAL_PLAYERS
  ) {
    throw Errors.badRequest("Número de jugadores no válido.");
  }
  if (typeof body.komi !== "number" || !KOMI_OPTIONS.includes(body.komi)) {
    throw Errors.badRequest("Komi no válido.");
  }
  if (body.creatorColor !== "black" && body.creatorColor !== "white") {
    throw Errors.badRequest("Color no válido.");
  }

  const displayName = sanitizeDisplayName(body.displayName) ?? defaultGuestName(guestId);
  const game = await createGame({
    boardSize: body.boardSize as BoardSize,
    maxPlayers: body.maxPlayers,
    komi: body.komi,
    creatorColor: body.creatorColor as Player,
    guestId,
    displayName,
    extensions: { bombs: body.extensionBombs === true, stars: body.extensionStars === true },
  });

  res.status(201).json(buildGameResponse(game, guestId));
});
