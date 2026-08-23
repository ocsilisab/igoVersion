import type { Board, BoardSize, Player } from "../types/game.js";
import { calculateScore } from "../utils/scoring.js";

/** A move worth checking: how many enemy stones it captures and the board it leaves behind. */
export interface EndgameCandidate {
  capturedCount: number;
  resultingBoard: Board;
}

/**
 * Minimum net score swing (in points) a move must gain over passing before it counts as
 * still worth playing. Area scoring makes a stone and a point of territory worth exactly
 * the same, so filling your *own* settled territory nets zero and correctly stays below
 * this bar — only a capture, a group-saving extension, or claiming a neutral/contested
 * point (all of which turn an uncounted point into a counted one) clears it.
 */
const MIN_BENEFICIAL_MARGIN = 1;

/**
 * `aiColor`'s score minus the opponent's, for `board` as-is, crediting `capturesForAi`
 * captures to `aiColor` alone. Existing accumulated captures are deliberately omitted
 * (always passed as 0/0) rather than read from game state: since they're a constant added
 * equally to a "before" and "after" call, they cancel out of any margin *difference* — so
 * omitting them lets this same helper score a hypothetical MCTS move that has no game
 * state of its own, not just a real one.
 */
function scoreMargin(board: Board, boardSize: BoardSize, aiColor: Player, capturesForAi: number, komi: number): number {
  const blackCaptures = aiColor === "black" ? capturesForAi : 0;
  const whiteCaptures = aiColor === "white" ? capturesForAi : 0;
  const result = calculateScore(board, boardSize, blackCaptures, whiteCaptures, komi);
  return aiColor === "black" ? result.blackScore - result.whiteScore : result.whiteScore - result.blackScore;
}

/**
 * True once none of `candidates` would improve `aiColor`'s score margin over simply
 * passing — the same test a human uses to decide a game is over. A capture always clears
 * the bar (it both removes an enemy stone and, usually, converts the point to your
 * territory — at least a 2-point swing). Extending a group out of atari does too, since
 * the liberty played on was contested ground, not already-settled territory. Filling dame
 * or invading unsettled territory clears it for whoever's turn it is. Only moves that
 * change nothing but the shape of your own already-solid territory fail to clear it —
 * which is exactly when a human stops playing. Used by both heuristic difficulties
 * ("Fácil" in chooseMove.ts, "Difícil" in mcts/search.ts) so they share one definition of
 * "nothing left to gain"; "Experta" is untouched, since the neural net learned its own
 * sense of when a position is settled from training data.
 */
export function isGameEffectivelyOver(
  board: Board,
  boardSize: BoardSize,
  komi: number,
  aiColor: Player,
  candidates: EndgameCandidate[]
): boolean {
  if (candidates.length === 0) return true;

  const before = scoreMargin(board, boardSize, aiColor, 0, komi);

  return !candidates.some((candidate) => {
    const after = scoreMargin(candidate.resultingBoard, boardSize, aiColor, candidate.capturedCount, komi);
    return after - before >= MIN_BENEFICIAL_MARGIN;
  });
}
