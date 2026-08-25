export type CardGameStatus = "waiting" | "ready" | "abandoned";

/** Server-authoritative pairing record for the card game's "Jugar" flow -- see supabase/schema.sql::card_games. */
export interface CardGame {
  id: string;
  code: string;
  version: number;
  status: CardGameStatus;
  hostName: string;
  guestName: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface CardGameResponse {
  game: CardGame;
  /** Whether the requester is the host (created it) or the guest (joined via its code). */
  isHost: boolean;
}
