import type { Board, BoardSize, Player, Position } from "../types/game";
import { cloneBoard, opponent, serializeBoard } from "./board";
import { removeDeadGroups } from "./capture";
import { getGroup } from "./liberties";
import { violatesKo } from "./ko";

export type MoveRejectionReason = "occupied" | "suicide" | "ko";

export type MoveResult =
  | { ok: true; board: Board; capturedCount: number; boardState: string }
  | { ok: false; reason: MoveRejectionReason };

/**
 * Applies `player`'s stone placement at `pos` to `board` following the full rule set
 * (occupancy, captures, suicide, Ko) without touching any component/hook state.
 * This is the single source of truth for move legality — both the human move path
 * (useGoGame) and the AI (ai/getValidMoves) call this instead of re-implementing rules.
 */
export function tryMove(
  board: Board,
  boardSize: BoardSize,
  player: Player,
  pos: Position,
  history: string[]
): MoveResult {
  if (board[pos.row][pos.col] !== null) {
    return { ok: false, reason: "occupied" };
  }

  const candidateBoard = cloneBoard(board);
  candidateBoard[pos.row][pos.col] = player;

  const opponentColor = opponent(player);
  const { board: afterCapture, capturedCount } = removeDeadGroups(candidateBoard, opponentColor, boardSize);

  const ownGroup = getGroup(afterCapture, pos, boardSize);
  if (ownGroup.liberties.size === 0) {
    return { ok: false, reason: "suicide" };
  }

  const boardState = serializeBoard(afterCapture);
  if (violatesKo(boardState, history)) {
    return { ok: false, reason: "ko" };
  }

  return { ok: true, board: afterCapture, capturedCount, boardState };
}
