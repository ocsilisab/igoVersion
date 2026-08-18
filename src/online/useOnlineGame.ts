import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Player } from "../types/game";
import type { OnlineGame, YouInfo } from "./types";
import { getSupabaseBrowserClient } from "./supabaseClient";
import { OnlineApiError, fetchOnlineGame, sendFinalize, sendLeave, sendMarkDead, sendMove, sendPass } from "./api";

const POLL_INTERVAL_MS = 4000;
const PRESENCE_STALE_MS = 12000;

export type ConnectionStatus = "connected" | "reconnecting";

interface PresencePayload {
  color: Player;
}

export interface UseOnlineGameResult {
  game: OnlineGame | null;
  you: YouInfo | null;
  loading: boolean;
  loadError: string | null;
  connectionStatus: ConnectionStatus;
  opponentConnectionStatus: ConnectionStatus;
  actionError: string | null;
  clearActionError: () => void;
  placeStone: (row: number, col: number) => Promise<void>;
  pass: () => Promise<void>;
  toggleDeadGroup: (row: number, col: number) => Promise<void>;
  finalize: () => Promise<void>;
  leave: () => Promise<void>;
}

/**
 * Drives one online game: initial load (also the page-reload recovery path — the server
 * resolves "you" from the signed guest cookie, so there's nothing to restore client-side),
 * a Realtime subscription for instant updates, a light polling fallback so the app still
 * works if Realtime isn't configured, and Presence for the opponent's connection dot.
 * Every mutation goes through src/online/api.ts, never touching `game` directly — the
 * server's response (or the next refresh) is always what's rendered.
 */
export function useOnlineGame(gameId: string, initial?: { game: OnlineGame; you: YouInfo }): UseOnlineGameResult {
  const [game, setGame] = useState<OnlineGame | null>(initial?.game ?? null);
  const [you, setYou] = useState<YouInfo | null>(initial?.you ?? null);
  const [loading, setLoading] = useState(!initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connected");
  const [opponentPresentAt, setOpponentPresentAt] = useState<number | null>(null);
  const [opponentConnectionStatus, setOpponentConnectionStatus] = useState<ConnectionStatus>("reconnecting");
  const [isSubscribed, setIsSubscribed] = useState(false);

  const youRef = useRef(you);
  youRef.current = you;
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchOnlineGame(gameId);
      setGame(res.game);
      setYou(res.you);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof OnlineApiError ? err.message : "No se ha podido cargar la partida.");
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    if (initial) {
      setLoading(false);
      return;
    }
    void refresh();
    // Only re-run when the game id itself changes, not on every `refresh` identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      // No Supabase env vars configured — the app still works via the polling fallback above.
      setConnectionStatus("reconnecting");
      return;
    }

    const channel = supabase
      .channel(`game:${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` },
        () => void refresh()
      )
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresencePayload>();
        const myColor = youRef.current?.color;
        const opponentPresent = Object.values(state).some((entries) =>
          entries.some((entry) => entry.color && entry.color !== myColor)
        );
        setOpponentPresentAt(opponentPresent ? Date.now() : null);
      })
      .subscribe((status) => {
        setConnectionStatus(status === "SUBSCRIBED" ? "connected" : "reconnecting");
        setIsSubscribed(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      setIsSubscribed(false);
      void supabase.removeChannel(channel);
    };
  }, [gameId, refresh]);

  useEffect(() => {
    if (isSubscribed && you?.color && channelRef.current) {
      void channelRef.current.track({ color: you.color });
    }
  }, [isSubscribed, you?.color]);

  useEffect(() => {
    const tick = () => {
      setOpponentConnectionStatus(
        opponentPresentAt !== null && Date.now() - opponentPresentAt < PRESENCE_STALE_MS ? "connected" : "reconnecting"
      );
    };
    tick();
    const interval = window.setInterval(tick, 2000);
    return () => window.clearInterval(interval);
  }, [opponentPresentAt]);

  const runAction = useCallback(
    async (fn: () => Promise<{ game: OnlineGame }>) => {
      setActionError(null);
      try {
        const res = await fn();
        setGame(res.game);
      } catch (err) {
        if (err instanceof OnlineApiError) {
          setActionError(err.message);
          if (err.code === "conflict" || err.code === "not_your_turn" || err.code === "game_over") {
            void refresh();
          }
        } else {
          setActionError("No se ha podido completar la acción. Comprueba tu conexión.");
        }
      }
    },
    [refresh]
  );

  const placeStone = useCallback(
    (row: number, col: number) => {
      if (!game) return Promise.resolve();
      return runAction(() => sendMove(game.id, row, col));
    },
    [game, runAction]
  );

  const pass = useCallback(() => {
    if (!game) return Promise.resolve();
    return runAction(() => sendPass(game.id));
  }, [game, runAction]);

  const toggleDeadGroup = useCallback(
    (row: number, col: number) => {
      if (!game) return Promise.resolve();
      return runAction(() => sendMarkDead(game.id, row, col));
    },
    [game, runAction]
  );

  const finalize = useCallback(() => {
    if (!game) return Promise.resolve();
    return runAction(() => sendFinalize(game.id));
  }, [game, runAction]);

  const leave = useCallback(() => {
    if (!game) return Promise.resolve();
    return runAction(() => sendLeave(game.id));
  }, [game, runAction]);

  return {
    game,
    you,
    loading,
    loadError,
    connectionStatus,
    opponentConnectionStatus,
    actionError,
    clearActionError: () => setActionError(null),
    placeStone,
    pass,
    toggleDeadGroup,
    finalize,
    leave,
  };
}
