import type { Board, BoardSize, Player, Position } from "../types/game.js";
import { getNeighbors, posKey } from "./board.js";
import { getGroup } from "./liberties.js";

/**
 * Toggles the dead/alive mark for the whole connected group at `pos` (standard Go scoring
 * UX: clicking one stone marks/revives its entire group). Pure — returns a new Set, used
 * identically by the local scoring phase (useGoGame) and the online mark-dead endpoint.
 */
export function toggleDeadStoneGroup(
  board: Board,
  boardSize: BoardSize,
  pos: Position,
  deadStones: Set<string>
): Set<string> {
  if (board[pos.row][pos.col] === null) return deadStones;

  const group = getGroup(board, pos, boardSize);
  const wasDead = deadStones.has(posKey(pos));
  const next = new Set(deadStones);

  for (const stonePos of group.stones) {
    const key = posKey(stonePos);
    if (wasDead) next.delete(key);
    else next.add(key);
  }

  return next;
}

function groupId(stones: Position[]): string {
  return stones.map(posKey).sort().join("|");
}

interface RegionInfo {
  size: number;
  borderColors: Set<Player>;
  borderGroupIds: Set<string>;
}

function floodFillRegion(
  board: Board,
  start: Position,
  boardSize: BoardSize,
  visited: Set<string>,
  groupIdAt: Map<string, string>
): RegionInfo {
  let size = 0;
  const borderColors = new Set<Player>();
  const borderGroupIds = new Set<string>();
  const stack: Position[] = [start];
  visited.add(posKey(start));

  while (stack.length > 0) {
    const pos = stack.pop()!;
    size++;
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
        const groupIdOfNeighbor = groupIdAt.get(key);
        if (groupIdOfNeighbor) borderGroupIds.add(groupIdOfNeighbor);
      }
    }
  }

  return { size, borderColors, borderGroupIds };
}

/**
 * An enclosed space at least this big is treated as unconditionally safe on its own,
 * without needing a second, separate eye — the classic Go rule of thumb ("six die,
 * eight live"): a connected space this size can always be shaped into two eyes no
 * matter what the opponent plays inside it. Below this size a single region is only
 * *sometimes* alive depending on its exact shape (straight-three, bent-four, and the
 * rest of the nakade table) — too fine-grained to classify correctly here, so a region
 * under this size only ever counts toward the "two separate small eyes" signal below,
 * never toward this one on its own.
 */
const SAFE_TERRITORY_SIZE = 6;

/**
 * Suggests which groups are dead when the scoring phase begins. A group is treated as
 * alive (not suggested) if either signal holds:
 *   - it borders at least one single-color-bordered empty region of SAFE_TERRITORY_SIZE
 *     or more (one big open territory, not yet subdivided into separate eyes, which is
 *     exactly what a real end-of-game board almost always looks like — nobody bothers
 *     to fill in their own obvious territory before passing); or
 *   - it borders at least two *separate* smaller such regions (the classic "two eyes"
 *     shape once territory genuinely has been divided).
 * Anything satisfying neither is suggested dead.
 *
 * An earlier version only ever counted "one region = one eye" regardless of size, which
 * meant almost every normal living group — whose whole territory is one big undivided
 * space at the moment both players pass — registered as having just one eye and got
 * suggested dead. This is why most groups were showing up dead by default instead of
 * just the rare genuine corpse; the size-based signal above is what actually fixes that.
 *
 * Like any heuristic that doesn't actually read out capturing races, this can still
 * misjudge genuinely ambiguous shapes (seki, bent-four, an eye shared between two
 * separate groups, a group that could still run or connect, or an under-6 region whose
 * specific shape happens to be dead). It is only ever a starting point: the result seeds
 * `deadStones`, and every mark stays togglable by hand (toggleDeadStoneGroup) exactly as
 * if the player had clicked it themselves, so a wrong guess is always one click away
 * from being corrected before finalizing.
 */
export function suggestDeadGroups(board: Board, boardSize: BoardSize): Set<string> {
  const groupIdAt = new Map<string, string>();
  const groupsById = new Map<string, Position[]>();
  const visitedStones = new Set<string>();

  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      const stone = board[row][col];
      const key = posKey({ row, col });
      if (stone === null || visitedStones.has(key)) continue;

      const group = getGroup(board, { row, col }, boardSize);
      const id = groupId(group.stones);
      groupsById.set(id, group.stones);
      for (const p of group.stones) {
        const stoneKey = posKey(p);
        visitedStones.add(stoneKey);
        groupIdAt.set(stoneKey, id);
      }
    }
  }

  const visitedEmpty = new Set<string>();
  const smallEyeCounts = new Map<string, number>();
  const hasSafeTerritory = new Set<string>();

  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (board[row][col] !== null) continue;
      const key = posKey({ row, col });
      if (visitedEmpty.has(key)) continue;

      const { size, borderColors, borderGroupIds } = floodFillRegion(board, { row, col }, boardSize, visitedEmpty, groupIdAt);
      if (borderColors.size !== 1) continue; // touches both colors (or nothing) — not territory for anyone

      for (const id of borderGroupIds) {
        if (size >= SAFE_TERRITORY_SIZE) {
          hasSafeTerritory.add(id);
        } else {
          smallEyeCounts.set(id, (smallEyeCounts.get(id) ?? 0) + 1);
        }
      }
    }
  }

  const suggested = new Set<string>();
  for (const [id, stones] of groupsById) {
    const alive = hasSafeTerritory.has(id) || (smallEyeCounts.get(id) ?? 0) >= 2;
    if (!alive) {
      for (const p of stones) suggested.add(posKey(p));
    }
  }

  return suggested;
}
