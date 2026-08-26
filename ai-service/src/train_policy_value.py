"""Two-phase Policy+Value training on top of an already-trained PolicyNetwork checkpoint
(see model.py::PolicyValueNetwork, load_policy_value_checkpoint).

Requires shards built WITH `--require-winner` (see preprocessing.py / preprocess_ogs.py)
-- every sample must carry a real value target, not the NaN sentinel a Policy-only shard
has (games whose result couldn't be trusted are excluded upstream, at shard-build time).

  Fase A -- backbone AND Policy Head frozen (including their BatchNorm running stats, so
            the backbone truly doesn't drift), only the Value Head trains. Preserves the
            existing Policy Network's knowledge while the new head learns from scratch.
            Runs for `training.freeze_backbone_epochs` epochs.
  Fase B -- everything unfrozen, fine-tuned jointly at `fine_tuning.learning_rate` (lower
            than Fase A's) for `fine_tuning.epochs` epochs.

Both phases share one combined loss: policy_loss_weight * CrossEntropyLoss +
value_loss_weight * MSELoss, logged separately (see run_epoch's returned dict) so neither
metric hides inside the other.

Checkpoints are written to checkpoints/policy_value/ (best.pt / last.pt for 19x19,
best_9x9.pt / best_13x13.pt for the other sizes -- same per-size-suffix convention
service.py already uses for checkpoints/, just nested one level down) -- the original
Policy-only checkpoints under checkpoints/ are never overwritten.

Usage:
    python -m src.train_policy_value --config config.yaml --init-checkpoint checkpoints/best.pt
    python -m src.train_policy_value --config config.yaml --init-checkpoint checkpoints/best.pt --resume
"""

import argparse
import random
import time
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

import torch
import torch.nn as nn
import yaml
from torch.utils.data import DataLoader, IterableDataset, get_worker_info

from src.adapters.game_adapter import BOARD_SIZE
from src.augmentation import NUM_TRANSFORMS, transform_label, transform_tensor
from src.model import PolicyValueNetwork, count_parameters, load_policy_value_checkpoint
from src.preprocessing import decode_sample_with_value


class ValueShardDataset(IterableDataset):
    """Like train.py::ShardDataset, but yields (tensor, label, value) and silently skips
    any sample whose value target is NaN -- defensive: shards built with
    --require-winner shouldn't contain any, but this makes "pointed at the wrong shard
    dir" fail as a smaller effective dataset rather than as a loss that's silently NaN
    from the very first batch."""

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

    def __iter__(self) -> Iterator[Tuple[torch.Tensor, int, float]]:
        shard_paths = list(self._shards_for_this_worker())
        random.shuffle(shard_paths)
        for shard_path in shard_paths:
            shard = torch.load(shard_path, weights_only=True)
            n = shard["label"].shape[0]
            order = list(range(n))
            random.shuffle(order)
            for i in order:
                tensor, label, value = decode_sample_with_value(shard, i)
                if value != value:  # NaN: no determinate result for this game
                    continue
                if self.augment:
                    t = random.randrange(NUM_TRANSFORMS)
                    tensor = transform_tensor(tensor, t)
                    label = transform_label(label, shard["board_size"], t)
                    # value is a scalar game outcome -- invariant under board symmetry.
                yield tensor, label, value


def load_config(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def checkpoint_filename(board_size: int, kind: str) -> str:
    """Mirrors service.py's CHECKPOINT_FILENAMES convention: 19x19 keeps the plain
    "best.pt"/"last.pt" name, every other size gets its own suffix."""
    if board_size == BOARD_SIZE:
        return f"{kind}.pt"
    return f"{kind}_{board_size}x{board_size}.pt"


_BACKBONE_AND_POLICY_ATTRS = ("stem_conv", "stem_bn", "residual_tower", "policy_conv", "policy_bn", "policy_fc")


def set_backbone_and_policy_frozen(model: PolicyValueNetwork, frozen: bool) -> None:
    """Freezes (or unfreezes) every parameter of the shared backbone and the Policy
    Head. Only used going into a phase change -- see also _apply_freeze_mode, which
    additionally has to keep frozen BatchNorm layers in eval() during training so their
    running stats don't keep drifting even though their weight/bias no longer update."""
    for attr in _BACKBONE_AND_POLICY_ATTRS:
        for p in getattr(model, attr).parameters():
            p.requires_grad = not frozen


def _apply_freeze_mode(model: PolicyValueNetwork, is_train: bool, backbone_frozen: bool) -> None:
    model.train(is_train)
    if is_train and backbone_frozen:
        for attr in _BACKBONE_AND_POLICY_ATTRS:
            getattr(model, attr).eval()


def run_epoch(
    model: PolicyValueNetwork,
    loader: DataLoader,
    device: torch.device,
    optimizer: Optional[torch.optim.Optimizer],
    scaler: Optional[torch.amp.GradScaler],
    mixed_precision: bool,
    policy_loss_weight: float,
    value_loss_weight: float,
    backbone_frozen: bool,
    log_every_seconds: float = 60.0,
    log_prefix: str = "",
) -> Dict[str, float]:
    """One pass over `loader`. Trains if optimizer is given, otherwise evaluates
    (no_grad). Registers policy loss, value loss and total loss separately -- see the
    module docstring -- plus the Value-specific diagnostics Paso 10 of the spec asks
    for: MAE, correlation with the true outcome, winner-prediction accuracy, and the
    mean prediction (to catch the model collapsing to always predicting ~0 or ~+-1)."""
    is_train = optimizer is not None
    _apply_freeze_mode(model, is_train, backbone_frozen)

    policy_criterion = nn.CrossEntropyLoss()
    value_criterion = nn.MSELoss()

    total_policy_loss = 0.0
    total_value_loss = 0.0
    total_correct = 0
    total_count = 0
    value_preds: List[torch.Tensor] = []
    value_targets: List[torch.Tensor] = []
    epoch_start = time.time()
    last_log = epoch_start

    context = torch.enable_grad() if is_train else torch.no_grad()
    with context:
        for boards, labels, values in loader:
            boards = boards.to(device, non_blocking=True)
            labels = labels.to(device, non_blocking=True).long()
            values = values.to(device, non_blocking=True).float().unsqueeze(1)

            if is_train:
                optimizer.zero_grad(set_to_none=True)

            with torch.amp.autocast(device_type=device.type, enabled=mixed_precision):
                policy_logits, value_pred = model(boards)
                policy_loss = policy_criterion(policy_logits, labels)
                value_loss = value_criterion(value_pred, values)
                loss = policy_loss_weight * policy_loss + value_loss_weight * value_loss

            if is_train:
                if scaler is not None and mixed_precision:
                    scaler.scale(loss).backward()
                    scaler.step(optimizer)
                    scaler.update()
                else:
                    loss.backward()
                    optimizer.step()

            batch_size = labels.shape[0]
            total_policy_loss += policy_loss.item() * batch_size
            total_value_loss += value_loss.item() * batch_size
            total_correct += (policy_logits.argmax(dim=1) == labels).sum().item()
            total_count += batch_size
            value_preds.append(value_pred.detach().float().flatten().cpu())
            value_targets.append(values.detach().float().flatten().cpu())

            now = time.time()
            if now - last_log >= log_every_seconds:
                rate = total_count / max(now - epoch_start, 1e-6)
                print(
                    f"  {log_prefix}... {total_count:,} ejemplos, "
                    f"policy_loss={total_policy_loss / total_count:.4f} "
                    f"value_loss={total_value_loss / total_count:.4f}, {rate:.0f} ejemplos/s "
                    f"({now - epoch_start:.0f}s transcurridos)",
                    flush=True,
                )
                last_log = now

    avg_policy_loss = total_policy_loss / max(total_count, 1)
    avg_value_loss = total_value_loss / max(total_count, 1)
    preds = torch.cat(value_preds) if value_preds else torch.zeros(0)
    targets = torch.cat(value_targets) if value_targets else torch.zeros(0)

    mae = (preds - targets).abs().mean().item() if preds.numel() else float("nan")
    winner_accuracy = (preds.sign() == targets.sign()).float().mean().item() if preds.numel() else float("nan")
    correlation = torch.corrcoef(torch.stack([preds, targets]))[0, 1].item() if preds.numel() > 1 else float("nan")

    return {
        "policy_loss": avg_policy_loss,
        "value_loss": avg_value_loss,
        "total_loss": policy_loss_weight * avg_policy_loss + value_loss_weight * avg_value_loss,
        "policy_accuracy": total_correct / max(total_count, 1),
        "value_mae": mae,
        "value_correlation": correlation,
        "value_winner_accuracy": winner_accuracy,
        "value_mean_prediction": preds.mean().item() if preds.numel() else float("nan"),
    }


def _format_metrics(m: Dict[str, float]) -> str:
    return (
        f"policy_loss={m['policy_loss']:.4f} policy_acc={m['policy_accuracy']:.4f} "
        f"value_loss={m['value_loss']:.4f} value_mae={m['value_mae']:.4f} "
        f"value_corr={m['value_correlation']:.4f} winner_acc={m['value_winner_accuracy']:.4f} "
        f"value_mean={m['value_mean_prediction']:+.3f}"
    )


def train_policy_value(
    config: dict,
    processed_dir: Path,
    init_checkpoint: Path,
    checkpoints_dir: Path,
    epochs_a_override: Optional[int] = None,
    epochs_b_override: Optional[int] = None,
    max_train_shards: Optional[int] = None,
    max_val_shards: Optional[int] = None,
    num_workers: int = 2,
    batch_size_override: Optional[int] = None,
    resume: bool = False,
) -> Path:
    training_cfg = config["training"]
    model_cfg = config.get("model", {})
    value_cfg = config.get("value_head", {})
    fine_tuning_cfg = config.get("fine_tuning", {})
    board_size = model_cfg.get("board_size", BOARD_SIZE)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    train_ds = ValueShardDataset(processed_dir / "train", augment=True, max_shards=max_train_shards)
    val_ds = ValueShardDataset(processed_dir / "val", augment=False, max_shards=max_val_shards)

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

    checkpoints_dir.mkdir(parents=True, exist_ok=True)
    best_path = checkpoints_dir / checkpoint_filename(board_size, "best")
    last_path = checkpoints_dir / checkpoint_filename(board_size, "last")

    checkpoint_to_load = last_path if (resume and last_path.exists()) else init_checkpoint
    model, value_head_is_pretrained = load_policy_value_checkpoint(checkpoint_to_load, device)
    print(f"Modelo: {count_parameters(model):,} parametros entrenables (todos desbloqueados). Device: {device}")

    policy_loss_weight = training_cfg.get("policy_loss_weight", 1.0)
    value_loss_weight = training_cfg.get("value_loss_weight", 1.0)
    freeze_backbone_epochs = training_cfg.get("freeze_backbone_epochs", 3)
    fine_tuning_epochs = fine_tuning_cfg.get("epochs", training_cfg.get("epochs", 10))
    fine_tuning_lr = fine_tuning_cfg.get("learning_rate", training_cfg["learning_rate"])

    epochs_a = epochs_a_override if epochs_a_override is not None else freeze_backbone_epochs
    epochs_b = epochs_b_override if epochs_b_override is not None else fine_tuning_epochs
    total_epochs = epochs_a + epochs_b

    mixed_precision = training_cfg.get("mixed_precision", True) and device.type == "cuda"
    scaler = torch.amp.GradScaler(device.type, enabled=mixed_precision)

    best_val_loss = float("inf")
    start_epoch = 1
    optimizer: Optional[torch.optim.Optimizer] = None

    if resume and last_path.exists():
        raw_checkpoint = torch.load(last_path, weights_only=True)
        start_epoch = raw_checkpoint["epoch"] + 1
        best_val_loss = raw_checkpoint.get("best_val_loss", float("inf"))
        print(f"Reanudando desde {last_path}: epoch {raw_checkpoint['epoch']} completada. Continuando en epoch {start_epoch}.")

    for epoch in range(start_epoch, total_epochs + 1):
        phase = "A" if epoch <= epochs_a else "B"
        backbone_frozen = phase == "A"

        # Optimizer is rebuilt exactly on a phase boundary (epoch == 1 or the first
        # epoch of Fase B) -- freezing/unfreezing changes *which* parameters need one at
        # all, and Fase B's own, lower learning rate applies from its very first epoch.
        needs_new_optimizer = optimizer is None or epoch in (1, epochs_a + 1)
        if needs_new_optimizer:
            set_backbone_and_policy_frozen(model, frozen=backbone_frozen)
            trainable_params = [p for p in model.parameters() if p.requires_grad]
            lr = training_cfg["learning_rate"] if phase == "A" else fine_tuning_lr
            optimizer = torch.optim.AdamW(trainable_params, lr=lr, weight_decay=training_cfg["weight_decay"])
            n_trainable = sum(p.numel() for p in trainable_params)
            print(f"[epoch {epoch}] Fase {phase} -- {n_trainable:,} parametros entrenables, lr={lr}")

        start = time.time()
        train_metrics = run_epoch(
            model, train_loader, device, optimizer, scaler, mixed_precision,
            policy_loss_weight, value_loss_weight, backbone_frozen,
            log_prefix=f"[epoch {epoch}/{total_epochs}, fase {phase}] train ",
        )
        val_metrics = run_epoch(
            model, val_loader, device, None, None, mixed_precision,
            policy_loss_weight, value_loss_weight, backbone_frozen,
            log_prefix=f"[epoch {epoch}/{total_epochs}, fase {phase}] val ",
        )
        elapsed = time.time() - start
        print(f"[epoch {epoch}/{total_epochs}, fase {phase}] train: {_format_metrics(train_metrics)}")
        print(f"[epoch {epoch}/{total_epochs}, fase {phase}] val:   {_format_metrics(val_metrics)} ({elapsed:.1f}s)")

        model_cfg_to_save = {
            "board_size": board_size,
            "residual_channels": model_cfg.get("residual_channels", 64),
            "residual_blocks": model_cfg.get("residual_blocks", 6),
        }
        value_cfg_to_save = {
            "value_channels": value_cfg.get("value_channels", 4),
            "hidden_size": value_cfg.get("hidden_size", 128),
        }

        if val_metrics["total_loss"] < best_val_loss:
            best_val_loss = val_metrics["total_loss"]
            torch.save(
                {
                    "model_state_dict": model.state_dict(),
                    "model_config": model_cfg_to_save,
                    "value_head_config": value_cfg_to_save,
                    "epoch": epoch,
                    "phase": phase,
                    "val_metrics": val_metrics,
                    "train_metrics": train_metrics,
                },
                best_path,
            )
            print(f"  -> nuevo mejor checkpoint guardado en {best_path}")

        # Saved every epoch (not just on improvement) so an interrupted run can --resume.
        torch.save(
            {
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "scaler_state_dict": scaler.state_dict(),
                "model_config": model_cfg_to_save,
                "value_head_config": value_cfg_to_save,
                "epoch": epoch,
                "phase": phase,
                "val_metrics": val_metrics,
                "train_metrics": train_metrics,
                "best_val_loss": best_val_loss,
            },
            last_path,
        )

    return best_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path(__file__).resolve().parent.parent / "config.yaml")
    parser.add_argument(
        "--init-checkpoint",
        type=Path,
        default=None,
        help="Policy-only checkpoint to bootstrap the backbone/Policy Head from (e.g. checkpoints/best.pt)",
    )
    parser.add_argument(
        "--processed-dir",
        type=Path,
        default=None,
        help="Shards built WITH --require-winner (see preprocessing.py / preprocess_ogs.py)",
    )
    parser.add_argument("--checkpoints-dir", type=Path, default=None)
    parser.add_argument("--epochs-a", type=int, default=None, help="Override training.freeze_backbone_epochs")
    parser.add_argument("--epochs-b", type=int, default=None, help="Override fine_tuning.epochs")
    parser.add_argument("--max-train-shards", type=int, default=None)
    parser.add_argument("--max-val-shards", type=int, default=None)
    parser.add_argument("--num-workers", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=None)
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoints/policy_value/last*.pt if present")
    args = parser.parse_args()

    config = load_config(args.config)
    service_root = args.config.resolve().parent
    processed_dir = args.processed_dir or (service_root / "data" / "processed_value")
    checkpoints_dir = args.checkpoints_dir or (service_root / "checkpoints" / "policy_value")
    init_checkpoint = args.init_checkpoint or (service_root / "checkpoints" / "best.pt")

    train_policy_value(
        config,
        processed_dir,
        init_checkpoint,
        checkpoints_dir,
        epochs_a_override=args.epochs_a,
        epochs_b_override=args.epochs_b,
        max_train_shards=args.max_train_shards,
        max_val_shards=args.max_val_shards,
        num_workers=args.num_workers,
        batch_size_override=args.batch_size,
        resume=args.resume,
    )


if __name__ == "__main__":
    main()
