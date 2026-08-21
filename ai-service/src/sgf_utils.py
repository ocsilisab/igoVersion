"""Parses SGF game records into the app's own board/coordinate convention.

Uses sgfmill (github.com/mattheww/sgfmill) for the actual SGF syntax (property
escaping, node tree, etc.) since that's fiddly to get right by hand — but sgfmill
returns points in GTP-style bottom-up rows (row 0 = bottom), while the app's Board
(src/types/game.ts, rendered in GoBoard.tsx) uses row 0 = top, same as a plain
row-major array. This module is the single place that flip happens; everything
downstream in this package only ever sees app-convention (row, col).

Verified empirically (not just from memory of the library's docs): SGF "aa"
(top-left per the SGF spec) round-trips through sgfmill as (18, 0) on a 19x19
board, and this module converts that to app position (0, 0). See
tests/test_sgf_utils.py.
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple

from sgfmill import sgf

from src.adapters.game_adapter import Player, Position

TARGET_BOARD_SIZE = 19


@dataclass
class ParsedGame:
    board_size: int
    # Play order, mainline only (variations are ignored). Each entry is
    # (player, position_or_None_for_pass), already in app coordinates.
    moves: List[Tuple[Player, Optional[Position]]]


def sgfmill_point_to_app_position(
    point: Optional[Tuple[int, int]], board_size: int
) -> Optional[Position]:
    """sgfmill (row, col) has row 0 = bottom; the app has row 0 = top."""
    if point is None:
        return None
    row, col = point
    return (board_size - 1 - row, col)


def parse_sgf_game(raw: bytes) -> Optional[ParsedGame]:
    """Returns None for anything this v1 pipeline deliberately skips: non-19x19
    boards, and handicap games (HA>0 or AB present before move 1) — handicap
    starting positions would need extra channels/handling this policy net
    doesn't have yet, and they're a small minority of dan-level Fox games."""
    try:
        game = sgf.Sgf_game.from_bytes(raw)
    except (ValueError, StopIteration):
        return None

    board_size = game.get_size()
    if board_size != TARGET_BOARD_SIZE:
        return None

    root = game.get_root()
    if root.has_property("HA") and root.get("HA") not in (0, None):
        return None
    if root.has_property("AB") or root.has_property("AW"):
        return None

    moves: List[Tuple[Player, Optional[Position]]] = []
    for node in game.get_main_sequence():
        if not node.has_property("B") and not node.has_property("W"):
            continue
        color, point = node.get_move()
        if color is None:
            continue
        player: Player = "black" if color == "b" else "white"
        position = sgfmill_point_to_app_position(point, board_size)
        moves.append((player, position))

    return ParsedGame(board_size=board_size, moves=moves)
