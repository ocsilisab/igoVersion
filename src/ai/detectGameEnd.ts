import type { Board, BoardSize, Player, Position } from "../types/game.js";
import { calculateScore, removeDeadStones } from "../utils/scoring.js";
import { getNeighbors, opponent, posKey } from "../utils/board.js";
import { getGroup } from "../utils/liberties.js";

/** A move worth checking: how many enemy stones it captures and the board it leaves behind. */
export interface EndgameCandidate {
  capturedCount: number;
  resultingBoard: Board;
}

/** An EndgameCandidate that also knows which point it is — bestBeneficialMove needs this
 * to hand back an actual move, not just a yes/no verdict the way isGameEffectivelyOver does. */
export interface ScoredEndgameCandidate extends EndgameCandidate {
  position: Position;
}

/**
 * Minimum net score swing (in points) a move must gain over passing before it counts as
 * still worth playing. Area scoring makes a stone and a point of territory worth exactly
 * the same, so filling your *own* settled territory nets zero and correctly stays below
 * this bar — only a capture, a group-saving extension, or claiming a neutral/contested
 * point (all of which turn an uncounted point into a counted one) clears it.
 */
export const MIN_BENEFICIAL_MARGIN = 1;

/**
 * Only an empty region no bigger than this counts as a real "eye" when deciding whether an
 * enemy group is hopeless (see findHopelessEnemyGroups). A genuine single-eye shape —
 * including big false eyes or bent/L shapes — is comfortably smaller than this; a bigger
 * region is either a real living eye-space that hasn't been narrowed down yet, or just
 * ordinary open board. This heuristic can't tell those two apart, so it deliberately
 * refuses to judge them at all rather than risk writing off a group that's still fighting
 * for life.
 */
const EYE_REGION_SIZE_CAP = 6;

/**
 * How full the board must already be before this module will even consider writing off an
 * enemy group as hopeless. Below this point virtually every group's liberties still open
 * onto one large, mostly-empty region, which trivially looks "bordered by only one color"
 * (nothing else is on the board yet) without meaning anything about life and death — every
 * single opening move would otherwise register as a hopeless 0-eye group. Gating on a high
 * occupancy ratio keeps this correction inert until the position is genuinely late-game,
 * where a small isolated pocket really does mean "no room left to make eyes" instead of
 * "hasn't been contested yet".
 */
const MIN_OCCUPANCY_FOR_DEAD_GROUP_CHECK = 0.75;

function occupancyRatio(board: Board, boardSize: BoardSize): number {
  let filled = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell !== null) filled++;
    }
  }
  return filled / (boardSize * boardSize);
}

interface EmptyRegion {
  cells: Position[];
  borderColors: Set<Player>;
}

function floodFillEmpty(board: Board, start: Position, boardSize: BoardSize, visited: Set<string>): EmptyRegion {
  const cells: Position[] = [];
  const borderColors = new Set<Player>();
  const stack: Position[] = [start];
  visited.add(posKey(start));

  while (stack.length > 0) {
    const pos = stack.pop()!;
    cells.push(pos);

    for (const neighbor of getNeighbors(pos, boardSize)) {
      const stone = board[neighbor.row][neighbor.col];
      const key = posKey(neighbor);
      if (stone === null) {
        if (!visited.has(key)) {
          visited.add(key);
          stack.push(neighbor);
        }
      } else {
        borderColors.add(stone);
      }
    }
  }

  return { cells, borderColors };
}

/**
 * Enemy groups (from `aiColor`'s point of view) this heuristic is confident are already
 * dead: fewer than 2 eyes, none bigger than EYE_REGION_SIZE_CAP, on a board that's already
 * mostly settled (MIN_OCCUPANCY_FOR_DEAD_GROUP_CHECK). Deliberately never evaluates
 * `aiColor`'s own groups: misjudging an enemy group only costs a little extra caution (the
 * AI keeps mopping it up move by move instead of passing early, exactly the pre-existing,
 * always-correct behavior) — misjudging your *own* group as dead would instead make the AI
 * wrongly give up on, or over-credit itself for, a fight it's actually still in, which is
 * a far worse failure this asymmetry avoids by construction.
 */
function findHopelessEnemyGroups(board: Board, boardSize: BoardSize, aiColor: Player): Set<string> {
  const dead = new Set<string>();
  if (occupancyRatio(board, boardSize) < MIN_OCCUPANCY_FOR_DEAD_GROUP_CHECK) return dead;

  const enemyColor = opponent(aiColor);
  const groupIdAt = new Map<string, string>();
  const groupsById = new Map<string, Position[]>();
  const visitedStones = new Set<string>();

  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (board[row][col] !== enemyColor) continue;
      const key = posKey({ row, col });
      if (visitedStones.has(key)) continue;

      const group = getGroup(board, { row, col }, boardSize);
      groupsById.set(key, group.stones);
      for (const stone of group.stones) {
        const stoneKey = posKey(stone);
        visitedStones.add(stoneKey);
        groupIdAt.set(stoneKey, key);
      }
    }
  }

  if (groupsById.size === 0) return dead;

  const visitedEmpty = new Set<string>();
  const eyeCounts = new Map<string, number>();

  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (board[row][col] !== null) continue;
      const key = posKey({ row, col });
      if (visitedEmpty.has(key)) continue;

      const { cells, borderColors } = floodFillEmpty(board, { row, col }, boardSize, visitedEmpty);
      if (cells.length > EYE_REGION_SIZE_CAP) continue;
      if (borderColors.size !== 1) continue;
      const [owner] = borderColors;
      if (owner !== enemyColor) continue;

      const borderingGroupIds = new Set<string>();
      for (const cell of cells) {
        for (const neighbor of getNeighbors(cell, boardSize)) {
          if (board[neighbor.row][neighbor.col] !== enemyColor) continue;
          const id = groupIdAt.get(posKey(neighbor));
          if (id) borderingGroupIds.add(id);
        }
      }
      for (const id of borderingGroupIds) {
        eyeCounts.set(id, (eyeCounts.get(id) ?? 0) + 1);
      }
    }
  }

  for (const [id, stones] of groupsById) {
    if ((eyeCounts.get(id) ?? 0) < 2) {
      for (const stone of stones) dead.add(posKey(stone));
    }
  }

  return dead;
}

/**
 * `aiColor`'s score minus the opponent's, for `board` as-is, crediting `capturesForAi`
 * captures to `aiColor` alone. Existing accumulated captures are deliberately omitted
 * (always passed as 0/0) rather than read from game state: since they're a constant added
 * equally to a "before" and "after" call, they cancel out of any margin *difference* — so
 * omitting them lets this same helper score a hypothetical MCTS move that has no game
 * state of its own, not just a real one.
 *
 * Before scoring, this also strips out whichever enemy groups findHopelessEnemyGroups
 * considers unmistakably dead, crediting them as captures — so a group that's already
 * cornered with no eye-making room left, but still has several physical liberties, stops
 * *looking* newly profitable to poke at one liberty at a time. Recomputed fresh on both
 * the current board and each candidate's resulting board, so a move that actually changes
 * a group's status (finishing a kill, or the group unexpectedly gaining real room) still
 * shows up as a real margin swing.
 */
export function lifeAwareMargin(board: Board, boardSize: BoardSize, aiColor: Player, capturesForAi: number, komi: number): number {
  const hopelessEnemyStones = findHopelessEnemyGroups(board, boardSize, aiColor);
  const { board: cleaned, deadBlack, deadWhite } = removeDeadStones(board, hopelessEnemyStones);
  const blackCaptures = (aiColor === "black" ? capturesForAi : 0) + deadWhite;
  const whiteCaptures = (aiColor === "white" ? capturesForAi : 0) + deadBlack;
  const result = calculateScore(cleaned, boardSize, blackCaptures, whiteCaptures, komi);
  return aiColor === "black" ? result.blackScore - result.whiteScore : result.whiteScore - result.blackScore;
}

/**
 * True once none of `candidates` would improve `aiColor`'s score margin over simply
 * passing — the same test a human uses to decide a game is over. A capture always clears
 * the bar (it both removes an enemy stone and, usually, converts the point to your
 * territory — at least a 2-point swing). Extending a group out of atari does too, since
 * the liberty played on was contested ground, not already-settled territory. Filling dame
 * or invading unsettled territory clears it for whoever's turn it is. Continuing to reduce
 * the liberties of an enemy group already recognized as hopeless (see
 * findHopelessEnemyGroups) does not — that credit was already banked before the move.
 * Only moves that change nothing but the shape of your own already-solid territory, or
 * mechanically capture a group already known to be dead, fail to clear it — which is
 * exactly when a human stops playing. Used by all three difficulties ("Fácil" in
 * chooseMove.ts, "Difícil" in mcts/search.ts, and "Experta" in chooseNeuralMove.ts) so
 * they share one definition of "nothing left to gain" for when to pass. "Experta" also
 * uses this same margin (see bestBeneficialMove below) to catch the neural net picking a
 * move that gains nothing when a real one is available — professional game records
 * essentially never show the actual dame-filling sequence (see ai-service/config.yaml's
 * dataset notes), so the network never had much to learn that specific skill from.
 *
 * Caveat: findHopelessEnemyGroups is a heuristic, not a full life-and-death reading, and
 * only ever acts very late (see MIN_OCCUPANCY_FOR_DEAD_GROUP_CHECK) and only on small,
 * unambiguous shapes (see EYE_REGION_SIZE_CAP). A genuinely ambiguous fight (seki,
 * bent-four, a shared eye, or any group whose room is still bigger than the cap) is left
 * completely alone rather than guessed at.
 */
export function isGameEffectivelyOver(
  board: Board,
  boardSize: BoardSize,
  komi: number,
  aiColor: Player,
  candidates: EndgameCandidate[]
): boolean {
  if (candidates.length === 0) return true;

  const before = lifeAwareMargin(board, boardSize, aiColor, 0, komi);

  return !candidates.some((candidate) => {
    const after = lifeAwareMargin(candidate.resultingBoard, boardSize, aiColor, candidate.capturedCount, komi);
    return after - before >= MIN_BENEFICIAL_MARGIN;
  });
}

/**
 * The single candidate with the biggest beneficial margin over passing — null if none of
 * them clear MIN_BENEFICIAL_MARGIN (see isGameEffectivelyOver; call that first to decide
 * whether to pass instead of trusting this to return null).
 *
 * Greedily maximizing this margin is the *correct* choice specifically for this narrow
 * decision: under area scoring every dame/neutral point is worth exactly the same one
 * point regardless of which one you take, so there is no strategic difference between
 * them to weigh — unlike using this margin as a general move-selection strategy for the
 * rest of the game, which would ignore sente/gote, ko threats, and unresolved fights.
 * See chooseNeuralMove.ts for the one caller: a safety net for when "Experta"'s own pick
 * gains nothing (see isGameEffectivelyOver's docstring for why that happens).
 */
export function bestBeneficialMove(
  board: Board,
  boardSize: BoardSize,
  komi: number,
  aiColor: Player,
  candidates: ScoredEndgameCandidate[]
): ScoredEndgameCandidate | null {
  const before = lifeAwareMargin(board, boardSize, aiColor, 0, komi);

  let best: ScoredEndgameCandidate | null = null;
  let bestMargin = -Infinity;
  for (const candidate of candidates) {
    const after = lifeAwareMargin(candidate.resultingBoard, boardSize, aiColor, candidate.capturedCount, komi);
    const margin = after - before;
    if (margin > bestMargin) {
      bestMargin = margin;
      best = candidate;
    }
  }

  return bestMargin >= MIN_BENEFICIAL_MARGIN ? best : null;
}
