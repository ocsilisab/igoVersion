"""Trains the PolicyNetwork on preprocessed shards (see preprocessing.py).

Usage:
    python -m src.train --config config.yaml
    python -m src.train --config config.yaml --epochs 2 --max-train-shards 3  # smoke run
"""

import argparse
import random
import time
from pathlib import Path
from typing import Iterator, List, Optional, Tuple

import torch
import torch.nn as nn
import yaml
from torch.utils.data import DataLoader, IterableDataset, get_worker_info

from src.augmentation import NUM_TRANSFORMS, transform_label, transform_tensor
from src.model import PolicyNetwork, count_parameters
from src.preprocessing import decode_sample_to_tensor


class ShardDataset(IterableDataset):
    """Streams samples out of shard_*.pt files, one shard resident in memory at a
    time (see preprocessing.py's shard format). Applies a random one-of-8 symmetry
    per sample when `augment=True` -- see augmentation.py."""

    def __init__(self, shard_dir: Path, augment: bool, max_shards: Optional[int] = None):
        self.shard_paths = sorted(shard_dir.glob("shard_*.pt"))
        if max_shards is not None:
            self.shard_paths = self.shard_paths[:max_shards]
        if not self.shard_paths:
            raise FileNotFoundError(f"No se encontraron shards en {shard_dir}")
        self.augment = augment

    def _shards_for_this_worker(self) -> List[Path]:
        worker_info = get_worker_info()
        if worker_info is None:
            return self.shard_paths
        return self.shard_paths[worker_info.id :: worker_info.num_workers]

    def __iter__(self) -> Iterator[Tuple[torch.Tensor, int]]:
        shard_paths = list(self._shards_for_this_worker())
        random.shuffle(shard_paths)
        for shard_path in shard_paths:
            shard = torch.load(shard_path, weights_only=True)
            n = shard["label"].shape[0]
            order = list(range(n))
            random.shuffle(order)
            for i in order:
                tensor, label = decode_sample_to_tensor(shard, i)
                if self.augment:
                    t = random.randrange(NUM_TRANSFORMS)
                    tensor = transform_tensor(tensor, t)
                    label = transform_label(label, shard["board_size"], t)
                yield tensor, label


def load_config(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def run_epoch(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
    criterion: nn.Module,
    optimizer: Optional[torch.optim.Optimizer],
    scaler: Optional[torch.amp.GradScaler],
    mixed_precision: bool,
    log_every_seconds: float = 60.0,
    log_prefix: str = "",
) -> Tuple[float, float]:
    """One pass over `loader`. Trains if optimizer is given, otherwise evaluates
    (no_grad). Returns (avg_loss, top1_accuracy). Prints a progress line at most every
    `log_every_seconds` -- with millions of samples a single epoch can run long enough
    that silence looks like a hang, so this keeps a background run's log moving."""
    is_train = optimizer is not None
    model.train(is_train)

    total_loss = 0.0
    total_correct = 0
    total_count = 0
    epoch_start = time.time()
    last_log = epoch_start

    context = torch.enable_grad() if is_train else torch.no_grad()
    with context:
        for boards, labels in loader:
            boards = boards.to(device, non_blocking=True)
            labels = labels.to(device, non_blocking=True).long()

            if is_train:
                optimizer.zero_grad(set_to_none=True)

            with torch.amp.autocast(device_type=device.type, enabled=mixed_precision):
                logits = model(boards)
                loss = criterion(logits, labels)

            if is_train:
                if scaler is not None and mixed_precision:
                    scaler.scale(loss).backward()
                    scaler.step(optimizer)
                    scaler.update()
                else:
                    loss.backward()
                    optimizer.step()

            batch_size = labels.shape[0]
            total_loss += loss.item() * batch_size
            total_correct += (logits.argmax(dim=1) == labels).sum().item()
            total_count += batch_size

            now = time.time()
            if now - last_log >= log_every_seconds:
                rate = total_count / max(now - epoch_start, 1e-6)
                running_loss = total_loss / max(total_count, 1)
                print(
                    f"  {log_prefix}... {total_count:,} ejemplos, "
                    f"loss={running_loss:.4f}, {rate:.0f} ejemplos/s "
                    f"({now - epoch_start:.0f}s transcurridos)",
                    flush=True,
                )
                last_log = now

    avg_loss = total_loss / max(total_count, 1)
    accuracy = total_correct / max(total_count, 1)
    return avg_loss, accuracy


def train(
    config: dict,
    processed_dir: Path,
    checkpoints_dir: Path,
    epochs_override: Optional[int] = None,
    max_train_shards: Optional[int] = None,
    max_val_shards: Optional[int] = None,
    num_workers: int = 2,
    batch_size_override: Optional[int] = None,
    resume: bool = False,
) -> Path:
    training_cfg = config["training"]
    model_cfg = config.get("model", {})
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    train_ds = ShardDataset(processed_dir / "train", augment=True, max_shards=max_train_shards)
    val_ds = ShardDataset(processed_dir / "val", augment=False, max_shards=max_val_shards)

    batch_size = batch_size_override if batch_size_override is not None else training_cfg["batch_size"]
    loader_kwargs = dict(
        batch_size=batch_size,
        num_workers=num_workers,
        pin_memory=device.type == "cuda",
        persistent_workers=num_workers > 0,
        prefetch_factor=4 if num_workers > 0 else None,
    )
    train_loader = DataLoader(train_ds, **loader_kwargs)
    val_loader = DataLoader(val_ds, **loader_kwargs)

    model = PolicyNetwork(
        board_size=model_cfg.get("board_size", 19),
        residual_channels=model_cfg.get("residual_channels", 64),
        residual_blocks=model_cfg.get("residual_blocks", 6),
    ).to(device)
    print(f"Modelo: {count_parameters(model):,} parametros entrenables. Device: {device}")

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=training_cfg["learning_rate"],
        weight_decay=training_cfg["weight_decay"],
    )
    criterion = nn.CrossEntropyLoss()
    mixed_precision = training_cfg.get("mixed_precision", True) and device.type == "cuda"
    scaler = torch.amp.GradScaler(device.type, enabled=mixed_precision)

    epochs = epochs_override if epochs_override is not None else training_cfg["epochs"]
    early_stop_cfg = training_cfg.get("early_stopping", {})
    patience = early_stop_cfg.get("patience", 5) if early_stop_cfg.get("enabled", True) else None

    checkpoints_dir.mkdir(parents=True, exist_ok=True)
    best_path = checkpoints_dir / "best.pt"
    last_path = checkpoints_dir / "last.pt"
    best_val_loss = float("inf")
    epochs_without_improvement = 0
    start_epoch = 1

    if resume and last_path.exists():
        checkpoint = torch.load(last_path, weights_only=True)
        model.load_state_dict(checkpoint["model_state_dict"])
        optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
        scaler.load_state_dict(checkpoint["scaler_state_dict"])
        start_epoch = checkpoint["epoch"] + 1
        best_val_loss = checkpoint["best_val_loss"]
        epochs_without_improvement = checkpoint["epochs_without_improvement"]
        print(
            f"Reanudando desde {last_path}: epoch {checkpoint['epoch']} completada, "
            f"best_val_loss={best_val_loss:.4f}. Continuando en epoch {start_epoch}."
        )

    for epoch in range(start_epoch, epochs + 1):
        start = time.time()
        train_loss, train_acc = run_epoch(
            model, train_loader, device, criterion, optimizer, scaler, mixed_precision,
            log_prefix=f"[epoch {epoch}/{epochs}] train ",
        )
        val_loss, val_acc = run_epoch(
            model, val_loader, device, criterion, None, None, mixed_precision,
            log_prefix=f"[epoch {epoch}/{epochs}] val ",
        )
        elapsed = time.time() - start
        print(
            f"[epoch {epoch}/{epochs}] train_loss={train_loss:.4f} train_acc={train_acc:.4f} "
            f"val_loss={val_loss:.4f} val_acc={val_acc:.4f} ({elapsed:.1f}s)"
        )

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            epochs_without_improvement = 0
            torch.save(
                {
                    "model_state_dict": model.state_dict(),
                    "model_config": model_cfg,
                    "epoch": epoch,
                    "val_loss": val_loss,
                    "val_accuracy": val_acc,
                },
                best_path,
            )
            print(f"  -> nuevo mejor checkpoint guardado en {best_path}")
        else:
            epochs_without_improvement += 1

        # Saved every epoch (not just on improvement) so a killed/interrupted run --
        # e.g. the machine sleeping mid-training -- can resume with --resume instead of
        # losing all progress back to epoch 1.
        torch.save(
            {
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "scaler_state_dict": scaler.state_dict(),
                "model_config": model_cfg,
                "epoch": epoch,
                "val_loss": val_loss,
                "best_val_loss": best_val_loss,
                "epochs_without_improvement": epochs_without_improvement,
            },
            last_path,
        )

        if patience is not None and epochs_without_improvement >= patience:
            print(f"Early stopping: sin mejora en {patience} epochs consecutivas.")
            break

    return best_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path(__file__).resolve().parent.parent / "config.yaml")
    parser.add_argument("--processed-dir", type=Path, default=None)
    parser.add_argument("--checkpoints-dir", type=Path, default=None)
    parser.add_argument("--epochs", type=int, default=None)
    parser.add_argument("--max-train-shards", type=int, default=None)
    parser.add_argument("--max-val-shards", type=int, default=None)
    parser.add_argument("--num-workers", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=None)
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoints/last.pt if present")
    args = parser.parse_args()

    config = load_config(args.config)
    service_root = args.config.resolve().parent
    processed_dir = args.processed_dir or (service_root / "data" / "processed")
    checkpoints_dir = args.checkpoints_dir or (service_root / "checkpoints")

    train(
        config,
        processed_dir,
        checkpoints_dir,
        epochs_override=args.epochs,
        max_train_shards=args.max_train_shards,
        max_val_shards=args.max_val_shards,
        num_workers=args.num_workers,
        batch_size_override=args.batch_size,
        resume=args.resume,
    )


if __name__ == "__main__":
    main()
