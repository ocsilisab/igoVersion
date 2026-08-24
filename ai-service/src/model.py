"""Residual CNN policy network. Fully independent from the TypeScript engines in
src/ai/ (heuristic "facil") and src/ai/mcts/ ("dificil") -- this is a third approach,
never a replacement for either (see Fase 1 analysis).
"""

from pathlib import Path
from typing import Optional

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
        self.stem_conv = nn.Conv2d(input_channels, residual_channels, kernel_size=3, padding=1, bias=False)
        self.stem_bn = nn.BatchNorm2d(residual_channels)
        self.residual_tower = nn.Sequential(
            *[ResidualBlock(residual_channels) for _ in range(residual_blocks)]
        )
        self.policy_conv = nn.Conv2d(residual_channels, policy_channels, kernel_size=1, bias=False)
        self.policy_bn = nn.BatchNorm2d(policy_channels)
        self.policy_fc = nn.Linear(policy_channels * board_size * board_size, num_labels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = torch.relu(self.stem_bn(self.stem_conv(x)))
        out = self.residual_tower(out)
        out = torch.relu(self.policy_bn(self.policy_conv(out)))
        out = out.flatten(1)
        return self.policy_fc(out)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


def load_model_from_checkpoint(checkpoint_path: Path, device: torch.device) -> PolicyNetwork:
    """Loads a checkpoint saved by train.py (either best.pt or last.pt -- both carry
    model_state_dict + model_config) and returns it ready for inference (eval mode)."""
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
