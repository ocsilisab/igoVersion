"""Minimal Go board replay for offline SGF preprocessing: places a stone and removes
any opponent group left with zero liberties. No legality checks (occupancy/suicide/Ko)
-- SGF input is trusted to already be a legal professional game, we only need forward
simulation to reconstruct the true board state (captures and all) at each ply.

Mirrors src/utils/liberties.ts::getGroup and src/utils/capture.ts::removeDeadGroups on
the TypeScript side. Reimplemented here (not called via IPC) because this pipeline
replays millions of positions offline and needs to be fast in-process Python.
"""

from typing import List, Optional, Set, Tuple

from src.adapters.game_adapter import Board, Player, Position


def _neighbors(row: int, col: int, size: int):
    if row > 0:
        yield (row - 1, col)
    if row < size - 1:
        yield (row + 1, col)
    if col > 0:
        yield (row, col - 1)
    if col < size - 1:
        yield (row, col + 1)


def group_and_liberties(
    board: Board, start: Tuple[int, int], size: int
) -> Tuple[List[Tuple[int, int]], Set[Tuple[int, int]]]:
    color = board[start[0]][start[1]]
    stones: List[Tuple[int, int]] = []
    liberties: Set[Tuple[int, int]] = set()
    visited = {start}
    stack = [start]
    while stack:
        row, col = stack.pop()
        stones.append((row, col))
        for nr, nc in _neighbors(row, col, size):
            neighbor = board[nr][nc]
            if neighbor is None:
                liberties.add((nr, nc))
            elif neighbor == color and (nr, nc) not in visited:
                visited.add((nr, nc))
                stack.append((nr, nc))
    return stones, liberties


def apply_move(board: Board, size: int, player: Player, pos: Optional[Position]) -> Board:
    """Returns a NEW board with the move applied. A pass (pos is None) returns the
    board unchanged (same reference -- callers must not mutate it)."""
    if pos is None:
        return board

    row, col = pos
    new_board = [r[:] for r in board]
    new_board[row][col] = player

    opponent: Player = "white" if player == "black" else "black"
    already_checked: Set[Tuple[int, int]] = set()
    for nr, nc in _neighbors(row, col, size):
        if new_board[nr][nc] == opponent and (nr, nc) not in already_checked:
            stones, liberties = group_and_liberties(new_board, (nr, nc), size)
            already_checked.update(stones)
            if not liberties:
                for sr, sc in stones:
                    new_board[sr][sc] = None

    return new_board


def empty_board(size: int) -> Board:
    return [[None] * size for _ in range(size)]


def serialize_board(board: Board) -> str:
    """Mirrors src/utils/board.ts::serializeBoard exactly (same "." / "B" / "W" per-row,
    "/"-joined format) -- the app's history entries use this format, and legal_moves.py's
    Ko check needs to produce strings that compare equal to them."""
    symbol = {None: ".", "black": "B", "white": "W"}
    return "/".join("".join(symbol[stone] for stone in row) for row in board)
