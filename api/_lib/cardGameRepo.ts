import type { CardGame, CardGameSide, CardGameStatus } from "../../src/online/cardGameTypes.js";
import { ALL_TESUJI_CARDS } from "../../src/cards/tesujiCards.js";
import { generateGameCode } from "./gameCode.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { Errors } from "./errors.js";

const WAITING_TTL_MINUTES = 20;
const CREATE_CODE_ATTEMPTS = 5;
const HAND_SIZE = 5;

const VALID_CARD_IDS = new Set(ALL_TESUJI_CARDS.map((c) => c.id));
const CARDS_BY_ID = new Map(ALL_TESUJI_CARDS.map((c) => [c.id, c]));

interface CardGameRow {
  id: string;
  code: string;
  version: number;
  host_guest_id: string;
  host_name: string;
  guest_guest_id: string | null;
  guest_name: string | null;
  status: CardGameStatus;
  host_hand: string[] | null;
  guest_hand: string[] | null;
  host_progress: number;
  guest_progress: number;
  host_mistakes: number;
  guest_mistakes: number;
  started_at: string | null;
  winner: CardGameSide | null;
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
    hostHand: row.host_hand,
    guestHand: row.guest_hand,
    hostProgress: row.host_progress,
    guestProgress: row.guest_progress,
    hostMistakes: row.host_mistakes,
    guestMistakes: row.guest_mistakes,
    startedAt: row.started_at,
    winner: row.winner,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function isExpiredWaiting(row: CardGameRow): boolean {
  return row.status === "waiting" && new Date(row.expires_at).getTime() < Date.now();
}

/** Which side of the match this guest is, or null if they're neither the host nor the guest. */
function sideOf(row: CardGameRow, guestId: string): CardGameSide | null {
  if (row.host_guest_id === guestId) return "host";
  if (row.guest_guest_id === guestId) return "guest";
  return null;
}

async function fetchRow(id: string): Promise<CardGameRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("card_games").select("*").eq("id", id).maybeSingle();
  if (error) throw Errors.serverError();
  if (!data) throw Errors.notFound();
  return data as CardGameRow;
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

function drawHand(deckIds: string[]): string[] {
  const hand: string[] = [];
  for (let i = 0; i < HAND_SIZE; i++) {
    hand.push(deckIds[Math.floor(Math.random() * deckIds.length)]);
  }
  return hand;
}

/**
 * Submits this side's deck once they're on the 'ready' screen: the server draws their
 * 5-card hand (with replacement, per the deck the client itself owns and sent — see
 * hand.ts) and stores it. Idempotent: a side that already has a hand just gets the
 * current state back, so a page reload never redraws (and thus never un-fairly reshuffles)
 * a hand mid-match. Once *both* sides have a hand, the match starts.
 */
export async function submitHand(gameId: string, guestId: string, deckIds: string[]): Promise<{ game: CardGame; isHost: boolean }> {
  const row = await fetchRow(gameId);
  const side = sideOf(row, guestId);
  if (!side) throw Errors.wrongColor();

  const existingHand = side === "host" ? row.host_hand : row.guest_hand;
  if (existingHand) return { game: rowToGame(row), isHost: side === "host" };

  if (row.status !== "ready" && row.status !== "waiting") throw Errors.badRequest("La partida no está esperando jugadores.");

  const ownedValidIds = deckIds.filter((id) => VALID_CARD_IDS.has(id));
  if (ownedValidIds.length === 0) throw Errors.badRequest("No tienes ninguna carta válida en tu baraja.");

  const hand = drawHand(ownedValidIds);
  const otherHandAlreadySet = side === "host" ? row.guest_hand !== null : row.host_hand !== null;
  const patch: Record<string, unknown> = side === "host" ? { host_hand: hand } : { guest_hand: hand };
  if (otherHandAlreadySet) {
    patch.status = "playing";
    patch.started_at = new Date().toISOString();
  }

  const supabase = getSupabaseAdmin();
  const { data: updated, error } = await supabase
    .from("card_games")
    .update({ ...patch, version: row.version + 1, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("version", row.version)
    .select("*")
    .maybeSingle();
  if (error) throw Errors.serverError();
  if (!updated) throw Errors.conflict();

  return { game: rowToGame(updated as CardGameRow), isHost: side === "host" };
}

/**
 * Answers the current card of this side's hand (hand[progress]) with (row, col), checked
 * against that card's real solution (the same data src/cards/tesujiCards.ts generated and
 * verified) -- never trusting a client's own claim of right/wrong. A correct answer
 * advances progress; reaching 5 first wins the match outright for both sides. A wrong
 * answer just counts as a mistake (for the on-screen "+5s" counter) and progress stays
 * put -- the player answers the same card again.
 */
export async function submitAnswer(gameId: string, guestId: string, row: number, col: number): Promise<{ game: CardGame; isHost: boolean }> {
  const gameRow = await fetchRow(gameId);
  const side = sideOf(gameRow, guestId);
  if (!side) throw Errors.wrongColor();
  if (gameRow.status !== "playing") throw Errors.badRequest("La partida no está en curso.");

  const hand = side === "host" ? gameRow.host_hand : gameRow.guest_hand;
  const progress = side === "host" ? gameRow.host_progress : gameRow.guest_progress;
  if (!hand) throw Errors.badRequest("Todavía no tienes mano.");
  if (progress >= HAND_SIZE) throw Errors.badRequest("Ya has resuelto tu mano.");

  const card = CARDS_BY_ID.get(hand[progress]);
  if (!card) throw Errors.serverError();

  const correct = card.problem.solution.row === row && card.problem.solution.col === col;
  const patch: Record<string, unknown> = {};

  if (correct) {
    const newProgress = progress + 1;
    patch[side === "host" ? "host_progress" : "guest_progress"] = newProgress;
    if (newProgress >= HAND_SIZE) {
      patch.status = "finished";
      patch.winner = side;
    }
  } else {
    const mistakes = (side === "host" ? gameRow.host_mistakes : gameRow.guest_mistakes) + 1;
    patch[side === "host" ? "host_mistakes" : "guest_mistakes"] = mistakes;
  }

  const supabase = getSupabaseAdmin();
  const { data: updated, error } = await supabase
    .from("card_games")
    .update({ ...patch, version: gameRow.version + 1, updated_at: new Date().toISOString() })
    .eq("id", gameRow.id)
    .eq("version", gameRow.version)
    .select("*")
    .maybeSingle();
  if (error) throw Errors.serverError();
  if (!updated) throw Errors.conflict();

  return { game: rowToGame(updated as CardGameRow), isHost: side === "host" };
}

/**
 * Resets a finished match back to 'ready' for a rematch: same two players, same code and
 * connection, but fresh hands, progress and mistakes. Either side can trigger it -- the
 * other side's CardsPlay screen picks up the reset via Realtime/polling like any other
 * update, and its own "submit my hand once ready" effect fires again automatically.
 */
export async function rematchCardGame(gameId: string, guestId: string): Promise<{ game: CardGame; isHost: boolean }> {
  const gameRow = await fetchRow(gameId);
  const side = sideOf(gameRow, guestId);
  if (!side) throw Errors.wrongColor();
  if (gameRow.status !== "finished") throw Errors.badRequest("La partida todavía no ha terminado.");

  const supabase = getSupabaseAdmin();
  const { data: updated, error } = await supabase
    .from("card_games")
    .update({
      host_hand: null,
      guest_hand: null,
      host_progress: 0,
      guest_progress: 0,
      host_mistakes: 0,
      guest_mistakes: 0,
      started_at: null,
      winner: null,
      status: "ready",
      version: gameRow.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameRow.id)
    .eq("version", gameRow.version)
    .select("*")
    .maybeSingle();
  if (error) throw Errors.serverError();
  if (!updated) throw Errors.conflict();

  return { game: rowToGame(updated as CardGameRow), isHost: side === "host" };
}
