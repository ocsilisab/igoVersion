import type { BoardSize, ExtensionRules, Player } from "../types/game.js";
import type { ApiErrorBody, GameMutationResponse, GameResponse, OpenGamesResponse } from "./types.js";

export class OnlineApiError extends Error {
  code: ApiErrorBody["error"];

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.code = body.error;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    let body: ApiErrorBody = { error: "server_error", message: "Error inesperado. Inténtalo de nuevo." };
    try {
      body = await res.json();
    } catch {
      // Response wasn't JSON (e.g. a network/edge error page) — keep the fallback message.
    }
    throw new OnlineApiError(body);
  }

  return res.json() as Promise<T>;
}

export function createOnlineGame(
  boardSize: BoardSize,
  maxPlayers: number,
  komi: number,
  creatorColor: Player,
  extensions: ExtensionRules,
  displayName?: string
): Promise<GameResponse> {
  return request<GameResponse>("/api/games", {
    method: "POST",
    body: JSON.stringify({
      boardSize,
      maxPlayers,
      komi,
      creatorColor,
      displayName,
      extensionBombs: extensions.bombs,
      extensionStars: extensions.stars,
    }),
  });
}

/** The public lobby: open games anyone can join, refreshed by polling — see CreateOnlineGame. */
export function listOpenGames(): Promise<OpenGamesResponse> {
  return request<OpenGamesResponse>("/api/games");
}

export function joinOnlineGame(code: string, displayName?: string): Promise<GameResponse> {
  return request<GameResponse>("/api/games/join", {
    method: "POST",
    body: JSON.stringify({ code, displayName }),
  });
}

/** The generic per-game link (`?game=<id>`, no invite token). */
export function joinOnlineGameById(id: string, displayName?: string): Promise<GameResponse> {
  return request<GameResponse>(`/api/games/${id}`, {
    method: "POST",
    body: JSON.stringify({ action: "join", displayName }),
  });
}

/** A specific player's personal invite link (`?game=<id>&token=<token>`). */
export function joinOnlineGameByToken(token: string, displayName?: string): Promise<GameResponse> {
  return request<GameResponse>("/api/games/join", {
    method: "POST",
    body: JSON.stringify({ token, displayName }),
  });
}

export function fetchOnlineGame(id: string): Promise<GameResponse> {
  return request<GameResponse>(`/api/games/${id}`);
}

export function sendMove(id: string, row: number, col: number): Promise<GameMutationResponse> {
  return request<GameMutationResponse>(`/api/games/${id}/move`, {
    method: "POST",
    body: JSON.stringify({ row, col }),
  });
}

export function sendPass(id: string): Promise<GameMutationResponse> {
  return request<GameMutationResponse>(`/api/games/${id}/pass`, { method: "POST" });
}

export function sendMarkDead(id: string, row: number, col: number): Promise<GameMutationResponse> {
  return request<GameMutationResponse>(`/api/games/${id}/mark-dead`, {
    method: "POST",
    body: JSON.stringify({ row, col }),
  });
}

export function sendFinalize(id: string): Promise<GameMutationResponse> {
  return request<GameMutationResponse>(`/api/games/${id}/finalize`, { method: "POST" });
}

export function sendLeave(id: string): Promise<GameMutationResponse> {
  return request<GameMutationResponse>(`/api/games/${id}`, { method: "POST", body: JSON.stringify({ action: "leave" }) });
}

export function sendStart(id: string): Promise<GameMutationResponse> {
  return request<GameMutationResponse>(`/api/games/${id}`, { method: "POST", body: JSON.stringify({ action: "start" }) });
}
