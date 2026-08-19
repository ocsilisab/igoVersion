import type { OnlineErrorCode } from "../../src/online/types.js";

export class GameApiError extends Error {
  status: number;
  code: OnlineErrorCode;

  constructor(status: number, code: OnlineErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const Errors = {
  notFound: () => new GameApiError(404, "not_found", "No se ha encontrado la partida."),
  full: () => new GameApiError(409, "full", "La partida ya está completa."),
  expired: () => new GameApiError(410, "expired", "La partida ha expirado."),
  invalidCode: () => new GameApiError(400, "invalid_code", "Código de partida no válido."),
  notYourTurn: () => new GameApiError(409, "not_your_turn", "No es tu turno."),
  wrongColor: () => new GameApiError(403, "wrong_color", "No perteneces a esta partida."),
  invalidMove: (message: string) => new GameApiError(422, "invalid_move", message),
  gameOver: () => new GameApiError(409, "game_over", "La partida ya ha finalizado."),
  conflict: () => new GameApiError(409, "conflict", "La partida cambió mientras se procesaba tu jugada. Inténtalo de nuevo."),
  rateLimited: () => new GameApiError(429, "rate_limited", "Demasiadas peticiones. Espera un momento."),
  unauthorized: () => new GameApiError(401, "unauthorized", "Sesión de invitado no válida."),
  badRequest: (message: string) => new GameApiError(400, "bad_request", message),
  serverError: () => new GameApiError(500, "server_error", "Error interno del servidor."),
};
