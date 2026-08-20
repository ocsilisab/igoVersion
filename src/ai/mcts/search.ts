import type { Board, BoardSize, Player, Position } from "../../types/game.js";
import { opponent } from "../../utils/board.js";
import { tryMove } from "../../utils/move.js";
import type { MctsMove, MctsNode } from "./node.js";
import { isTerminal } from "./node.js";
import { uctScore } from "./uct.js";
import { rollout } from "./simulate.js";

export interface MctsRootState {
  board: Board;
  boardSize: BoardSize;
  history: string[];
  /** Whose turn it is to move from this position — the AI's own color when called from chooseMctsMove. */
  toMove: Player;
  consecutivePasses: number;
  komi: number;
}

function createRootNode(state: MctsRootState): MctsNode {
  return {
    move: null,
    // No move actually led to the root, but setting this to the *opponent* of toMove
    // means opponent(root.playerJustMoved) === toMove everywhere below, so the root's
    // own children (toMove's candidate moves) get playerJustMoved = toMove and their
    // win rate is read directly off wins/visits, same as every other node in the tree.
    playerJustMoved: opponent(state.toMove),
    board: state.board,
    history: state.history,
    consecutivePasses: state.consecutivePasses,
    parent: null,
    children: [],
    untriedMoves: null,
    visits: 0,
    wins: 0,
  };
}

function legalMovesFrom(node: MctsNode, boardSize: BoardSize): MctsMove[] {
  const toMove = opponent(node.playerJustMoved);
  const moves: MctsMove[] = [];

  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (node.board[row][col] !== null) continue;
      const result = tryMove(node.board, boardSize, toMove, { row, col }, node.history);
      if (result.ok) moves.push({ row, col });
    }
  }

  moves.push("pass"); // always a legal option, even with no board moves left
  return moves;
}

/** Computes (and caches on the node) the moves not yet expanded into a child. */
function ensureUntriedMoves(node: MctsNode, boardSize: BoardSize): MctsMove[] {
  if (node.untriedMoves === null) {
    node.untriedMoves = isTerminal(node) ? [] : legalMovesFrom(node, boardSize);
  }
  return node.untriedMoves;
}

function selectChild(node: MctsNode): MctsNode {
  let best = node.children[0];
  let bestScore = -Infinity;

  for (const child of node.children) {
    const score = uctScore(child.visits, child.wins, node.visits);
    if (score > bestScore) {
      bestScore = score;
      best = child;
    }
  }

  return best;
}

function applyMove(node: MctsNode, move: MctsMove, boardSize: BoardSize): MctsNode {
  const toMove = opponent(node.playerJustMoved);

  if (move === "pass") {
    return {
      move: "pass",
      playerJustMoved: toMove,
      board: node.board,
      history: node.history,
      consecutivePasses: node.consecutivePasses + 1,
      parent: node,
      children: [],
      untriedMoves: null,
      visits: 0,
      wins: 0,
    };
  }

  // Only ever called with a move legalMovesFrom already validated via tryMove, so this
  // can never fail — the fallback branch just satisfies the type checker.
  const result = tryMove(node.board, boardSize, toMove, move, node.history);
  const board = result.ok ? result.board : node.board;
  const boardState = result.ok ? result.boardState : node.history[node.history.length - 1];

  return {
    move,
    playerJustMoved: toMove,
    board,
    history: [...node.history, boardState],
    consecutivePasses: 0,
    parent: node,
    children: [],
    untriedMoves: null,
    visits: 0,
    wins: 0,
  };
}

function expand(node: MctsNode, boardSize: BoardSize): MctsNode {
  const untried = ensureUntriedMoves(node, boardSize);
  const index = Math.floor(Math.random() * untried.length);
  const move = untried[index];
  untried.splice(index, 1);

  const child = applyMove(node, move, boardSize);
  node.children.push(child);
  return child;
}

function backpropagate(node: MctsNode, winner: Player | "draw"): void {
  let current: MctsNode | null = node;
  while (current !== null) {
    current.visits += 1;
    if (winner === current.playerJustMoved) current.wins += 1;
    else if (winner === "draw") current.wins += 0.5;
    current = current.parent;
  }
}

/**
 * Runs UCT Monte Carlo Tree Search for up to `timeBudgetMs`, then returns the root move
 * that was visited the most — the standard "robust child" choice (more stable than
 * picking the highest raw win rate, which can be misleadingly high from very few tries).
 * Returns null to recommend a pass. The time budget alone is what tunes strength: more
 * time → more simulations → a better-informed choice, with no other code changes needed.
 */
export function runMcts(state: MctsRootState, timeBudgetMs: number): Position | null {
  const root = buildSearchTree(state, timeBudgetMs);
  return bestMoveFrom(root);
}

/** Same search, but returns the raw root node — used for diagnostics/testing. */
export function buildSearchTree(state: MctsRootState, timeBudgetMs: number): MctsNode {
  const root = createRootNode(state);
  const { boardSize } = state;
  const deadline = Date.now() + timeBudgetMs;

  do {
    let node = root;

    // 1. Selection: descend while fully expanded and non-terminal.
    while (!isTerminal(node) && ensureUntriedMoves(node, boardSize).length === 0 && node.children.length > 0) {
      node = selectChild(node);
    }

    // 2. Expansion: add one new child for an untried move, if any.
    if (!isTerminal(node) && ensureUntriedMoves(node, boardSize).length > 0) {
      node = expand(node, boardSize);
    }

    // 3. Simulation: play a random-ish game to the end from here.
    const toMove = opponent(node.playerJustMoved);
    const winner = rollout(node.board, boardSize, node.history, toMove, node.consecutivePasses, state.komi);

    // 4. Backpropagation: credit the result up the path just walked.
    backpropagate(node, winner);
  } while (Date.now() < deadline);

  return root;
}

function bestMoveFrom(root: MctsNode): Position | null {
  if (root.children.length === 0) return null;

  let best = root.children[0];
  for (const child of root.children) {
    if (child.visits > best.visits) best = child;
  }

  return best.move === "pass" ? null : best.move;
}
