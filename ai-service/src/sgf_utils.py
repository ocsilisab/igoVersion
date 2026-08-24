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

import re
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
    # Raw SGF BR/WR rank strings ("27k", "3d", "9p", ...), when present -- Fox-derived
    # SGFs use a different (Chinese-suffixed) convention and don't need these, since
    # those games are already pre-sorted into per-rank folders; OGS-derived SGFs use the
    # standard SGF convention and need these for rank_at_least filtering (see below), since
    # a single OGS dump mixes every skill level together.
    black_rank: Optional[str] = None
    white_rank: Optional[str] = None


_RANK_PATTERN = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([kdp])\s*$", re.IGNORECASE)


def rank_to_numeric(rank: Optional[str]) -> Optional[float]:
    """Converts a standard SGF rank string to one ascending numeric scale, higher =
    stronger: kyu counts down towards 0 (30k -> -30, 1k -> -1), dan counts up (1d -> 1,
    9d -> 9), and pro is treated as strictly stronger than any dan (1p -> 10). Returns
    None for anything that doesn't match this format at all (blank, a title, etc.)."""
    if not rank:
        return None
    match = _RANK_PATTERN.match(rank)
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2).lower()
    if unit == "k":
        return -value
    if unit == "d":
        return value
    return value + 9  # "p" (pro)


def rank_at_least(rank: Optional[str], threshold: float) -> bool:
    """True if `rank` (an SGF BR/WR-style string) parses to a numeric rank (see
    rank_to_numeric) at or above `threshold`. False for anything unparseable — an
    unrecorded or malformed rank is never assumed to meet a strength bar."""
    numeric = rank_to_numeric(rank)
    return numeric is not None and numeric >= threshold


def sgfmill_point_to_app_position(
    point: Optional[Tuple[int, int]], board_size: int
) -> Optional[Position]:
    """sgfmill (row, col) has row 0 = bottom; the app has row 0 = top."""
    if point is None:
        return None
    row, col = point
    return (board_size - 1 - row, col)


def _ends_by_real_score(root) -> bool:
    """True if the SGF's RE (result) property records an actual scored margin (e.g.
    "B+3.5", "W+0.0"), as opposed to a resignation ("B+R"/"B+Resign"), a timeout
    ("W+T"/"W+Time"), a forfeit, or no result at all.

    Every game record in this dataset (see featurecat/go-dataset, checked across ~28k
    parsed games spanning 9d down to 3k) stops its move list at the last stone placed and
    records the outcome only as this metadata property -- never as the two consecutive
    passes that Go's own rules require to reach a scored result. A "+<number>" result is
    the only signal available that those passes must have happened; parse_sgf_game uses
    it to add them back in (see below) rather than leave every single game in this
    dataset looking, to a model, like passing is never correct.
    """
    if not root.has_property("RE"):
        return False
    result = root.get("RE")
    if not result or "+" not in result:
        return False
    margin = result.split("+", 1)[1].strip()
    return margin[:1].isdigit()  # "3.5", "0.0", ... — not "R"/"Resign", "T"/"Time", "F"...


def parse_sgf_game(raw: bytes, target_board_size: int = TARGET_BOARD_SIZE) -> Optional[ParsedGame]:
    """Returns None for anything this pipeline deliberately skips: any board size other
    than `target_board_size` (a different size needs its own preprocessing run and,
    ultimately, its own trained model — see model.py's fixed-size Linear head), and
    handicap games (HA>0 or AB present before move 1) — handicap starting positions would
    need extra channels/handling this policy net doesn't have yet, and they're a small
    minority of games at the skill levels this pipeline targets."""
    try:
        game = sgf.Sgf_game.from_bytes(raw)
    except (ValueError, StopIteration):
        return None

    board_size = game.get_size()
    if board_size != target_board_size:
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

    if moves and moves[-1][1] is not None and _ends_by_real_score(root):
        # Two consecutive passes, starting with whoever's turn it was after the last
        # recorded move, is the only way the game could actually have reached a scored
        # result. Only added when the record doesn't already end in a pass itself (rare,
        # but it happens) -- that real pass is already exactly what this is trying to add.
        last_player, _ = moves[-1]
        other_player: Player = "white" if last_player == "black" else "black"
        moves.append((other_player, None))
        moves.append((last_player, None))

    black_rank = root.get("BR") if root.has_property("BR") else None
    white_rank = root.get("WR") if root.has_property("WR") else None

    return ParsedGame(board_size=board_size, moves=moves, black_rank=black_rank, white_rank=white_rank)
