import { useCallback, useEffect, useRef } from "react";
import type { Position } from "../types/game";
import type { MctsRootState } from "../ai/mcts/search";
import type { MctsWorkerRequest, MctsWorkerResponse } from "../ai/mcts/worker";

/**
 * Owns one persistent MCTS Web Worker for the lifetime of the component using this hook
 * (created once, terminated on unmount) and exposes a promise-based `requestMove` — the
 * search itself (ai/mcts/search.ts::runMcts) runs entirely off the main thread inside
 * ai/mcts/worker.ts, so the UI stays responsive while the "Difícil" AI thinks.
 */
export function useMctsWorker(): (state: MctsRootState, timeBudgetMs: number) => Promise<Position | null> {
  const workerRef = useRef<Worker | null>(null);
  const nextIdRef = useRef(0);
  const pendingRef = useRef(new Map<number, (move: Position | null) => void>());

  useEffect(() => {
    const worker = new Worker(new URL("../ai/mcts/worker.ts", import.meta.url), { type: "module" });
    const pending = pendingRef.current;

    worker.onmessage = (event: MessageEvent<MctsWorkerResponse>) => {
      const { id, move } = event.data;
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(move);
      }
    };
    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
      pending.clear();
    };
  }, []);

  return useCallback((state: MctsRootState, timeBudgetMs: number) => {
    return new Promise<Position | null>((resolve) => {
      const worker = workerRef.current;
      if (!worker) {
        resolve(null); // shouldn't happen — the effect above creates it synchronously on mount
        return;
      }
      const id = nextIdRef.current++;
      pendingRef.current.set(id, resolve);
      const request: MctsWorkerRequest = { id, state, timeBudgetMs };
      worker.postMessage(request);
    });
  }, []);
}
