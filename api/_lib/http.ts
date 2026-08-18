import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GameApiError } from "./errors";

export function readBody<T>(req: VercelRequest): T {
  const body = req.body as unknown;
  if (body == null) return {} as T;
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as T;
    } catch {
      return {} as T;
    }
  }
  return body as T;
}

/**
 * Wraps an API route: enforces the allowed HTTP method(s) and turns any thrown
 * `GameApiError` (or unexpected error) into a consistent `{ error, message }` JSON body.
 */
export function withHandler(
  allowedMethods: string[],
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void>
) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (!req.method || !allowedMethods.includes(req.method)) {
      res.setHeader("Allow", allowedMethods.join(", "));
      res.status(405).json({ error: "bad_request", message: "Método no permitido." });
      return;
    }

    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof GameApiError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "server_error", message: "Error interno del servidor." });
    }
  };
}
