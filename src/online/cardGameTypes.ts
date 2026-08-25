export type CardGameStatus = "waiting" | "ready" | "playing" | "finished" | "abandoned";
export type CardGameSide = "host" | "guest";

/**
 * Server-authoritative pairing-and-match record for the card game's "Jugar" flow -- see
 * supabase/schema.sql::card_games. `hostHand`/`guestHand` are each a length-5 array of
 * tesuji card ids (src/cards/tesujiCards.ts), drawn server-side once that side submits a
 * deck (see hand.ts); `hostProgress`/`guestProgress` is how many of those 5 they've solved
 * correctly so far, in order -- the card they're currently on is hand[progress]. First to
 * reach 5 wins outright.
 */
export interface CardGame {
  id: string;
  code: string;
  version: number;
  status: CardGameStatus;
  hostName: string;
  guestName: string | null;
  hostHand: string[] | null;
  guestHand: string[] | null;
  hostProgress: number;
  guestProgress: number;
  hostMistakes: number;
  guestMistakes: number;
  /** Set once both hands exist (status flips to 'playing') -- the race's t=0. */
  startedAt: string | null;
  winner: CardGameSide | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface CardGameResponse {
  game: CardGame;
  /** Whether the requester is the host (created it) or the guest (joined via its code). */
  isHost: boolean;
}
