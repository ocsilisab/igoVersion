import { useMemo, useState } from "react";
import { MAX_DECK_SIZE, getOrCreateCollection, getSavedDeck, saveDeck } from "../cards/collection.js";
import type { TesujiCard } from "../cards/types.js";

export function useCardCollection() {
  const [collection] = useState<TesujiCard[]>(() => getOrCreateCollection());
  const ownedIds = useMemo(() => new Set(collection.map((c) => c.id)), [collection]);
  const [deckIds, setDeckIds] = useState<Set<string>>(() => getSavedDeck(ownedIds));

  const toggleCard = (id: string) => {
    setDeckIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_DECK_SIZE) return prev;
        next.add(id);
      }
      saveDeck(next);
      return next;
    });
  };

  return {
    collection,
    deckIds,
    deckCount: deckIds.size,
    maxDeckSize: MAX_DECK_SIZE,
    toggleCard,
  };
}
