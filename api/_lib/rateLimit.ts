import { createHmac } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { getEnv } from "./env.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

function hashIp(ip: string): string {
  return createHmac("sha256", getEnv("AUTH_SECRET")).update(ip).digest("hex");
}

export function getClientIp(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = raw?.split(",")[0]?.trim();
  return ip || req.socket?.remoteAddress || "unknown";
}

export interface RateLimitOptions {
  action: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Best-effort per-IP throttle backed by a small Postgres table (not an anti-cheat
 * system — see supabase/schema.sql::rate_limit_hits). The IP itself is never stored,
 * only an HMAC of it, and it is used purely as a throttling key, never as player identity.
 *
 * The actual count-then-insert runs atomically in a single Postgres function call (see
 * check_and_record_rate_limit in schema.sql) rather than as two separate round trips here
 * — two round trips would let a concurrent burst of requests all read "under the limit"
 * before any of their inserts land, letting the burst exceed `limit`.
 */
export async function checkRateLimit(req: VercelRequest, options: RateLimitOptions): Promise<boolean> {
  const { action, limit, windowSeconds } = options;
  const ipHash = hashIp(getClientIp(req));
  const supabase = getSupabaseAdmin();

  const { data: allowed, error } = await supabase.rpc("check_and_record_rate_limit", {
    p_ip_hash: ipHash,
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail open: this throttle is best-effort (see the docstring above), so a transient
    // Supabase hiccup or a schema.sql not yet re-run in this environment should degrade to
    // "allow the request", not take down every endpoint under /api/games and /api/cards
    // that calls this as their first line.
    console.error("checkRateLimit: check_and_record_rate_limit RPC failed, failing open", error);
    return true;
  }

  // Opportunistic cleanup of this key's old rows so the table doesn't grow forever.
  const staleBefore = new Date(Date.now() - windowSeconds * 1000 * 20).toISOString();
  void supabase.from("rate_limit_hits").delete().eq("ip_hash", ipHash).eq("action", action).lt("created_at", staleBefore);

  return Boolean(allowed);
}
