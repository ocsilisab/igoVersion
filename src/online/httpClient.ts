import type { ApiErrorBody } from "./types.js";

/**
 * Builds a `request<T>(path, init)` helper bound to `ErrorClass` for its failure case —
 * shared by api.ts (Go games) and cardsApi.ts (card games), which otherwise had this
 * exact fetch/error-parsing logic duplicated verbatim, differing only in which error
 * class they threw.
 */
export function createApiRequest<E extends Error>(ErrorClass: new (body: ApiErrorBody) => E) {
  return async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
      throw new ErrorClass(body);
    }

    return res.json() as Promise<T>;
  };
}
