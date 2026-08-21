"""The 8 symmetries of the Go board (dihedral group D4: 4 rotations x optional mirror),
applied consistently to a position tensor and its move label. Used dynamically at
training time (see train.py) -- shards on disk stay untransformed.

transform_id in [0, 8) enumerates: 0-3 = rotate 0/90/180/270 degrees, 4-7 = the same
four rotations after a diagonal mirror (transpose). transform_tensor and transform_point
must stay in lockstep -- that pairing is what test_augmentation.py checks, empirically,
for all 8 ids, rather than trusting the rot90/transpose direction from memory.
"""

from typing import Optional, Tuple

import torch

from src.adapters.game_adapter import PASS_LABEL, label_to_move, move_to_label

NUM_TRANSFORMS = 8


def transform_tensor(tensor: torch.Tensor, transform_id: int) -> torch.Tensor:
    """Applies symmetry `transform_id` to the last two (H, W) dims of `tensor`."""
    if not 0 <= transform_id < NUM_TRANSFORMS:
        raise ValueError(f"transform_id fuera de rango [0, {NUM_TRANSFORMS}): {transform_id}")

    if transform_id >= 4:
        tensor = tensor.transpose(-2, -1)
        transform_id -= 4
    if transform_id:
        tensor = torch.rot90(tensor, k=transform_id, dims=(-2, -1))
    return tensor


def transform_point(row: int, col: int, size: int, transform_id: int) -> Tuple[int, int]:
    """Applies the same symmetry to a single (row, col), for transforming move labels
    in step with transform_tensor."""
    if not 0 <= transform_id < NUM_TRANSFORMS:
        raise ValueError(f"transform_id fuera de rango [0, {NUM_TRANSFORMS}): {transform_id}")

    if transform_id >= 4:
        row, col = col, row
        transform_id -= 4
    for _ in range(transform_id):
        row, col = size - 1 - col, row
    return row, col


def transform_label(label: int, size: int, transform_id: int) -> int:
    """Transforms a move label (0..size*size-1, or PASS_LABEL). PASS is never touched."""
    if label == PASS_LABEL:
        return PASS_LABEL
    move = label_to_move(label, size)
    assert move is not None
    row, col = transform_point(move[0], move[1], size, transform_id)
    return move_to_label((row, col), size)
