import type { BoardSize } from "../types/game.js";
import type { ApiErrorBody, GameMutationResponse, GameResponse } from "./types.js";

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

export function createOnlineGame(boardSize: BoardSize, displayName?: string): Promise<GameResponse> {
  return request<GameResponse>("/api/games", {
    method: "POST",
    body: JSON.stringify({ boardSize, displayName }),
  });
}

export function joinOnlineGame(code: string, displayName?: string): Promise<GameResponse> {
  return request<GameResponse>("/api/games/join", {
    method: "POST",
    body: JSON.stringify({ code, displayName }),
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
  return request<GameMutationResponse>(`/api/games/${id}/leave`, { method: "POST" });
}
