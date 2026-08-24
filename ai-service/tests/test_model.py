import torch

from src.adapters.game_adapter import BOARD_SIZE, NUM_CHANNELS, NUM_LABELS
from src.model import PolicyNetwork, count_parameters


def test_forward_output_shape():
    model = PolicyNetwork()
    x = torch.zeros((4, NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE))
    logits = model(x)
    assert logits.shape == (4, NUM_LABELS)


def test_parameter_count_within_spec_budget():
    model = PolicyNetwork()
    n = count_parameters(model)
    assert 1_000_000 <= n <= 3_000_000, f"param count {n} outside the 1M-3M target range"


def test_output_is_raw_logits_not_softmaxed():
    model = PolicyNetwork()
    model.eval()
    x = torch.randn((2, NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE))
    logits = model(x)
    row_sums = logits.sum(dim=1)
    assert not torch.allclose(row_sums, torch.ones_like(row_sums), atol=1e-3)
    assert (logits < 0).any()


def test_num_labels_auto_derives_from_board_size_when_not_given():
    # Regression check: this used to silently default to the 19x19 model's fixed 362
    # regardless of board_size, so any other size's output layer didn't match its own
    # board at all unless every single caller remembered to pass num_labels separately.
    model = PolicyNetwork(board_size=9)
    x = torch.zeros((1, NUM_CHANNELS, 9, 9))
    logits = model(x)
    assert logits.shape == (1, 9 * 9 + 1)


def test_explicit_num_labels_still_overrides_the_default():
    model = PolicyNetwork(board_size=9, num_labels=100)
    x = torch.zeros((1, NUM_CHANNELS, 9, 9))
    logits = model(x)
    assert logits.shape == (1, 100)


def test_gradients_flow_through_full_network():
    model = PolicyNetwork()
    x = torch.randn((2, NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE))
    labels = torch.tensor([0, NUM_LABELS - 1])
    logits = model(x)
    loss = torch.nn.functional.cross_entropy(logits, labels)
    loss.backward()
    assert model.stem_conv.weight.grad is not None
    assert model.policy_fc.weight.grad is not None
    assert torch.any(model.stem_conv.weight.grad != 0)
