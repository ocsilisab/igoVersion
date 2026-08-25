import type { ApiErrorBody } from "./types.js";
import type { CardGameResponse } from "./cardGameTypes.js";

export class CardsApiError extends Error {
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
    throw new CardsApiError(body);
  }

  return res.json() as Promise<T>;
}

export function createCardGame(displayName?: string): Promise<CardGameResponse> {
  return request<CardGameResponse>("/api/cards/games", {
    method: "POST",
    body: JSON.stringify({ action: "create", displayName }),
  });
}

export function joinCardGame(code: string, displayName?: string): Promise<CardGameResponse> {
  return request<CardGameResponse>("/api/cards/games", {
    method: "POST",
    body: JSON.stringify({ action: "join", code, displayName }),
  });
}

export function fetchCardGame(id: string): Promise<CardGameResponse> {
  return request<CardGameResponse>(`/api/cards/games/${id}`);
}

export function submitCardHand(id: string, deckIds: string[]): Promise<CardGameResponse> {
  return request<CardGameResponse>(`/api/cards/games/${id}`, {
    method: "POST",
    body: JSON.stringify({ action: "hand", deckIds }),
  });
}

export function submitCardAnswer(id: string, row: number, col: number): Promise<CardGameResponse> {
  return request<CardGameResponse>(`/api/cards/games/${id}`, {
    method: "POST",
    body: JSON.stringify({ action: "answer", row, col }),
  });
}
