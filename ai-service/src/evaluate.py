"""Evaluates a trained checkpoint on the held-out test split: overall loss and
top-1/top-3/top-5 accuracy, plus a handful of real positions rendered as text boards
with the model's top-3 predicted moves next to the move the professional actually
played -- so accuracy numbers aren't the only thing you have to trust.

Usage:
    python -m src.evaluate --config config.yaml --checkpoint checkpoints/best.pt
"""

import argparse
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

import torch
import torch.nn as nn
import yaml
from torch.utils.data import DataLoader

from src.adapters.game_adapter import BOARD_SIZE, label_to_move
from src.model import load_model_from_checkpoint
from src.preprocessing import decode_sample_to_tensor
from src.train import ShardDataset

GO_COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRST"  # skips "I", standard Go board notation


def topk_correct(logits: torch.Tensor, labels: torch.Tensor, k: int) -> int:
    top_indices = logits.topk(k, dim=1).indices
    return (top_indices == labels.unsqueeze(1)).any(dim=1).sum().item()


def evaluate_dataset(
    model: nn.Module, loader: DataLoader, device: torch.device, ks: Sequence[int] = (1, 3, 5)
) -> Dict[str, float]:
    model.eval()
    criterion = nn.CrossEntropyLoss(reduction="sum")
    total_loss = 0.0
    total_count = 0
    correct = {k: 0 for k in ks}

    with torch.no_grad():
        for boards, labels in loader:
            boards = boards.to(device, non_blocking=True)
            labels = labels.to(device, non_blocking=True).long()
            logits = model(boards)
            total_loss += criterion(logits, labels).item()
            total_count += labels.shape[0]
            for k in ks:
                correct[k] += topk_correct(logits, labels, k)

    return {
        "loss": total_loss / max(total_count, 1),
        "count": total_count,
        **{f"top{k}_accuracy": correct[k] / max(total_count, 1) for k in ks},
    }


def evaluate_pass_subset(
    model: nn.Module, processed_dir: Path, device: torch.device, board_size: int = BOARD_SIZE,
    ks: Sequence[int] = (1, 3, 5)
) -> Dict[str, float]:
    """Same top-k accuracy as evaluate_dataset, but restricted to test positions whose
    true label is actually a pass. The overall test accuracy above is dominated by
    the board-move labels; passing is a single label among them, so it needs its own
    number to see whether the retraining pass (adding synthetic pass moves for
    real-scored games -- see sgf_utils.py::_ends_by_real_score) actually worked, rather
    than being invisible in an aggregate that barely samples it either way.

    `board_size` must match the shards in `processed_dir` -- the pass label is
    board_size^2, not the fixed 19x19 value, so a 9x9 evaluation run needs its own 81
    rather than defaulting to 361 and silently finding zero pass positions."""
    model.eval()
    pass_label = board_size * board_size
    correct = {k: 0 for k in ks}
    total = 0
    total_pass_probability = 0.0  # softmax mass on "pass", summed, for computing an average

    shard_paths = sorted((processed_dir / "test").glob("shard_*.pt"))
    with torch.no_grad():
        for shard_path in shard_paths:
            shard = torch.load(shard_path, weights_only=True)
            labels = shard["label"]
            pass_indices = (labels == pass_label).nonzero(as_tuple=True)[0].tolist()
            if not pass_indices:
                continue

            tensors = torch.stack([decode_sample_to_tensor(shard, i)[0] for i in pass_indices]).to(device)
            logits = model(tensors)
            probs = torch.softmax(logits, dim=1)
            total_pass_probability += probs[:, pass_label].sum().item()

            batch_labels = torch.full((len(pass_indices),), pass_label, device=device)
            for k in ks:
                correct[k] += topk_correct(logits, batch_labels, k)
            total += len(pass_indices)

    return {
        "count": total,
        "avg_pass_probability": total_pass_probability / max(total, 1),
        **{f"top{k}_accuracy": correct[k] / max(total, 1) for k in ks},
    }


def format_move(label: int, board_size: int) -> str:
    move = label_to_move(label, board_size)
    if move is None:
        return "PASE"
    row, col = move
    return f"{GO_COLUMN_LETTERS[col]}{board_size - row}"  # row 0 = top = highest rank number


def render_board(black: torch.Tensor, white: torch.Tensor, board_size: int) -> str:
    header = "   " + " ".join(GO_COLUMN_LETTERS[:board_size])
    lines = [header]
    for row in range(board_size):
        rank = board_size - row
        cells = []
        for col in range(board_size):
            if black[row, col]:
                cells.append("X")
            elif white[row, col]:
                cells.append("O")
            else:
                cells.append(".")
        lines.append(f"{rank:>2} " + " ".join(cells))
    return "\n".join(lines)


def show_examples(
    model: nn.Module, processed_dir: Path, device: torch.device, num_examples: int, board_size: int
) -> None:
    shard_paths = sorted((processed_dir / "test").glob("shard_*.pt"))
    if not shard_paths:
        print("No hay shards de test disponibles para mostrar ejemplos.")
        return

    shard = torch.load(shard_paths[0], weights_only=True)
    n = shard["label"].shape[0]
    step = max(n // num_examples, 1)

    model.eval()
    with torch.no_grad():
        for count, i in enumerate(range(0, n, step)):
            if count >= num_examples:
                break
            tensor, true_label = decode_sample_to_tensor(shard, i)
            logits = model(tensor.unsqueeze(0).to(device))
            probs = torch.softmax(logits[0], dim=0)
            top3 = torch.topk(probs, 3)

            print(f"\n--- Ejemplo {count + 1} ---")
            print(render_board(shard["black"][i], shard["white"][i], board_size))
            player = "Negras" if bool(shard["player"][i]) else "Blancas"
            print(f"Turno: {player}")
            print(f"Jugada real (profesional): {format_move(true_label, board_size)}")
            print("Predicciones del modelo (top-3):")
            hit_rank = None
            for rank, (prob, label) in enumerate(zip(top3.values.tolist(), top3.indices.tolist()), start=1):
                marker = ""
                if label == true_label:
                    marker = "  <- acierto"
                    hit_rank = rank
                print(f"  {rank}) {format_move(label, board_size)}  ({prob * 100:.1f}%){marker}")
            if hit_rank is None:
                print("  (la jugada real no aparece en el top-3 del modelo)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path(__file__).resolve().parent.parent / "config.yaml")
    parser.add_argument("--checkpoint", type=Path, default=None)
    parser.add_argument("--processed-dir", type=Path, default=None)
    parser.add_argument("--num-workers", type=int, default=4)
    parser.add_argument("--num-examples", type=int, default=5)
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    service_root = args.config.resolve().parent
    processed_dir = args.processed_dir or (service_root / "data" / "processed")
    checkpoint_path = args.checkpoint or (service_root / "checkpoints" / "best.pt")
    board_size = config.get("model", {}).get("board_size", BOARD_SIZE)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_model_from_checkpoint(checkpoint_path, device)
    print(f"Checkpoint cargado: {checkpoint_path} (device={device})")

    test_ds = ShardDataset(processed_dir / "test", augment=False)
    test_loader = DataLoader(
        test_ds, batch_size=config["training"].get("batch_size", 256), num_workers=args.num_workers
    )

    metrics = evaluate_dataset(model, test_loader, device)
    print(
        f"\n=== Test set ({metrics['count']:,} posiciones) ===\n"
        f"loss={metrics['loss']:.4f}  "
        f"top1={metrics['top1_accuracy'] * 100:.2f}%  "
        f"top3={metrics['top3_accuracy'] * 100:.2f}%  "
        f"top5={metrics['top5_accuracy'] * 100:.2f}%"
    )

    pass_metrics = evaluate_pass_subset(model, processed_dir, device, board_size=board_size)
    print(
        f"\n=== Subconjunto 'pase' del test ({pass_metrics['count']:,} posiciones) ===\n"
        f"top1={pass_metrics['top1_accuracy'] * 100:.2f}%  "
        f"top3={pass_metrics['top3_accuracy'] * 100:.2f}%  "
        f"top5={pass_metrics['top5_accuracy'] * 100:.2f}%  "
        f"prob_media_asignada_a_pase={pass_metrics['avg_pass_probability'] * 100:.2f}%"
    )

    show_examples(model, processed_dir, device, args.num_examples, board_size)


if __name__ == "__main__":
    main()
