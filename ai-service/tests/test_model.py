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
