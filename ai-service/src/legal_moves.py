"""Legality check for a single candidate move, mirroring src/utils/move.ts::tryMove
(occupancy, suicide, Ko) on the TypeScript side.

Duplicated deliberately, not reused via IPC: this runs inside the inference request path
(see inference.py), and the model process has no way to call into the Node/Vercel runtime
without round-tripping through the network on every one of up to ~362 candidate moves per
request. This is NOT the final authority, though -- whatever endpoint actually applies the
chosen move (useGoGame.placeStone locally, or api/games/[id]/move.ts online) re-validates
through the real tryMove regardless, so a subtle bug here would get caught, not silently
accepted. See Fase 1 analysis in the project notes.
"""

from typing import List, Optional

from src.adapters.game_adapter import Board, Player, Position
from src.go_board import apply_move, group_and_liberties, serialize_board


def is_legal_move(
    board: Board, size: int, player: Player, pos: Optional[Position], history: List[str]
) -> bool:
    """A pass is always legal. A placement is legal iff the point is empty, the move
    doesn't leave its own group with zero liberties after captures (no suicide), and the
    resulting position isn't identical to the position two plies ago (basic Ko)."""
    if pos is None:
        return True

    row, col = pos
    if board[row][col] is not None:
        return False

    candidate_board = apply_move(board, size, player, pos)
    _, liberties = group_and_liberties(candidate_board, (row, col), size)
    if not liberties:
        return False

    if len(history) >= 2:
        candidate_state = serialize_board(candidate_board)
        if candidate_state == history[-2]:
            return False

    return True
