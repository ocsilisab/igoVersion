import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { CardGame } from "../online/cardGameTypes.js";
import { CardsApiError, createCardGame, fetchCardGame, joinCardGame } from "../online/cardsApi.js";
import { getSupabaseBrowserClient } from "../online/supabaseClient.js";

const POLL_INTERVAL_MS = 3000;

export interface UseCardGameResult {
  /** The session this browser is currently in -- its own hosted one, or one it joined by code. */
  game: CardGame | null;
  isHost: boolean;
  loading: boolean;
  error: string | null;
  /** Enters a code shared by the other player; on success this browser switches to that session. */
  joinByCode: (code: string) => Promise<void>;
  clearError: () => void;
}

/**
 * Drives the card game's pairing flow: creates a hosted session on mount, then watches it
 * via Realtime (with a light polling fallback) so the host sees the moment a guest joins.
 * Joining someone else's code just swaps which session this hook is watching.
 */
export function useCardGame(): UseCardGameResult {
  const [game, setGame] = useState<CardGame | null>(null);
  const [isHost, setIsHost] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const gameIdRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    createCardGame()
      .then((res) => {
        if (cancelled) return;
        setGame(res.game);
        setIsHost(res.isHost);
        gameIdRef.current = res.game.id;
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof CardsApiError ? err.message : "No se ha podido crear la partida.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const id = gameIdRef.current;
    if (!id) return;
    try {
      const res = await fetchCardGame(id);
      // A join elsewhere may have switched gameIdRef away from `id` while this was in flight.
      if (gameIdRef.current !== id) return;
      setGame(res.game);
      setIsHost(res.isHost);
    } catch {
      // Transient — the next poll or Realtime event will retry.
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const id = game?.id;
    if (!id) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return; // no Supabase env vars — the polling fallback above still works

    const channel = supabase
      .channel(`card_game:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "card_games", filter: `id=eq.${id}` }, () => void refresh())
      .subscribe();

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [game?.id, refresh]);

  const joinByCode = useCallback(async (code: string) => {
    setError(null);
    try {
      const res = await joinCardGame(code);
      gameIdRef.current = res.game.id;
      setGame(res.game);
      setIsHost(res.isHost);
    } catch (err) {
      setError(err instanceof CardsApiError ? err.message : "No se ha podido unir a la partida.");
    }
  }, []);

  return { game, isHost, loading, error, joinByCode, clearError: () => setError(null) };
}
