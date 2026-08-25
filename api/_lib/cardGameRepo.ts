import type { CardGame, CardGameStatus } from "../../src/online/cardGameTypes.js";
import { generateGameCode } from "./gameCode.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { Errors } from "./errors.js";

const WAITING_TTL_MINUTES = 20;
const CREATE_CODE_ATTEMPTS = 5;

interface CardGameRow {
  id: string;
  code: string;
  version: number;
  host_guest_id: string;
  host_name: string;
  guest_guest_id: string | null;
  guest_name: string | null;
  status: CardGameStatus;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

function rowToGame(row: CardGameRow): CardGame {
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    status: row.status,
    hostName: row.host_name,
    guestName: row.guest_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function isExpiredWaiting(row: CardGameRow): boolean {
  return row.status === "waiting" && new Date(row.expires_at).getTime() < Date.now();
}

export async function createCardGame(hostGuestId: string, hostName: string): Promise<CardGame> {
  const supabase = getSupabaseAdmin();
  const expiresAt = new Date(Date.now() + WAITING_TTL_MINUTES * 60 * 1000).toISOString();

  for (let attempt = 0; attempt < CREATE_CODE_ATTEMPTS; attempt++) {
    const code = generateGameCode();
    const { data, error } = await supabase
      .from("card_games")
      .insert({ code, host_guest_id: hostGuestId, host_name: hostName, status: "waiting", expires_at: expiresAt })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") continue; // code collision — try again with a fresh one
      throw Errors.serverError();
    }

    return rowToGame(data as CardGameRow);
  }

  throw Errors.serverError();
}

export interface FoundCardGame {
  game: CardGame;
  isHost: (guestId: string | null) => boolean;
}

export async function findCardGameById(id: string): Promise<FoundCardGame | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("card_games").select("*").eq("id", id).maybeSingle();
  if (error) throw Errors.serverError();
  if (!data) return null;

  const row = data as CardGameRow;
  return { game: rowToGame(row), isHost: (guestId) => guestId !== null && guestId === row.host_guest_id };
}

/**
 * Claims the guest slot for whoever enters this code. Idempotent for both the host
 * (re-entering their own code) and an already-joined guest (rejoining), so retries and
 * page reloads never error out.
 */
export async function joinCardGame(code: string, guestId: string, displayName: string): Promise<{ game: CardGame; isHost: boolean }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("card_games").select("*").eq("code", code).maybeSingle();
  if (error) throw Errors.serverError();
  if (!data) throw Errors.notFound();

  const row = data as CardGameRow;

  if (row.host_guest_id === guestId) return { game: rowToGame(row), isHost: true };
  if (row.guest_guest_id === guestId) return { game: rowToGame(row), isHost: false };

  if (isExpiredWaiting(row)) throw Errors.expired();
  if (row.status !== "waiting") throw Errors.full();

  const { data: updated, error: updateError } = await supabase
    .from("card_games")
    .update({
      guest_guest_id: guestId,
      guest_name: displayName,
      status: "ready",
      version: row.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("version", row.version)
    .is("guest_guest_id", null)
    .select("*")
    .maybeSingle();
  if (updateError) throw Errors.serverError();
  // Someone else claimed the guest slot between our read and our write.
  if (!updated) throw Errors.full();

  return { game: rowToGame(updated as CardGameRow), isHost: false };
}
