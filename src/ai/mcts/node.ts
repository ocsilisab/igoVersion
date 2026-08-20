import type { Board, Player, Position } from "../../types/game.js";

/** A move considered during search — either a board position or an explicit pass. */
export type MctsMove = Position | "pass";

/**
 * One position in the search tree. `playerJustMoved` is the color that played `move` to
 * reach this node (meaningless for the root, which has no real "just moved" color — see
 * search.ts::createRootNode). Every node's `wins`/`visits` are always counted from
 * `playerJustMoved`'s own perspective, so picking the best child of any node is always a
 * plain argmax over `wins/visits` — no perspective-flipping needed anywhere else.
 */
export interface MctsNode {
  move: MctsMove | null;
  playerJustMoved: Player;
  board: Board;
  history: string[];
  consecutivePasses: number;
  parent: MctsNode | null;
  children: MctsNode[];
  /** Legal moves not yet expanded into a child — null until first computed (lazy). */
  untriedMoves: MctsMove[] | null;
  visits: number;
  wins: number;
}

/** Two passes in a row end the (simulated) game at this node — nothing more to expand. */
export function isTerminal(node: MctsNode): boolean {
  return node.consecutivePasses >= 2;
}

/**
 * Appends a board state, keeping only the last 2 entries — Ko-checking
 * (utils/move.ts::tryMove → utils/ko.ts::violatesKo) only ever reads `history[length-2]`,
 * so nothing beyond that is ever needed. Fase 1 self-play testing found that growing the
 * *actual* history array (via `[...history, x]`) on every single rollout ply made
 * simulations progressively slower the deeper into a real game they started from — this
 * keeps history bounded to a fixed, cheap-to-allocate size regardless of how many real
 * moves have already been played.
 */
export function advanceHistory(history: string[], newState: string): string[] {
  return history.length >= 1 ? [history[history.length - 1], newState] : [newState];
}
