import torch

from src.adapters.game_adapter import BOARD_SIZE, PASS_LABEL, move_to_label
from src.evaluate import evaluate_dataset, format_move, render_board, topk_correct
from src.model import PolicyNetwork


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
