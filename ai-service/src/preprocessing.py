"""Turns raw SGF games into compact, sharded training samples on disk.

Pipeline: dataset.py streams raw SGF bytes -> sgf_utils.py parses them (skipping
non-19x19 and handicap games) -> go_board.py replays moves (captures included) to
reconstruct the true board at each sampled ply -> this module subsamples up to
`max_positions_per_game` positions per game and writes them to shard files under
`data/processed/<split>/`.

Storage is compact on purpose (this is the "cache" the spec asks for, so re-running
training never has to re-parse 7z/SGF): each sample is 2 uint8 stone planes + a few
small ints, not the full float32 [6,19,19] tensor -- decode_sample_to_tensor()
reconstructs that lazily at train time. Games are assigned to train/val/test *before*
sampling positions from them, so no game's positions straddle a split boundary.
"""

import argparse
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, List, Optional, Tuple

import torch
import yaml

from src.adapters.game_adapter import BOARD_SIZE, Board, Player, Position, move_to_label
from src.dataset import iter_rank_sgf_bytes
from src.go_board import apply_move, empty_board
from src.sgf_utils import ParsedGame, parse_sgf_game

NUM_RECENT_MOVES = 3
NONE_MOVE_SENTINEL = -1
SPLIT_NAMES = ("train", "val", "test")


@dataclass
class RawSample:
    board: Board
    current_player: Player
    recent_moves: List[Optional[Position]]  # most-recent-first, len == NUM_RECENT_MOVES
    label: int


def _split_for_game(game_index: int) -> str:
    """~90/5/5 split by game index, deterministic so re-running preprocessing is
    reproducible. Splitting per-game (not per-position) avoids leaking near-duplicate
    positions from the same game across train/val/test."""
    bucket = game_index % 20
    if bucket == 0:
        return "val"
    if bucket == 1:
        return "test"
    return "train"


def _sample_indices(total: int, max_samples: int) -> List[int]:
    if total <= max_samples:
        return list(range(total))
    if max_samples <= 0:
        return []
    step = total / max_samples
    return sorted({int(i * step) for i in range(max_samples)})


def iter_game_samples(game: ParsedGame, max_positions_per_game: int) -> Iterator[RawSample]:
    """Replays `game` move by move, recording a candidate sample before each ply is
    applied, then yields an evenly-spaced subset capped at max_positions_per_game --
    plus, unconditionally, every position whose true label is an actual pass.

    Passes would be heavily concentrated in the last 1-2 plies of a game, and
    evenly-spaced subsampling systematically favors the bulk of a game over its tail (for
    a typical ~250-move game capped at 60 samples, the last selected index lands several
    plies before the true end) -- so without this, a game could contain a real pass and
    still never contribute it as a training example. In practice this dataset's SGF
    records never encode a pass at all (see Fase X notes: the exporting Go server stops
    the move list at the last stone placed and records the result as metadata instead,
    across every rank checked, dan and kyu alike) -- so this is currently a no-op, but a
    correct and essentially free one, kept in case a future data source does the honest
    thing and includes them.
    """
    board = empty_board(game.board_size)
    recent: List[Optional[Position]] = []  # most-recent-first
    candidates: List[RawSample] = []
    pass_label = game.board_size * game.board_size

    for player, move in game.moves:
        candidates.append(
            RawSample(
                board=board,
                current_player=player,
                recent_moves=(recent + [None, None, None])[:NUM_RECENT_MOVES],
                label=move_to_label(move, game.board_size),
            )
        )
        board = apply_move(board, game.board_size, player, move)
        recent = [move] + recent[: NUM_RECENT_MOVES - 1]

    indices = set(_sample_indices(len(candidates), max_positions_per_game))
    indices.update(i for i, c in enumerate(candidates) if c.label == pass_label)

    for i in sorted(indices):
        yield candidates[i]


def iter_selected_games(
    raw_game_bytes: Iterator[bytes],
    max_games: int,
    board_size: int = BOARD_SIZE,
    game_filter: Optional[Callable[[ParsedGame], bool]] = None,
    scanned_log_every: Optional[int] = None,
) -> Iterator[Tuple[int, ParsedGame]]:
    """Streams (game_index, ParsedGame) parsed out of `raw_game_bytes`, stopping once
    `max_games` successfully-parsed (and, if `game_filter` is given, filter-passing)
    games have been yielded in total. `raw_game_bytes` is caller-supplied so this works
    for any source -- the Fox per-rank archives (see _iter_fox_rank_bytes below) or a
    pre-downloaded, differently-organized dump (e.g. the OGS archive).

    `scanned_log_every`, if given, logs progress by *raw items scanned* rather than
    games kept -- for the Fox archives, already pre-sorted into one rank each, nearly
    every file qualifies, so logging by games kept (see run_preprocessing) tracks real
    progress fine. A mixed, unsorted, all-skill-levels dump like OGS can have a qualify
    rate under 1 in 1000 once filtered by rank, where logging only by games kept would
    stay silent for a very long time even while genuinely making steady progress."""
    game_index = 0
    scanned = 0
    for raw in raw_game_bytes:
        if game_index >= max_games:
            return
        scanned += 1
        if scanned_log_every and scanned % scanned_log_every == 0:
            print(f"  ... {scanned} archivos escaneados, {game_index} partidas validas encontradas", flush=True)
        game = parse_sgf_game(raw, target_board_size=board_size)
        if game is None or len(game.moves) == 0:
            continue
        if game_filter is not None and not game_filter(game):
            continue
        yield game_index, game
        game_index += 1


def _iter_fox_rank_bytes(ranks: List[str], data_dir: Path) -> Iterator[bytes]:
    """Byte source for the original Fox-go-server archives, one rank folder at a time."""
    for rank in ranks:
        yield from iter_rank_sgf_bytes(rank, data_dir)


def _sample_to_record(sample: RawSample, board_size: int) -> dict:
    black = torch.zeros((board_size, board_size), dtype=torch.uint8)
    white = torch.zeros((board_size, board_size), dtype=torch.uint8)
    for row in range(board_size):
        board_row = sample.board[row]
        for col in range(board_size):
            stone = board_row[col]
            if stone == "black":
                black[row, col] = 1
            elif stone == "white":
                white[row, col] = 1

    recent = torch.full((NUM_RECENT_MOVES,), NONE_MOVE_SENTINEL, dtype=torch.int16)
    for i, move in enumerate(sample.recent_moves):
        if move is not None:
            recent[i] = move_to_label(move, board_size)

    return {
        "black": black,
        "white": white,
        "player": torch.tensor(1 if sample.current_player == "black" else 0, dtype=torch.uint8),
        "recent": recent,
        "label": torch.tensor(sample.label, dtype=torch.int16),
    }


class ShardWriter:
    """Buffers records for one split and flushes a shard file every `shard_size`
    samples (plus a final partial shard on close())."""

    def __init__(self, out_dir: Path, split: str, shard_size: int, board_size: int = BOARD_SIZE):
        self.dir = out_dir / split
        self.dir.mkdir(parents=True, exist_ok=True)
        self.shard_size = shard_size
        self.board_size = board_size
        self._buffer: List[dict] = []
        self._shard_index = self._next_shard_index()
        self.total_written = 0

    def _next_shard_index(self) -> int:
        existing = sorted(self.dir.glob("shard_*.pt"))
        if not existing:
            return 0
        last = existing[-1].stem.split("_")[-1]
        return int(last) + 1

    def add(self, sample: RawSample) -> None:
        self._buffer.append(_sample_to_record(sample, self.board_size))
        if len(self._buffer) >= self.shard_size:
            self._flush()

    def _flush(self) -> None:
        if not self._buffer:
            return
        shard = {
            "black": torch.stack([r["black"] for r in self._buffer]),
            "white": torch.stack([r["white"] for r in self._buffer]),
            "player": torch.stack([r["player"] for r in self._buffer]),
            "recent": torch.stack([r["recent"] for r in self._buffer]),
            "label": torch.stack([r["label"] for r in self._buffer]),
            "board_size": self.board_size,
        }
        path = self.dir / f"shard_{self._shard_index:05d}.pt"
        torch.save(shard, path)
        self.total_written += len(self._buffer)
        self._shard_index += 1
        self._buffer = []

    def close(self) -> None:
        self._flush()


def decode_sample_to_tensor(shard: dict, i: int) -> Tuple[torch.Tensor, int]:
    """Reconstructs the full float32 [6, board_size, board_size] input tensor (same
    layout as adapters.game_adapter.encode_position) for sample `i` in a loaded shard,
    plus its label."""
    board_size = shard["board_size"]
    pass_label = board_size * board_size
    tensor = torch.zeros((6, board_size, board_size), dtype=torch.float32)
    tensor[0] = shard["black"][i].float()
    tensor[1] = shard["white"][i].float()
    if bool(shard["player"][i]):
        tensor[2].fill_(1.0)
    for c in range(NUM_RECENT_MOVES):
        label = int(shard["recent"][i, c])
        if label != NONE_MOVE_SENTINEL and label != pass_label:
            row, col = divmod(label, board_size)
            tensor[3 + c, row, col] = 1.0
    return tensor, int(shard["label"][i])


def run_preprocessing(
    raw_game_bytes: Iterator[bytes],
    out_dir: Path,
    max_games: int,
    max_positions_per_game: int,
    board_size: int = BOARD_SIZE,
    game_filter: Optional[Callable[[ParsedGame], bool]] = None,
    shard_size: int = 2000,
    log_every: int = 2000,
    scanned_log_every: Optional[int] = None,
) -> dict:
    """Runs the full pipeline and returns per-split sample counts."""
    writers = {split: ShardWriter(out_dir, split, shard_size, board_size=board_size) for split in SPLIT_NAMES}
    games_processed = 0
    start = time.time()
    try:
        for game_index, game in iter_selected_games(
            raw_game_bytes, max_games, board_size, game_filter, scanned_log_every
        ):
            split = _split_for_game(game_index)
            for sample in iter_game_samples(game, max_positions_per_game):
                writers[split].add(sample)
            games_processed += 1
            if log_every and games_processed % log_every == 0:
                elapsed = time.time() - start
                print(
                    f"  ... {games_processed}/{max_games} partidas procesadas "
                    f"({elapsed:.0f}s transcurridos)",
                    flush=True,
                )
    finally:
        for writer in writers.values():
            writer.close()

    return {
        "games_processed": games_processed,
        **{f"{split}_samples": writers[split].total_written for split in SPLIT_NAMES},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path(__file__).resolve().parent.parent / "config.yaml")
    parser.add_argument("--data-dir", type=Path, default=None)
    parser.add_argument("--out-dir", type=Path, default=None)
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    dataset_cfg = config["dataset"]
    board_size = dataset_cfg.get("board_size", BOARD_SIZE)

    service_root = args.config.resolve().parent
    data_dir = args.data_dir or (service_root / "data")
    out_dir = args.out_dir or (data_dir / "processed")

    print(
        f"Preprocesando ranks={dataset_cfg['ranks']} max_games={dataset_cfg['max_games']} "
        f"board_size={board_size} max_positions_per_game={dataset_cfg['max_positions_per_game']}",
        flush=True,
    )
    stats = run_preprocessing(
        raw_game_bytes=_iter_fox_rank_bytes(dataset_cfg["ranks"], data_dir),
        out_dir=out_dir,
        max_games=dataset_cfg["max_games"],
        board_size=board_size,
        max_positions_per_game=dataset_cfg["max_positions_per_game"],
    )
    print(stats)


if __name__ == "__main__":
    main()
