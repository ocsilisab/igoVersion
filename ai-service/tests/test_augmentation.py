import pytest
import torch

from src.adapters.game_adapter import BOARD_SIZE, PASS_LABEL, move_to_label
from src.augmentation import NUM_TRANSFORMS, transform_label, transform_point, transform_tensor


@pytest.mark.parametrize("transform_id", range(NUM_TRANSFORMS))
@pytest.mark.parametrize("row,col", [(0, 0), (18, 18), (0, 18), (18, 0), (3, 15), (9, 9)])
def test_transform_tensor_and_transform_point_agree(transform_id, row, col):
    """The point transform must land exactly where the marked cell ends up after
    transforming the tensor -- checked directly rather than assumed from rot90's docs."""
    tensor = torch.zeros((BOARD_SIZE, BOARD_SIZE))
    tensor[row, col] = 1.0

    transformed = transform_tensor(tensor, transform_id)
    nonzero = (transformed == 1.0).nonzero(as_tuple=False)
    assert nonzero.shape == (1, 2)
    actual = (int(nonzero[0, 0]), int(nonzero[0, 1]))

    expected = transform_point(row, col, BOARD_SIZE, transform_id)
    assert actual == expected


def test_all_8_transforms_are_distinct_permutations():
    tensor = torch.arange(BOARD_SIZE * BOARD_SIZE, dtype=torch.float32).reshape(BOARD_SIZE, BOARD_SIZE)
    results = [transform_tensor(tensor, t).flatten().tolist() for t in range(NUM_TRANSFORMS)]
    unique = {tuple(r) for r in results}
    assert len(unique) == NUM_TRANSFORMS


def test_transform_tensor_preserves_multichannel_shape():
    tensor = torch.zeros((6, BOARD_SIZE, BOARD_SIZE))
    tensor[0, 4, 7] = 1.0
    transformed = transform_tensor(tensor, 5)
    assert transformed.shape == (6, BOARD_SIZE, BOARD_SIZE)


@pytest.mark.parametrize("transform_id", range(NUM_TRANSFORMS))
def test_transform_label_matches_transform_point(transform_id):
    label = move_to_label((3, 15), BOARD_SIZE)
    transformed = transform_label(label, BOARD_SIZE, transform_id)
    expected_point = transform_point(3, 15, BOARD_SIZE, transform_id)
    assert transformed == move_to_label(expected_point, BOARD_SIZE)


@pytest.mark.parametrize("transform_id", range(NUM_TRANSFORMS))
def test_pass_label_is_never_transformed(transform_id):
    assert transform_label(PASS_LABEL, BOARD_SIZE, transform_id) == PASS_LABEL
