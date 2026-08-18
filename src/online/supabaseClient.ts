import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Browser-side Supabase client using the public anon key (safe to expose — Row Level
 * Security on the `games` table only ever grants it SELECT, see supabase/schema.sql).
 * Used exclusively to subscribe to Realtime updates and Presence; every actual game
 * mutation goes through the authoritative /api/games/* endpoints instead.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
