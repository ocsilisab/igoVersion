"""Preprocesses the OGS SGF archive (see config-9x9.yaml's dataset comment for where it
comes from) into training shards for a 9x9 (or, with a different config, 13x13) model.

A separate entry point from preprocessing.py's Fox-oriented main(): the OGS dump isn't
organized into per-rank folders the way Fox's archives are (see dataset.py), so instead
of pre-sorted directories it needs a per-game rank filter applied from each SGF's own
BR/WR properties (see sgf_utils.py::rank_at_least) to avoid training on the site's huge
volume of casual/beginner games.

Usage:
    python -m src.preprocess_ogs --config config-9x9.yaml --source-dir data/raw/ogs/sgfs-by-date
"""

import argparse
from pathlib import Path
from typing import Callable, Optional

import yaml

from src.dataset import iter_sgf_bytes_recursive
from src.preprocessing import run_preprocessing
from src.sgf_utils import ParsedGame, rank_at_least


def make_rank_filter(min_rank: float) -> Callable[[ParsedGame], bool]:
    """Keeps only games where *both* players meet `min_rank` (see
    sgf_utils.py::rank_to_numeric for the scale) -- one strong player carrying a much
    weaker opponent isn't the instructive, evenly-contested game this is trying to source."""

    def _filter(game: ParsedGame) -> bool:
        return rank_at_least(game.black_rank, min_rank) and rank_at_least(game.white_rank, min_rank)

    return _filter


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path(__file__).resolve().parent.parent / "config-9x9.yaml")
    parser.add_argument(
        "--source-dir", type=Path, required=True, help="Root directory of already-extracted OGS SGF files"
    )
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument(
        "--require-winner",
        action="store_true",
        help="Drop games with no determinate result (see sgf_utils.parse_winner) -- needed to train the Value Head",
    )
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    dataset_cfg = config["dataset"]
    board_size = dataset_cfg["board_size"]
    min_rank: Optional[float] = dataset_cfg.get("min_rank")

    service_root = args.config.resolve().parent
    out_dir = args.out_dir or (service_root / "data" / f"processed_{board_size}x{board_size}")

    print(
        f"Preprocesando OGS: source_dir={args.source_dir} board_size={board_size} "
        f"min_rank={min_rank} max_games={dataset_cfg['max_games']} "
        f"max_positions_per_game={dataset_cfg['max_positions_per_game']}",
        flush=True,
    )
    stats = run_preprocessing(
        raw_game_bytes=iter_sgf_bytes_recursive(args.source_dir),
        out_dir=out_dir,
        max_games=dataset_cfg["max_games"],
        board_size=board_size,
        game_filter=make_rank_filter(min_rank) if min_rank is not None else None,
        max_positions_per_game=dataset_cfg["max_positions_per_game"],
        scanned_log_every=50_000,
        require_winner=args.require_winner,
    )
    print(stats)


if __name__ == "__main__":
    main()
