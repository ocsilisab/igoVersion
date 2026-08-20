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
