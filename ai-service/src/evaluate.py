"""Evaluates a trained checkpoint on the held-out test split: overall loss and
top-1/top-3/top-5 accuracy, plus a handful of real positions rendered as text boards
with the model's top-3 predicted moves next to the move the professional actually
played -- so accuracy numbers aren't the only thing you have to trust.

Works with either a Policy-only checkpoint (checkpoints/best.pt, .../best_9x9.pt, ...)
or a Policy+Value one (checkpoints/policy_value/best*.pt, see train_policy_value.py) --
every checkpoint loads through load_policy_value_checkpoint (model.py); the POLICY
section always prints, the VALUE section only when the loaded checkpoint actually has a
trained Value Head (see `value_head_is_pretrained`), so a Policy-only checkpoint's output
is unchanged from before the Value Head existed.

Usage:
    python -m src.evaluate --config config.yaml --model checkpoints/best.pt
    python -m src.evaluate --config config.yaml --model checkpoints/policy_value/best.pt \\
        --value-processed-dir data/processed_value
"""

import argparse
from pathlib import Path
from typing import Dict, List, Sequence

import torch
import torch.nn as nn
import yaml
from torch.utils.data import DataLoader

from src.adapters.game_adapter import BOARD_SIZE, label_to_move
from src.model import PolicyValueNetwork, load_policy_value_checkpoint
from src.preprocessing import decode_sample_to_tensor
from src.train import ShardDataset
from src.train_policy_value import ValueShardDataset

GO_COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRST"  # skips "I", standard Go board notation


def _policy_logits(model: nn.Module, x: torch.Tensor) -> torch.Tensor:
    """Runs `model` and returns just the policy logits, whether `model` is a plain
    PolicyNetwork (forward returns a Tensor already) or a PolicyValueNetwork (forward
    returns (policy_logits, value)) -- lets every function below stay agnostic to which
    one it was handed."""
    out = model(x)
    return out[0] if isinstance(out, tuple) else out


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
            logits = _policy_logits(model, boards)
            total_loss += criterion(logits, labels).item()
            total_count += labels.shape[0]
            for k in ks:
                correct[k] += topk_correct(logits, labels, k)

    return {
        "loss": total_loss / max(total_count, 1),
        "count": total_count,
        **{f"top{k}_accuracy": correct[k] / max(total_count, 1) for k in ks},
    }


def evaluate_value(model: PolicyValueNetwork, loader: DataLoader, device: torch.device) -> Dict[str, float]:
    """Value-specific metrics (Paso 10/11 of the spec): MSE, MAE, correlation between
    prediction and true outcome, and winner-prediction accuracy (sign match) -- plus the
    mean prediction and its spread, so a model that's collapsed to always predicting ~0
    (or always +-1) shows up as a visible red flag rather than a merely-mediocre loss."""
    model.eval()
    total_se = 0.0
    total_count = 0
    preds: List[torch.Tensor] = []
    targets: List[torch.Tensor] = []

    with torch.no_grad():
        for boards, _labels, values in loader:
            boards = boards.to(device, non_blocking=True)
            values = values.to(device, non_blocking=True).float().unsqueeze(1)
            _, value_pred = model(boards)
            total_se += torch.nn.functional.mse_loss(value_pred, values, reduction="sum").item()
            total_count += values.shape[0]
            preds.append(value_pred.detach().float().flatten().cpu())
            targets.append(values.detach().float().flatten().cpu())

    all_preds = torch.cat(preds) if preds else torch.zeros(0)
    all_targets = torch.cat(targets) if targets else torch.zeros(0)
    mae = (all_preds - all_targets).abs().mean().item() if all_preds.numel() else float("nan")
    winner_accuracy = (
        (all_preds.sign() == all_targets.sign()).float().mean().item() if all_preds.numel() else float("nan")
    )
    correlation = (
        torch.corrcoef(torch.stack([all_preds, all_targets]))[0, 1].item() if all_preds.numel() > 1 else float("nan")
    )

    return {
        "count": total_count,
        "mse": total_se / max(total_count, 1),
        "mae": mae,
        "correlation": correlation,
        "winner_accuracy": winner_accuracy,
        "mean_prediction": all_preds.mean().item() if all_preds.numel() else float("nan"),
        "std_prediction": all_preds.std().item() if all_preds.numel() > 1 else float("nan"),
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
            logits = _policy_logits(model, tensors)
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
            logits = _policy_logits(model, tensor.unsqueeze(0).to(device))
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


def show_value_examples(
    model: PolicyValueNetwork, processed_dir: Path, device: torch.device, num_examples: int
) -> None:
    """Prints a handful of (true outcome, predicted value) pairs -- see Paso 10 of the
    spec's example format. Only ever called on a checkpoint with a trained Value Head."""
    shard_paths = sorted((processed_dir / "test").glob("shard_*.pt"))
    if not shard_paths:
        print("No hay shards de test (con value) disponibles para mostrar ejemplos.")
        return

    from src.preprocessing import decode_sample_with_value

    shard = torch.load(shard_paths[0], weights_only=True)
    n = shard["label"].shape[0]
    step = max(n // num_examples, 1)

    model.eval()
    shown = 0
    with torch.no_grad():
        for i in range(0, n, step):
            if shown >= num_examples:
                break
            tensor, _label, true_value = decode_sample_with_value(shard, i)
            if true_value != true_value:  # NaN -- no determinate result for this position
                continue
            _, value_pred = model(tensor.unsqueeze(0).to(device))
            print(f"\n--- Posicion {shown + 1} ---")
            print(f"Valor real:     {true_value:+.2f}")
            print(f"Prediccion:     {value_pred.item():+.2f}")
            shown += 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path(__file__).resolve().parent.parent / "config.yaml")
    parser.add_argument(
        "--model", "--checkpoint", dest="checkpoint", type=Path, default=None,
        help="Policy-only or Policy+Value checkpoint (auto-detected)",
    )
    parser.add_argument("--processed-dir", type=Path, default=None, help="Policy test shards (top-k / pass subset)")
    parser.add_argument(
        "--value-processed-dir", type=Path, default=None,
        help="Value-aware test shards, built with --require-winner (only used if the checkpoint has a trained Value Head)",
    )
    parser.add_argument("--num-workers", type=int, default=4)
    parser.add_argument("--num-examples", type=int, default=5)
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    service_root = args.config.resolve().parent
    processed_dir = args.processed_dir or (service_root / "data" / "processed")
    value_processed_dir = args.value_processed_dir or (service_root / "data" / "processed_value")
    checkpoint_path = args.checkpoint or (service_root / "checkpoints" / "best.pt")
    board_size = config.get("model", {}).get("board_size", BOARD_SIZE)
    batch_size = config["training"].get("batch_size", 256)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model, value_head_is_pretrained = load_policy_value_checkpoint(checkpoint_path, device)
    print(f"Checkpoint cargado: {checkpoint_path} (device={device}, value_head_entrenado={value_head_is_pretrained})")

    print("\n" + "=" * 8 + " POLICY " + "=" * 8)
    test_ds = ShardDataset(processed_dir / "test", augment=False)
    test_loader = DataLoader(test_ds, batch_size=batch_size, num_workers=args.num_workers)

    metrics = evaluate_dataset(model, test_loader, device)
    print(
        f"\nTest set ({metrics['count']:,} posiciones):\n"
        f"loss={metrics['loss']:.4f}  "
        f"top1={metrics['top1_accuracy'] * 100:.2f}%  "
        f"top3={metrics['top3_accuracy'] * 100:.2f}%  "
        f"top5={metrics['top5_accuracy'] * 100:.2f}%"
    )

    pass_metrics = evaluate_pass_subset(model, processed_dir, device, board_size=board_size)
    print(
        f"\nSubconjunto 'pase' del test ({pass_metrics['count']:,} posiciones):\n"
        f"top1={pass_metrics['top1_accuracy'] * 100:.2f}%  "
        f"top3={pass_metrics['top3_accuracy'] * 100:.2f}%  "
        f"top5={pass_metrics['top5_accuracy'] * 100:.2f}%  "
        f"prob_media_asignada_a_pase={pass_metrics['avg_pass_probability'] * 100:.2f}%"
    )

    show_examples(model, processed_dir, device, args.num_examples, board_size)

    if not value_head_is_pretrained:
        print("\n(Checkpoint sin Value Head entrenado -- se omite la seccion VALUE.)")
        return

    print("\n" + "=" * 8 + " VALUE " + "=" * 8)
    value_test_ds = ValueShardDataset(value_processed_dir / "test", augment=False)
    value_test_loader = DataLoader(value_test_ds, batch_size=batch_size, num_workers=args.num_workers)

    value_metrics = evaluate_value(model, value_test_loader, device)
    print(
        f"\nTest set ({value_metrics['count']:,} posiciones):\n"
        f"Value Loss (MSE)={value_metrics['mse']:.4f}  MAE={value_metrics['mae']:.4f}  "
        f"Correlacion={value_metrics['correlation']:.4f}\n"
        f"Winner Accuracy={value_metrics['winner_accuracy'] * 100:.2f}%  "
        f"Prediccion media={value_metrics['mean_prediction']:+.3f} "
        f"(desviacion={value_metrics['std_prediction']:.3f})"
    )
    if abs(value_metrics["std_prediction"]) < 0.05:
        print(
            "AVISO: la desviacion de las predicciones es casi nula -- "
            "el modelo podria haber colapsado a predecir siempre un valor casi constante."
        )

    show_value_examples(model, value_processed_dir, device, args.num_examples)


if __name__ == "__main__":
    main()
