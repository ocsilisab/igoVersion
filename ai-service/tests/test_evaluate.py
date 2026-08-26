from pathlib import Path

import torch

from src.adapters.game_adapter import BOARD_SIZE, PASS_LABEL, move_to_label
from src.evaluate import (
    _policy_logits,
    evaluate_dataset,
    evaluate_pass_subset,
    evaluate_value,
    format_move,
    render_board,
    show_value_examples,
    topk_correct,
)
from src.go_board import empty_board
from src.model import PolicyNetwork, PolicyValueNetwork
from src.preprocessing import RawSample, ShardWriter
from src.train_policy_value import ValueShardDataset


def test_topk_correct_top1_hit():
    logits = torch.tensor([[0.1, 0.9, 0.0]])
    labels = torch.tensor([1])
    assert topk_correct(logits, labels, k=1) == 1


def test_topk_correct_top1_miss_but_top3_hit():
    logits = torch.tensor([[0.9, 0.1, 0.2]])  # true label ranked 3rd (index 2 has score 0.2 < 0.9 but > 0.1)
    labels = torch.tensor([2])
    assert topk_correct(logits, labels, k=1) == 0
    assert topk_correct(logits, labels, k=3) == 1


def test_topk_correct_counts_across_batch():
    logits = torch.tensor(
        [
            [0.9, 0.1],  # label 0 -> top1 hit
            [0.1, 0.9],  # label 0 -> top1 miss
        ]
    )
    labels = torch.tensor([0, 0])
    assert topk_correct(logits, labels, k=1) == 1
    assert topk_correct(logits, labels, k=2) == 2


def test_format_move_pass():
    assert format_move(PASS_LABEL, BOARD_SIZE) == "PASE"


def test_format_move_corner_uses_go_notation():
    # (row=0, col=0) is the top-left corner -- app row 0 = top, so rank = board_size - row.
    label = move_to_label((0, 0), BOARD_SIZE)
    assert format_move(label, BOARD_SIZE) == "A19"


def test_format_move_skips_letter_i():
    # column index 8 is the 9th column; Go notation skips "I", so it should be "J".
    label = move_to_label((0, 8), BOARD_SIZE)
    assert format_move(label, BOARD_SIZE) == "J19"


def test_render_board_shows_stones_and_header():
    black = torch.zeros((BOARD_SIZE, BOARD_SIZE), dtype=torch.uint8)
    white = torch.zeros((BOARD_SIZE, BOARD_SIZE), dtype=torch.uint8)
    black[0, 0] = 1
    white[18, 18] = 1
    text = render_board(black, white, BOARD_SIZE)
    lines = text.splitlines()
    assert lines[0].startswith("   A B C")
    assert lines[1].startswith("19 X")  # top row is rank 19
    assert lines[-1].rstrip().endswith("O")  # bottom row, last column


def test_evaluate_dataset_end_to_end_with_tiny_model():
    model = PolicyNetwork(board_size=BOARD_SIZE, residual_channels=4, residual_blocks=1)
    model.eval()

    class TinyDataset(torch.utils.data.Dataset):
        def __len__(self):
            return 4

        def __getitem__(self, i):
            from src.adapters.game_adapter import NUM_CHANNELS

            board = torch.zeros((NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE))
            return board, i % 3

    loader = torch.utils.data.DataLoader(TinyDataset(), batch_size=2)
    device = torch.device("cpu")
    metrics = evaluate_dataset(model, loader, device, ks=(1, 3))
    assert metrics["count"] == 4
    assert 0.0 <= metrics["top1_accuracy"] <= 1.0
    assert metrics["top1_accuracy"] <= metrics["top3_accuracy"]
    assert metrics["loss"] > 0


def test_evaluate_pass_subset_finds_a_pass_on_a_non_19x19_board(tmp_path: Path):
    # Regression check: evaluate_pass_subset used to filter test shards by the fixed
    # 19x19 PASS_LABEL (361) regardless of the shards' own board_size, so on a 9x9
    # checkpoint's test set (where a pass is labeled 81) it silently found zero pass
    # positions instead of raising or measuring anything.
    board_size = 9
    board = empty_board(board_size)
    sample = RawSample(
        board=board, current_player="black", recent_moves=[None, None, None], label=board_size * board_size
    )
    writer = ShardWriter(tmp_path, "test", shard_size=5, board_size=board_size)
    writer.add(sample)
    writer.close()

    model = PolicyNetwork(board_size=board_size, residual_channels=4, residual_blocks=1)
    model.eval()
    device = torch.device("cpu")

    metrics = evaluate_pass_subset(model, tmp_path, device, board_size=board_size, ks=(1,))
    assert metrics["count"] == 1


def test_policy_logits_unwraps_a_policy_value_tuple():
    model = PolicyValueNetwork(board_size=BOARD_SIZE, residual_channels=4, residual_blocks=1)
    model.eval()
    from src.adapters.game_adapter import NUM_CHANNELS

    x = torch.zeros((2, NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE))
    logits = _policy_logits(model, x)
    assert logits.shape == (2, BOARD_SIZE * BOARD_SIZE + 1)


def test_policy_logits_passes_through_a_plain_policy_network():
    model = PolicyNetwork(board_size=BOARD_SIZE, residual_channels=4, residual_blocks=1)
    model.eval()
    from src.adapters.game_adapter import NUM_CHANNELS

    x = torch.zeros((2, NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE))
    logits = _policy_logits(model, x)
    assert torch.equal(logits, model(x))


def test_evaluate_value_end_to_end_with_tiny_model(tmp_path: Path):
    board_size = 9
    board = empty_board(board_size)
    writer = ShardWriter(tmp_path, "test", shard_size=10, board_size=board_size)
    for i in range(8):
        writer.add(
            RawSample(
                board=board,
                current_player="black" if i % 2 == 0 else "white",
                recent_moves=[None, None, None],
                label=0,
                value_target=1.0 if i % 2 == 0 else -1.0,
            )
        )
    writer.close()

    model = PolicyValueNetwork(board_size=board_size, residual_channels=4, residual_blocks=1)
    model.eval()
    ds = ValueShardDataset(tmp_path / "test", augment=False)
    loader = torch.utils.data.DataLoader(ds, batch_size=4)
    device = torch.device("cpu")

    metrics = evaluate_value(model, loader, device)
    assert metrics["count"] == 8
    assert metrics["mse"] >= 0
    assert 0.0 <= metrics["winner_accuracy"] <= 1.0
    assert -1.0 <= metrics["mean_prediction"] <= 1.0


def test_show_value_examples_runs_without_error_and_prints_real_and_predicted(tmp_path: Path, capsys):
    board_size = 9
    board = empty_board(board_size)
    writer = ShardWriter(tmp_path, "test", shard_size=10, board_size=board_size)
    writer.add(
        RawSample(board=board, current_player="black", recent_moves=[None, None, None], label=0, value_target=1.0)
    )
    writer.close()

    model = PolicyValueNetwork(board_size=board_size, residual_channels=4, residual_blocks=1)
    model.eval()
    show_value_examples(model, tmp_path, torch.device("cpu"), num_examples=1)

    out = capsys.readouterr().out
    assert "Valor real" in out
    assert "Prediccion" in out
