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
 */
export async function checkRateLimit(req: VercelRequest, options: RateLimitOptions): Promise<boolean> {
  const { action, limit, windowSeconds } = options;
  const ipHash = hashIp(getClientIp(req));
  const supabase = getSupabaseAdmin();
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const { count } = await supabase
    .from("rate_limit_hits")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("action", action)
    .gte("created_at", windowStart);

  if ((count ?? 0) >= limit) {
    return false;
  }

  await supabase.from("rate_limit_hits").insert({ ip_hash: ipHash, action });

  // Opportunistic cleanup of this key's old rows so the table doesn't grow forever.
  const staleBefore = new Date(Date.now() - windowSeconds * 1000 * 20).toISOString();
  void supabase.from("rate_limit_hits").delete().eq("ip_hash", ipHash).eq("action", action).lt("created_at", staleBefore);

  return true;
}
