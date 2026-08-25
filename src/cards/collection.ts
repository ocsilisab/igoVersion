import { ALL_TESUJI_CARDS } from "./tesujiCards.js";
import type { TesujiCard } from "./types.js";

export const COLLECTION_SIZE = 80;
export const MAX_DECK_SIZE = 50;

const COLLECTION_STORAGE_KEY = "go-cards-collection-v1";
const DECK_STORAGE_KEY = "go-cards-deck-v1";

function shuffledIds(): string[] {
  const ids = ALL_TESUJI_CARDS.map((c) => c.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

function readIdList(key: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : null;
  } catch {
    return null;
  }
}

function writeIdList(key: string, ids: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage unavailable (private browsing, quota, etc.) -- the in-memory session still works.
  }
}

/**
 * The 80 cards this user owns, out of the 150 the game defines. Chosen once at random and
 * persisted from then on, so it stays the same across visits instead of reshuffling.
 */
export function getOrCreateCollection(): TesujiCard[] {
  const existing = readIdList(COLLECTION_STORAGE_KEY);
  const validExisting = existing?.filter((id) => ALL_TESUJI_CARDS.some((c) => c.id === id));

  const ids = validExisting && validExisting.length === COLLECTION_SIZE ? validExisting : shuffledIds().slice(0, COLLECTION_SIZE);

  if (!validExisting || validExisting.length !== COLLECTION_SIZE) {
    writeIdList(COLLECTION_STORAGE_KEY, ids);
  }

  const idSet = new Set(ids);
  return ALL_TESUJI_CARDS.filter((c) => idSet.has(c.id));
}

/** The deck the user has built so far, capped at MAX_DECK_SIZE and restricted to owned cards. */
export function getSavedDeck(ownedIds: Set<string>): Set<string> {
  const saved = readIdList(DECK_STORAGE_KEY) ?? [];
  const valid = saved.filter((id) => ownedIds.has(id)).slice(0, MAX_DECK_SIZE);
  return new Set(valid);
}

export function saveDeck(deckIds: Set<string>): void {
  writeIdList(DECK_STORAGE_KEY, Array.from(deckIds));
}
