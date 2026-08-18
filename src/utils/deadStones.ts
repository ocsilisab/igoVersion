import type { Board, BoardSize, Position } from "../types/game";
import { posKey } from "./board";
import { getGroup } from "./liberties";

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
