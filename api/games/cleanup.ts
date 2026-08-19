import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withHandler } from "../_lib/http.js";
import { Errors } from "../_lib/errors.js";
import { getEnv } from "../_lib/env.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";

const STALE_FINISHED_HOURS = 24;

/**
 * Maintenance endpoint: deletes `waiting` games past their expiry, and prunes old
 * `finished`/`abandoned` games (no permanent match history is kept — see the prompt's
 * scope). Not wired to a cron automatically; call it manually or point a Vercel Cron
 * Job at it with the same bearer token. Protected by AUTH_SECRET so it can't be
 * triggered by random internet traffic.
 */
export default withHandler(["POST", "GET"], async (req: VercelRequest, res: VercelResponse) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${getEnv("AUTH_SECRET")}`) throw Errors.unauthorized();

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_FINISHED_HOURS * 60 * 60 * 1000).toISOString();

  const { count: expiredCount } = await supabase
    .from("games")
    .delete({ count: "exact" })
    .eq("status", "waiting")
    .lt("expires_at", nowIso);

  const { count: staleCount } = await supabase
    .from("games")
    .delete({ count: "exact" })
    .in("status", ["finished", "abandoned"])
    .lt("updated_at", staleBefore);

  res.status(200).json({ expiredWaitingDeleted: expiredCount ?? 0, staleFinishedDeleted: staleCount ?? 0 });
});
