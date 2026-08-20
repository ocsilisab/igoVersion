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
  const borderColors = new Set<Player>();
  const borderGroupIds = new Set<string>();
  const stack: Position[] = [start];
  visited.add(posKey(start));

  while (stack.length > 0) {
    const pos = stack.pop()!;
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

  return { borderColors, borderGroupIds };
}

/**
 * Suggests which groups are dead when the scoring phase begins, using the classic
 * simplified two-eyes check: a group counts one "eye" for each distinct fully-enclosed
 * (bordered by its own color only) empty region touching it, and is suggested dead if it
 * has fewer than two. This reads the vast majority of settled amateur-game positions
 * correctly, but — like any heuristic that doesn't actually read out capturing races —
 * it can misjudge genuinely ambiguous shapes (seki, bent-four, an eye shared between two
 * separate groups, a group that could still run or connect). It is only ever a starting
 * point: the result seeds `deadStones`, and every mark stays togglable by hand
 * (toggleDeadStoneGroup) exactly as if the player had clicked it themselves, so a wrong
 * guess is always one click away from being corrected before finalizing.
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
  const eyeCounts = new Map<string, number>();

  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (board[row][col] !== null) continue;
      const key = posKey({ row, col });
      if (visitedEmpty.has(key)) continue;

      const { borderColors, borderGroupIds } = floodFillRegion(board, { row, col }, boardSize, visitedEmpty, groupIdAt);
      if (borderColors.size !== 1) continue; // touches both colors (or nothing) — not an eye space

      for (const id of borderGroupIds) {
        eyeCounts.set(id, (eyeCounts.get(id) ?? 0) + 1);
      }
    }
  }

  const suggested = new Set<string>();
  for (const [id, stones] of groupsById) {
    if ((eyeCounts.get(id) ?? 0) < 2) {
      for (const p of stones) suggested.add(posKey(p));
    }
  }

  return suggested;
}
