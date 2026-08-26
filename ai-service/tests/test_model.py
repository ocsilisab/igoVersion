import torch

from src.adapters.game_adapter import BOARD_SIZE, NUM_CHANNELS, NUM_LABELS
from src.model import PolicyNetwork, PolicyValueNetwork, count_parameters, load_policy_value_checkpoint


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


def test_policy_network_forward_unchanged_by_the_extract_features_refactor():
    # PolicyNetwork.forward() is now policy_head(extract_features(x)) internally -- same
    # layers, same order of ops, so a fixed input must produce bit-identical output to
    # before the refactor. Seeded weights + eval() (no BatchNorm running-stats update)
    # make this a deterministic check, not just a shape check.
    torch.manual_seed(0)
    model = PolicyNetwork()
    model.eval()
    x = torch.randn((2, NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE))
    with torch.no_grad():
        direct = model.policy_head(model.extract_features(x))
        via_forward = model(x)
    assert torch.equal(direct, via_forward)


# ---- PolicyValueNetwork ----


def test_policy_value_forward_output_shapes():
    model = PolicyValueNetwork()
    x = torch.zeros((4, NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE))
    policy_logits, value = model(x)
    assert policy_logits.shape == (4, NUM_LABELS)
    assert value.shape == (4, 1)


def test_policy_value_output_is_within_tanh_range():
    model = PolicyValueNetwork()
    model.eval()
    x = torch.randn((8, NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE)) * 10  # large inputs too
    with torch.no_grad():
        _, value = model(x)
    assert torch.all(value >= -1.0) and torch.all(value <= 1.0)


def test_policy_value_policy_head_matches_a_plain_policy_network_bit_for_bit():
    # Same weights on the shared trunk + Policy Head must produce the exact same policy
    # logits whether run through PolicyNetwork or PolicyValueNetwork -- the Value Head
    # must not perturb the Policy path at all.
    torch.manual_seed(0)
    policy_only = PolicyNetwork()
    policy_only.eval()

    torch.manual_seed(0)
    dual = PolicyValueNetwork()
    dual.eval()

    x = torch.randn((3, NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE))
    with torch.no_grad():
        policy_logits_only = policy_only(x)
        policy_logits_dual, _ = dual(x)
    assert torch.equal(policy_logits_only, policy_logits_dual)


def test_policy_value_gradients_flow_through_both_heads():
    model = PolicyValueNetwork()
    x = torch.randn((2, NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE))
    labels = torch.tensor([0, NUM_LABELS - 1])
    targets = torch.tensor([[1.0], [-1.0]])

    policy_logits, value = model(x)
    loss = torch.nn.functional.cross_entropy(policy_logits, labels) + torch.nn.functional.mse_loss(value, targets)
    loss.backward()

    assert model.stem_conv.weight.grad is not None and torch.any(model.stem_conv.weight.grad != 0)
    assert model.policy_fc.weight.grad is not None
    assert model.value_fc2.weight.grad is not None and torch.any(model.value_fc2.weight.grad != 0)


def test_policy_value_num_labels_auto_derives_from_board_size():
    model = PolicyValueNetwork(board_size=9)
    x = torch.zeros((1, NUM_CHANNELS, 9, 9))
    policy_logits, value = model(x)
    assert policy_logits.shape == (1, 9 * 9 + 1)
    assert value.shape == (1, 1)


def test_load_policy_value_checkpoint_accepts_a_policy_only_checkpoint(tmp_path):
    # Simulates loading one of the already-deployed Policy-only checkpoints (best.pt /
    # best_9x9.pt / best_13x13.pt): must not raise on the Value Head's missing keys, and
    # must load the shared backbone + Policy Head weights exactly.
    policy_only = PolicyNetwork()
    checkpoint_path = tmp_path / "policy_only.pt"
    torch.save(
        {
            "model_state_dict": policy_only.state_dict(),
            "model_config": {"board_size": BOARD_SIZE, "residual_channels": 64, "residual_blocks": 6},
        },
        checkpoint_path,
    )

    device = torch.device("cpu")
    model, value_head_is_pretrained = load_policy_value_checkpoint(checkpoint_path, device)

    assert value_head_is_pretrained is False
    assert isinstance(model, PolicyValueNetwork)
    for name, param in policy_only.state_dict().items():
        assert torch.equal(param, model.state_dict()[name])

    x = torch.randn((1, NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE))
    policy_logits, value = model(x)
    assert policy_logits.shape == (1, NUM_LABELS)
    assert -1.0 <= value.item() <= 1.0


def test_load_policy_value_checkpoint_accepts_its_own_dual_head_checkpoint(tmp_path):
    dual = PolicyValueNetwork()
    checkpoint_path = tmp_path / "policy_value.pt"
    torch.save(
        {
            "model_state_dict": dual.state_dict(),
            "model_config": {"board_size": BOARD_SIZE, "residual_channels": 64, "residual_blocks": 6},
            "value_head_config": {"value_channels": 4, "hidden_size": 128},
        },
        checkpoint_path,
    )

    model, value_head_is_pretrained = load_policy_value_checkpoint(checkpoint_path, torch.device("cpu"))
    assert value_head_is_pretrained is True
    for name, param in dual.state_dict().items():
        assert torch.equal(param, model.state_dict()[name])
