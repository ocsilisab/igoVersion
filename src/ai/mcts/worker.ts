// Runs inside a dedicated Web Worker — see hooks/useMctsWorker.ts for the main-thread
// side that creates it. Keeping the actual search off the main thread is what stops a
// "Difícil" AI move from freezing the UI for the ~3s the search takes.
import type { Position } from "../../types/game.js";
import { runMcts, type MctsRootState } from "./search.js";

export interface MctsWorkerRequest {
  id: number;
  state: MctsRootState;
  timeBudgetMs: number;
}

export interface MctsWorkerResponse {
  id: number;
  move: Position | null;
}

addEventListener("message", (event: MessageEvent<MctsWorkerRequest>) => {
  const { id, state, timeBudgetMs } = event.data;
  const move = runMcts(state, timeBudgetMs);
  const response: MctsWorkerResponse = { id, move };
  postMessage(response);
});
