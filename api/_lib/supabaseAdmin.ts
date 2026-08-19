import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "./env.js";

let client: SupabaseClient | null = null;

/**
 * Server-only Supabase client using the service-role key, which bypasses Row Level
 * Security entirely. Never import this from client-side (`src/`) code — it must only
 * ever run inside `/api` serverless functions. The browser uses the anon key instead
 * (src/online/supabaseClient.ts), which RLS restricts to read-only.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!client) {
    const url = getEnv("VITE_SUPABASE_URL");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
