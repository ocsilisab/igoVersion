from pathlib import Path

import torch

from src.adapters.game_adapter import BOARD_SIZE, PASS_LABEL, GameStateInput, encode_position, move_to_label
from src.go_board import empty_board
from src.preprocessing import (
    RawSample,
    ShardWriter,
    _sample_indices,
    _split_for_game,
    decode_sample_to_tensor,
    iter_game_samples,
)
from src.sgf_utils import ParsedGame


def test_sample_indices_keeps_everything_when_under_cap():
    assert _sample_indices(5, 60) == [0, 1, 2, 3, 4]


def test_sample_indices_evenly_spaced_and_capped():
    indices = _sample_indices(200, 10)
    assert len(indices) == 10
    assert indices[0] == 0
    assert indices == sorted(indices)
    assert len(set(indices)) == 10


def test_sample_indices_zero_cap_returns_empty():
    assert _sample_indices(50, 0) == []


def test_split_for_game_is_deterministic_and_mostly_train():
    splits = [_split_for_game(i) for i in range(40)]
    assert splits.count("val") == 2
    assert splits.count("test") == 2
    assert splits.count("train") == 36


def test_iter_game_samples_recent_moves_and_labels():
    game = ParsedGame(
        board_size=BOARD_SIZE,
        moves=[
            ("black", (0, 0)),
            ("white", (18, 18)),
            ("black", (5, 5)),
        ],
    )
    samples = list(iter_game_samples(game, max_positions_per_game=60))
    assert len(samples) == 3

    assert samples[0].recent_moves == [None, None, None]
    assert samples[0].label == move_to_label((0, 0), BOARD_SIZE)
    assert samples[0].current_player == "black"
    assert samples[0].board == empty_board(BOARD_SIZE)  # nothing played yet

    assert samples[1].recent_moves == [(0, 0), None, None]
    assert samples[1].label == move_to_label((18, 18), BOARD_SIZE)
    assert samples[1].board[0][0] == "black"  # black's move is now on the board

    assert samples[2].recent_moves == [(18, 18), (0, 0), None]
    assert samples[2].label == move_to_label((5, 5), BOARD_SIZE)


def test_iter_game_samples_respects_cap_via_even_subsampling():
    game = ParsedGame(
        board_size=BOARD_SIZE,
        moves=[("black" if i % 2 == 0 else "white", (i % 19, 0)) for i in range(50)],
    )
    samples = list(iter_game_samples(game, max_positions_per_game=10))
    assert len(samples) == 10


def test_iter_game_samples_always_includes_trailing_pass_even_if_undersampled():
    # 50 real moves, evenly-spaced sampling capped at 10 would only look at every ~5th
    # ply and never reach all the way to the very last one -- but the game's final ply is
    # a pass, and that position must still show up as a training sample regardless.
    moves = [("black" if i % 2 == 0 else "white", (i % 19, 0)) for i in range(50)]
    moves.append(("black" if len(moves) % 2 == 0 else "white", None))
    game = ParsedGame(board_size=BOARD_SIZE, moves=moves)

    samples = list(iter_game_samples(game, max_positions_per_game=10))
    assert any(s.label == PASS_LABEL for s in samples)
    assert len(samples) == 11  # the 10 evenly-spaced samples, plus the pass position


def test_iter_game_samples_does_not_duplicate_pass_already_in_even_sample():
    # A short game where the pass naturally falls within the evenly-spaced sample already
    # -- it must not be double-counted.
    game = ParsedGame(board_size=BOARD_SIZE, moves=[("black", (0, 0)), ("white", None)])
    samples = list(iter_game_samples(game, max_positions_per_game=60))
    assert len(samples) == 2
    assert samples[1].label == PASS_LABEL


def test_decode_sample_to_tensor_matches_direct_encode_position(tmp_path: Path):
    board = empty_board(BOARD_SIZE)
    board[3][4] = "black"
    board[10][10] = "white"
    sample = RawSample(
        board=board,
        current_player="white",
        recent_moves=[(3, 4), (10, 10), None],
        label=move_to_label((7, 7), BOARD_SIZE),
    )

    writer = ShardWriter(tmp_path, "train", shard_size=5)
    writer.add(sample)
    writer.close()

    shard_path = tmp_path / "train" / "shard_00000.pt"
    assert shard_path.exists()
    shard = torch.load(shard_path)
    assert shard["black"].shape == (1, BOARD_SIZE, BOARD_SIZE)

    tensor, label = decode_sample_to_tensor(shard, 0)
    assert label == sample.label

    expected = encode_position(
        GameStateInput(
            board=board,
            board_size=BOARD_SIZE,
            current_player="white",
            recent_moves=[(3, 4), (10, 10), None],
        )
    )
    assert torch.equal(tensor, expected)


def test_shard_writer_flushes_multiple_shards(tmp_path: Path):
    board = empty_board(BOARD_SIZE)
    writer = ShardWriter(tmp_path, "train", shard_size=3)
    for i in range(7):
        writer.add(
            RawSample(board=board, current_player="black", recent_moves=[None, None, None], label=i)
        )
    writer.close()

    shard_files = sorted((tmp_path / "train").glob("shard_*.pt"))
    assert len(shard_files) == 3  # 3 + 3 + 1
    assert writer.total_written == 7
    sizes = [torch.load(f)["label"].shape[0] for f in shard_files]
    assert sizes == [3, 3, 1]
