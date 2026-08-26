from pathlib import Path

import torch
from torch.utils.data import DataLoader

from src.adapters.game_adapter import BOARD_SIZE
from src.go_board import empty_board
from src.model import PolicyNetwork, PolicyValueNetwork
from src.preprocessing import RawSample, ShardWriter
from src.train_policy_value import (
    ValueShardDataset,
    checkpoint_filename,
    set_backbone_and_policy_frozen,
    train_policy_value,
)


def test_checkpoint_filename_matches_service_py_convention():
    assert checkpoint_filename(19, "best") == "best.pt"
    assert checkpoint_filename(19, "last") == "last.pt"
    assert checkpoint_filename(9, "best") == "best_9x9.pt"
    assert checkpoint_filename(13, "last") == "last_13x13.pt"


def test_set_backbone_and_policy_frozen_leaves_value_head_trainable():
    model = PolicyValueNetwork()
    set_backbone_and_policy_frozen(model, frozen=True)

    assert all(not p.requires_grad for p in model.stem_conv.parameters())
    assert all(not p.requires_grad for p in model.residual_tower.parameters())
    assert all(not p.requires_grad for p in model.policy_fc.parameters())
    assert all(p.requires_grad for p in model.value_conv.parameters())
    assert all(p.requires_grad for p in model.value_fc2.parameters())

    set_backbone_and_policy_frozen(model, frozen=False)
    assert all(p.requires_grad for p in model.stem_conv.parameters())
    assert all(p.requires_grad for p in model.policy_fc.parameters())


def _write_fake_shards(processed_dir: Path, board_size: int, n_train: int, n_val: int) -> None:
    board = empty_board(board_size)
    board[0][0] = "black"
    board[1][1] = "white"

    train_writer = ShardWriter(processed_dir, "train", shard_size=1000, board_size=board_size)
    for i in range(n_train):
        player = "black" if i % 2 == 0 else "white"
        winner = "black" if i % 3 == 0 else "white"
        train_writer.add(
            RawSample(
                board=board,
                current_player=player,
                recent_moves=[None, None, None],
                label=i % (board_size * board_size),
                value_target=1.0 if player == winner else -1.0,
            )
        )
    train_writer.close()

    val_writer = ShardWriter(processed_dir, "val", shard_size=1000, board_size=board_size)
    for i in range(n_val):
        player = "black" if i % 2 == 0 else "white"
        winner = "white"
        val_writer.add(
            RawSample(
                board=board,
                current_player=player,
                recent_moves=[None, None, None],
                label=i % (board_size * board_size),
                value_target=1.0 if player == winner else -1.0,
            )
        )
    val_writer.close()


def test_value_shard_dataset_yields_tensor_label_value_and_skips_nan(tmp_path: Path):
    board_size = 9
    processed_dir = tmp_path / "processed"
    _write_fake_shards(processed_dir, board_size, n_train=20, n_val=5)

    # One NaN sample thrown in a fresh shard to confirm it gets skipped.
    board = empty_board(board_size)
    writer = ShardWriter(processed_dir, "train", shard_size=10, board_size=board_size)
    writer.add(RawSample(board=board, current_player="black", recent_moves=[None, None, None], label=0, value_target=None))
    writer.close()

    ds = ValueShardDataset(processed_dir / "train", augment=False)
    samples = list(ds)
    assert len(samples) == 20  # the NaN one is excluded
    for tensor, label, value in samples:
        assert tensor.shape == (6, board_size, board_size)
        assert isinstance(label, int)
        assert value in (1.0, -1.0)


def test_train_policy_value_smoke_run_freezes_backbone_in_phase_a(tmp_path: Path):
    board_size = 9
    processed_dir = tmp_path / "processed"
    _write_fake_shards(processed_dir, board_size, n_train=64, n_val=32)

    init_policy = PolicyNetwork(board_size=board_size, residual_channels=8, residual_blocks=2)
    init_checkpoint = tmp_path / "init_policy.pt"
    torch.save(
        {
            "model_state_dict": init_policy.state_dict(),
            "model_config": {"board_size": board_size, "residual_channels": 8, "residual_blocks": 2},
        },
        init_checkpoint,
    )

    config = {
        "model": {"board_size": board_size, "residual_channels": 8, "residual_blocks": 2},
        "value_head": {"value_channels": 2, "hidden_size": 16},
        "training": {
            "batch_size": 8,
            "learning_rate": 0.01,
            "weight_decay": 0.0,
            "mixed_precision": False,
            "policy_loss_weight": 1.0,
            "value_loss_weight": 1.0,
            "freeze_backbone_epochs": 1,
        },
        "fine_tuning": {"learning_rate": 0.001, "epochs": 1},
    }

    checkpoints_dir = tmp_path / "checkpoints" / "policy_value"

    before_stem_weight = init_policy.stem_conv.weight.detach().clone()
    before_stem_running_mean = init_policy.stem_bn.running_mean.detach().clone()

    best_path = train_policy_value(
        config,
        processed_dir,
        init_checkpoint,
        checkpoints_dir,
        epochs_a_override=1,
        epochs_b_override=0,
        num_workers=0,
        batch_size_override=8,
    )

    assert best_path == checkpoints_dir / "best_9x9.pt"
    assert best_path.exists()
    assert (checkpoints_dir / "last_9x9.pt").exists()

    saved = torch.load(best_path, weights_only=True, map_location="cpu")
    assert saved["phase"] == "A"
    assert "value_conv.weight" in saved["model_state_dict"]
    assert torch.equal(saved["model_state_dict"]["stem_conv.weight"], before_stem_weight)
    assert torch.equal(saved["model_state_dict"]["stem_bn.running_mean"], before_stem_running_mean)

    value_weight_after = saved["model_state_dict"]["value_fc2.weight"]
    assert not torch.equal(value_weight_after, torch.zeros_like(value_weight_after))


def test_train_policy_value_phase_b_unfreezes_backbone(tmp_path: Path):
    board_size = 9
    processed_dir = tmp_path / "processed"
    _write_fake_shards(processed_dir, board_size, n_train=64, n_val=32)

    init_policy = PolicyNetwork(board_size=board_size, residual_channels=8, residual_blocks=2)
    init_checkpoint = tmp_path / "init_policy.pt"
    torch.save(
        {
            "model_state_dict": init_policy.state_dict(),
            "model_config": {"board_size": board_size, "residual_channels": 8, "residual_blocks": 2},
        },
        init_checkpoint,
    )

    config = {
        "model": {"board_size": board_size, "residual_channels": 8, "residual_blocks": 2},
        "value_head": {"value_channels": 2, "hidden_size": 16},
        "training": {
            "batch_size": 8,
            "learning_rate": 0.01,
            "weight_decay": 0.0,
            "mixed_precision": False,
            "policy_loss_weight": 1.0,
            "value_loss_weight": 1.0,
            "freeze_backbone_epochs": 1,
        },
        "fine_tuning": {"learning_rate": 0.001, "epochs": 1},
    }
    checkpoints_dir = tmp_path / "checkpoints" / "policy_value"
    before_stem_weight = init_policy.stem_conv.weight.detach().clone()

    best_path = train_policy_value(
        config, processed_dir, init_checkpoint, checkpoints_dir,
        epochs_a_override=1, epochs_b_override=1, num_workers=0, batch_size_override=8,
    )

    saved = torch.load(best_path, weights_only=True, map_location="cpu")
    # By the end of phase B the backbone has had a real gradient step -- it must have moved.
    if saved["phase"] == "B":
        assert not torch.equal(saved["model_state_dict"]["stem_conv.weight"], before_stem_weight)
