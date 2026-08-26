import type { ApiErrorBody } from "./types.js";
import type { CardGameResponse } from "./cardGameTypes.js";
import { createApiRequest } from "./httpClient.js";

export class CardsApiError extends Error {
  code: ApiErrorBody["error"];

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.code = body.error;
  }
}

const request = createApiRequest(CardsApiError);

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

export function requestCardRematch(id: string): Promise<CardGameResponse> {
  return request<CardGameResponse>(`/api/cards/games/${id}`, {
    method: "POST",
    body: JSON.stringify({ action: "rematch" }),
  });
}
