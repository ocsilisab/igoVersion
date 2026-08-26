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
    decode_sample_with_value,
    iter_game_samples,
    iter_selected_games,
    run_preprocessing,
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


def test_iter_game_samples_recognizes_a_pass_on_a_non_19x19_board():
    # Regression check: this used to compare against the 19x19 PASS_LABEL constant
    # (361) unconditionally, so a smaller board's own pass label (e.g. 81 for 9x9) was
    # never recognized as "a pass" by the "always keep pass positions" logic at all.
    moves = [("black" if i % 2 == 0 else "white", (i % 9, 0)) for i in range(30)]
    moves.append(("black" if len(moves) % 2 == 0 else "white", None))
    game = ParsedGame(board_size=9, moves=moves)

    samples = list(iter_game_samples(game, max_positions_per_game=5))
    assert any(s.label == 9 * 9 for s in samples)


def _sgf(board_size: int, move_letter: str = "ee") -> bytes:
    return f"(;GM[1]FF[4]SZ[{board_size}];B[{move_letter}])".encode()


def test_iter_selected_games_stops_at_max_games():
    raw_games = [_sgf(19) for _ in range(10)]
    games = list(iter_selected_games(iter(raw_games), max_games=3))
    assert [i for i, _ in games] == [0, 1, 2]


def test_iter_selected_games_applies_the_game_filter():
    raw_games = [_sgf(19, "aa"), _sgf(19, "bb"), _sgf(19, "cc")]
    kept = list(iter_selected_games(iter(raw_games), max_games=10, game_filter=lambda g: g.moves[0][1] != (1, 1)))
    assert [g.moves[0][1] for _, g in kept] == [(0, 0), (2, 2)]  # "bb" -> (1,1) filtered out


def test_iter_selected_games_respects_board_size():
    raw_games = [_sgf(19), _sgf(9), _sgf(19)]
    games = list(iter_selected_games(iter(raw_games), max_games=10, board_size=9))
    assert len(games) == 1
    assert games[0][1].board_size == 9


def test_iter_selected_games_scanned_log_every_reports_progress(capsys):
    raw_games = [_sgf(19) for _ in range(5)]
    list(iter_selected_games(iter(raw_games), max_games=10, scanned_log_every=2))
    out = capsys.readouterr().out
    assert out.count("archivos escaneados") == 2  # fires at scanned == 2 and scanned == 4


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


def test_decode_sample_to_tensor_handles_a_pass_in_recent_moves_on_a_smaller_board(tmp_path: Path):
    # Regression check: this used to compare a shard's "recent move" label against the
    # fixed 19x19 PASS_LABEL (361). On a 9x9 shard a real pass is labeled 81, which
    # doesn't equal 361 -- so this was mistaken for a real board position and decoded via
    # divmod(81, 9) = (9, 0), an out-of-bounds row on a 9x9 board (valid rows are 0-8),
    # crashing with an index error instead of correctly leaving that channel empty.
    board_size = 9
    board = empty_board(board_size)
    sample = RawSample(
        board=board,
        current_player="black",
        recent_moves=[None, (3, 3), None],  # most-recent-first: a pass, then a real move
        label=board_size * board_size,  # this ply is also a pass
    )

    writer = ShardWriter(tmp_path, "train", shard_size=5, board_size=board_size)
    writer.add(sample)
    writer.close()

    shard = torch.load(tmp_path / "train" / "shard_00000.pt")
    tensor, label = decode_sample_to_tensor(shard, 0)
    assert tensor.shape == (6, board_size, board_size)
    assert label == board_size * board_size
    assert tensor[3].sum() == 0.0  # the pass contributes no marked position
    assert tensor[4, 3, 3] == 1.0  # the real move one ply back still does


def test_iter_game_samples_value_target_flips_by_perspective():
    # Same game, black wins -- the position where black is to move must get +1, and the
    # very next position (white to move, same eventual outcome) must get -1. This is the
    # perspective-of-mover convention the spec calls out explicitly (Paso 5).
    game = ParsedGame(
        board_size=BOARD_SIZE,
        moves=[("black", (0, 0)), ("white", (1, 1)), ("black", (2, 2))],
        winner="black",
    )
    samples = list(iter_game_samples(game, max_positions_per_game=60))
    assert [s.current_player for s in samples] == ["black", "white", "black"]
    assert samples[0].value_target == 1.0  # black to move, black wins
    assert samples[1].value_target == -1.0  # white to move, black (the other side) wins
    assert samples[2].value_target == 1.0  # black to move again, black wins


def test_iter_game_samples_value_target_flips_the_other_way_when_white_wins():
    game = ParsedGame(
        board_size=BOARD_SIZE,
        moves=[("black", (0, 0)), ("white", (1, 1))],
        winner="white",
    )
    samples = list(iter_game_samples(game, max_positions_per_game=60))
    assert samples[0].value_target == -1.0  # black to move, white wins
    assert samples[1].value_target == 1.0  # white to move, white wins


def test_iter_game_samples_value_target_none_without_a_determinate_winner():
    game = ParsedGame(board_size=BOARD_SIZE, moves=[("black", (0, 0)), ("white", (1, 1))])
    samples = list(iter_game_samples(game, max_positions_per_game=60))
    assert all(s.value_target is None for s in samples)


def test_decode_sample_with_value_roundtrip(tmp_path: Path):
    board = empty_board(BOARD_SIZE)
    sample = RawSample(
        board=board,
        current_player="black",
        recent_moves=[None, None, None],
        label=move_to_label((7, 7), BOARD_SIZE),
        value_target=1.0,
    )
    writer = ShardWriter(tmp_path, "train", shard_size=5)
    writer.add(sample)
    writer.close()

    shard = torch.load(tmp_path / "train" / "shard_00000.pt")
    tensor, label, value = decode_sample_with_value(shard, 0)
    assert label == sample.label
    assert value == 1.0
    assert tensor.shape == (6, BOARD_SIZE, BOARD_SIZE)


def test_decode_sample_with_value_is_nan_when_target_is_none(tmp_path: Path):
    board = empty_board(BOARD_SIZE)
    sample = RawSample(
        board=board, current_player="black", recent_moves=[None, None, None], label=0, value_target=None
    )
    writer = ShardWriter(tmp_path, "train", shard_size=5)
    writer.add(sample)
    writer.close()

    shard = torch.load(tmp_path / "train" / "shard_00000.pt")
    _, _, value = decode_sample_with_value(shard, 0)
    assert value != value  # NaN != NaN


def test_decode_sample_with_value_is_nan_for_a_shard_written_before_value_existed(tmp_path: Path):
    # Simulates one of the ~15GB of already-on-disk shards from before the Value Head:
    # no "value" key in the dict at all -- must not raise.
    board = empty_board(BOARD_SIZE)
    sample = RawSample(board=board, current_player="black", recent_moves=[None, None, None], label=0)
    writer = ShardWriter(tmp_path, "train", shard_size=5)
    writer.add(sample)
    writer.close()

    shard = torch.load(tmp_path / "train" / "shard_00000.pt")
    del shard["value"]
    _, _, value = decode_sample_with_value(shard, 0)
    assert value != value  # NaN != NaN


def test_run_preprocessing_require_winner_drops_indeterminate_games(tmp_path: Path):
    raw_games = [
        b"(;GM[1]FF[4]SZ[19]RE[B+3.5];B[aa];W[bb])",  # determinate
        b"(;GM[1]FF[4]SZ[19];B[cc];W[dd])",  # no RE at all -> excluded
        b"(;GM[1]FF[4]SZ[19]RE[?];B[ee];W[ff])",  # unreliable -> excluded
    ]
    stats = run_preprocessing(
        raw_game_bytes=iter(raw_games),
        out_dir=tmp_path,
        max_games=10,
        max_positions_per_game=60,
        require_winner=True,
    )
    assert stats["games_processed"] == 1


def test_run_preprocessing_without_require_winner_keeps_all_games(tmp_path: Path):
    raw_games = [
        b"(;GM[1]FF[4]SZ[19]RE[B+3.5];B[aa];W[bb])",
        b"(;GM[1]FF[4]SZ[19];B[cc];W[dd])",
    ]
    stats = run_preprocessing(
        raw_game_bytes=iter(raw_games), out_dir=tmp_path, max_games=10, max_positions_per_game=60
    )
    assert stats["games_processed"] == 2


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
