"""Residual CNN policy network, plus a Policy+Value variant that shares its backbone.
Fully independent from the TypeScript engines in src/ai/ (heuristic "facil") and
src/ai/mcts/ ("dificil") -- this is a third approach, never a replacement for either
(see Fase 1 analysis).

PolicyNetwork is untouched in behavior (Fase "Policy+Value" analysis): forward() still
returns just logits, same layer names, same state_dict keys as every checkpoint already
on disk. PolicyValueNetwork subclasses it and adds a Value Head on the same feature maps
extract_features() produces -- no second backbone, so a PolicyNetwork checkpoint's
stem/tower/policy weights load straight into a PolicyValueNetwork via strict=False (see
load_policy_value_checkpoint): every existing key matches, only the new value_* keys are
missing and stay at their fresh initialization.
"""

from pathlib import Path
from typing import Optional, Tuple

import torch
import torch.nn as nn

from src.adapters.game_adapter import BOARD_SIZE, NUM_CHANNELS


class ResidualBlock(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x
        out = torch.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        out = out + residual
        return torch.relu(out)


class PolicyNetwork(nn.Module):
    """Input: [B, NUM_CHANNELS, board_size, board_size]. Output: [B, num_labels] raw
    logits -- no softmax here on purpose (train.py applies CrossEntropyLoss directly
    to logits; inference.py applies softmax only when it needs probabilities)."""

    def __init__(
        self,
        board_size: int = BOARD_SIZE,
        input_channels: int = NUM_CHANNELS,
        residual_channels: int = 64,
        residual_blocks: int = 6,
        policy_channels: int = 8,
        num_labels: Optional[int] = None,
    ):
        super().__init__()
        # Defaults to board_size^2 + 1 (every point plus a pass) unless explicitly
        # overridden -- this used to silently default to the 19x19 model's fixed 362 here
        # instead, so constructing a network for any other board_size without also
        # remembering to pass num_labels separately produced a model whose output layer
        # didn't actually match its own board size. Deriving it from board_size makes
        # that combination impossible instead of relying on every caller to get it right.
        if num_labels is None:
            num_labels = board_size * board_size + 1
        # Plain attributes (not layers) so a subclass -- see PolicyValueNetwork -- can
        # size its own new layers off the same numbers without re-deriving or duplicating
        # them; these don't appear in state_dict, so old checkpoints are unaffected.
        self.board_size = board_size
        self.residual_channels = residual_channels

        self.stem_conv = nn.Conv2d(input_channels, residual_channels, kernel_size=3, padding=1, bias=False)
        self.stem_bn = nn.BatchNorm2d(residual_channels)
        self.residual_tower = nn.Sequential(
            *[ResidualBlock(residual_channels) for _ in range(residual_blocks)]
        )
        self.policy_conv = nn.Conv2d(residual_channels, policy_channels, kernel_size=1, bias=False)
        self.policy_bn = nn.BatchNorm2d(policy_channels)
        self.policy_fc = nn.Linear(policy_channels * board_size * board_size, num_labels)

    def extract_features(self, x: torch.Tensor) -> torch.Tensor:
        """The shared trunk: stem + residual tower. [B, C, size, size] in, [B,
        residual_channels, size, size] out -- what both heads branch off."""
        out = torch.relu(self.stem_bn(self.stem_conv(x)))
        return self.residual_tower(out)

    def policy_head(self, features: torch.Tensor) -> torch.Tensor:
        out = torch.relu(self.policy_bn(self.policy_conv(features)))
        out = out.flatten(1)
        return self.policy_fc(out)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.policy_head(self.extract_features(x))


class PolicyValueNetwork(PolicyNetwork):
    """Same backbone + Policy Head as PolicyNetwork (see its docstring), plus a Value
    Head branching off the same extract_features() output. forward() returns
    (policy_logits, value) instead of just logits -- the one deliberate incompatibility
    with PolicyNetwork's call signature, since every caller of a dual-head model already
    has to be updated to unpack a tuple anyway (see inference.py::predict_move_and_value).

    Value Head: Conv2d 1x1 -> BatchNorm -> ReLU -> flatten -> Linear -> ReLU -> Linear ->
    Tanh. Tanh is used only here, as the final activation -- never inside the backbone or
    Policy Head, which must keep producing the same raw logits as before.
    """

    def __init__(
        self,
        value_channels: int = 4,
        value_hidden_size: int = 128,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.value_channels = value_channels
        self.value_hidden_size = value_hidden_size

        self.value_conv = nn.Conv2d(self.residual_channels, value_channels, kernel_size=1, bias=False)
        self.value_bn = nn.BatchNorm2d(value_channels)
        self.value_fc1 = nn.Linear(value_channels * self.board_size * self.board_size, value_hidden_size)
        self.value_fc2 = nn.Linear(value_hidden_size, 1)

    def value_head(self, features: torch.Tensor) -> torch.Tensor:
        out = torch.relu(self.value_bn(self.value_conv(features)))
        out = out.flatten(1)
        out = torch.relu(self.value_fc1(out))
        out = self.value_fc2(out)
        return torch.tanh(out)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        features = self.extract_features(x)
        return self.policy_head(features), self.value_head(features)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


def load_model_from_checkpoint(checkpoint_path: Path, device: torch.device) -> PolicyNetwork:
    """Loads a checkpoint saved by train.py (either best.pt or last.pt -- both carry
    model_state_dict + model_config) and returns it ready for inference (eval mode).
    Unchanged from before the Value Head existed -- always builds a plain, single-head
    PolicyNetwork; see load_policy_value_checkpoint for the dual-head equivalent."""
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=True)
    model_cfg = checkpoint.get("model_config", {})
    model = PolicyNetwork(
        board_size=model_cfg.get("board_size", BOARD_SIZE),
        residual_channels=model_cfg.get("residual_channels", 64),
        residual_blocks=model_cfg.get("residual_blocks", 6),
    ).to(device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    return model


def load_policy_value_checkpoint(
    checkpoint_path: Path, device: torch.device
) -> Tuple[PolicyValueNetwork, bool]:
    """Loads a checkpoint into a PolicyValueNetwork. Works with both:
      - a fresh Policy-only checkpoint (e.g. checkpoints/best.pt) -- backbone and Policy
        Head weights load, the Value Head keeps its random initialization;
      - a checkpoint already saved by train_policy_value.py -- every key loads.

    Returns (model, value_head_is_pretrained). Raises if the checkpoint has any key this
    architecture doesn't recognize at all (a real mismatch, e.g. wrong residual_channels)
    -- but never for a missing value_* key, which just means "Policy-only checkpoint,
    Value Head starts fresh" and is the expected, common case for Fase A.
    """
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=True)
    model_cfg = checkpoint.get("model_config", {})
    value_cfg = checkpoint.get("value_head_config", {})
    model = PolicyValueNetwork(
        board_size=model_cfg.get("board_size", BOARD_SIZE),
        residual_channels=model_cfg.get("residual_channels", 64),
        residual_blocks=model_cfg.get("residual_blocks", 6),
        value_channels=value_cfg.get("value_channels", 4),
        value_hidden_size=value_cfg.get("hidden_size", 128),
    ).to(device)

    result = model.load_state_dict(checkpoint["model_state_dict"], strict=False)
    unexpected_real = [k for k in result.unexpected_keys]
    missing_non_value = [k for k in result.missing_keys if not k.startswith("value_")]
    if unexpected_real or missing_non_value:
        raise RuntimeError(
            "Checkpoint incompatible con PolicyValueNetwork: "
            f"claves inesperadas={unexpected_real}, claves de backbone/policy faltantes={missing_non_value}"
        )

    value_head_is_pretrained = len(result.missing_keys) == 0
    if value_head_is_pretrained:
        print(f"Pesos cargados correctamente (incluyendo Value Head) desde {checkpoint_path}")
    else:
        print(
            f"Pesos cargados correctamente desde {checkpoint_path} "
            f"(backbone + Policy Head). Value Head inicializado en fresco: {result.missing_keys}"
        )

    model.eval()
    return model, value_head_is_pretrained
