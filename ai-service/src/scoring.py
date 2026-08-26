"""Area scoring, mirroring src/utils/scoring.ts::calculateScore (stones + surrounded
territory + captures + komi) -- the exact same rule the app uses to decide a winner.

The one deliberate difference: the TS version takes a pre-cleaned board (dead stones
already removed by removeDeadStones, based on what the players marked in the UI).
MCTS has no one to mark dead stones -- a simulated line reaching two passes gets scored
on the raw board as-is (every stone counted alive). This is a real limitation on
messy/unsettled positions, but it's the same well-defined algorithm the app already
uses, not a new or different rule; see mcts.py's module docstring for why this is an
acceptable approximation for search rather than a scoring bug.
"""

from dataclasses import dataclass
from typing import List, Set, Tuple

from src.adapters.game_adapter import Board, Player


def _neighbors(row: int, col: int, size: int):
    if row > 0:
        yield (row - 1, col)
    if row < size - 1:
        yield (row + 1, col)
    if col > 0:
        yield (row, col - 1)
    if col < size - 1:
        yield (row, col + 1)


@dataclass
class ScoreResult:
    black_stones: int
    white_stones: int
    black_territory: int
    white_territory: int
    black_score: float
    white_score: float
    winner: str  # "black" | "white" | "draw"


def calculate_score(
    board: Board, size: int, black_captures: int, white_captures: int, komi: float
) -> ScoreResult:
    black_stones = 0
    white_stones = 0
    black_territory = 0
    white_territory = 0
    visited: Set[Tuple[int, int]] = set()

    for row in range(size):
        for col in range(size):
            stone = board[row][col]
            if stone == "black":
                black_stones += 1
                continue
            if stone == "white":
                white_stones += 1
                continue

            if (row, col) in visited:
                continue

            # Flood-fill this empty region; territory belongs to a color only if the
            # whole connected region borders exactly that one color (never both).
            region: List[Tuple[int, int]] = []
            border_colors: Set[Player] = set()
            stack = [(row, col)]
            visited.add((row, col))
            while stack:
                r, c = stack.pop()
                region.append((r, c))
                for nr, nc in _neighbors(r, c, size):
                    neighbor = board[nr][nc]
                    if neighbor is None:
                        if (nr, nc) not in visited:
                            visited.add((nr, nc))
                            stack.append((nr, nc))
                    else:
                        border_colors.add(neighbor)

            if len(border_colors) == 1:
                (owner,) = border_colors
                if owner == "black":
                    black_territory += len(region)
                else:
                    white_territory += len(region)

    black_score = black_stones + black_territory + black_captures
    white_score = white_stones + white_territory + white_captures + komi

    winner = "black" if black_score > white_score else "white" if white_score > black_score else "draw"

    return ScoreResult(
        black_stones=black_stones,
        white_stones=white_stones,
        black_territory=black_territory,
        white_territory=white_territory,
        black_score=black_score,
        white_score=white_score,
        winner=winner,
    )
