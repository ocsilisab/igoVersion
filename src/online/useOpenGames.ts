import { useEffect, useState } from "react";
import type { OpenGameSummary } from "./types.js";
import { listOpenGames } from "./api.js";

const POLL_MS = 4000;

/** Polls the public lobby (see CreateOnlineGame / OnlineGameScreen's waiting room, which
 * both show this same list). `excludeId` drops a game from its own results — used by the
 * waiting room so your own game never shows up as something to switch to. */
export function useOpenGames(excludeId?: string): { games: OpenGameSummary[]; loading: boolean } {
  const [games, setGames] = useState<OpenGameSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listOpenGames()
        .then((res) => {
          if (cancelled) return;
          setGames(excludeId ? res.games.filter((g) => g.id !== excludeId) : res.games);
        })
        .catch(() => {
          // Transient — the next poll retries; the panel just keeps showing the last list.
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    refresh();
    const interval = window.setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [excludeId]);

  return { games, loading };
}
