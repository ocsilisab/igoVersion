import time

import pytest
import torch
import torch.nn as nn

from src.adapters.game_adapter import GameStateInput, move_to_label
from src.go_board import empty_board
from src.mcts import (
    MCTSConfig,
    MCTSNode,
    backpropagate,
    expand,
    make_root_node,
    run_search,
    select_final_move,
    select_leaf,
    _puct_score,
    _terminal_value,
)
from src.model import PolicyValueNetwork


class FakeModel(nn.Module):
    """A stand-in for PolicyValueNetwork that returns fixed, fully-controlled outputs --
    lets tests assert exact priors/values instead of whatever a real (even tiny) network
    happens to produce. Tracks how many times it's been called, so tests can assert the
    network is never invoked on a terminal node."""

    def __init__(self, board_size: int, value: float = 0.0, policy_bias: dict | None = None, sleep_seconds: float = 0.0):
        super().__init__()
        self.board_size = board_size
        self.num_labels = board_size * board_size + 1
        self.value = value
        self.policy_bias = policy_bias or {}
        self.sleep_seconds = sleep_seconds
        self.call_count = 0

    def forward(self, x: torch.Tensor):
        self.call_count += 1
        if self.sleep_seconds:
            time.sleep(self.sleep_seconds)
        batch = x.shape[0]
        logits = torch.zeros((batch, self.num_labels))
        for label, val in self.policy_bias.items():
            logits[:, label] = val
        values = torch.full((batch, 1), self.value)
        return logits, values


def _root_state(board_size=9, current_player="black"):
    return GameStateInput(board=empty_board(board_size), board_size=board_size, current_player=current_player)


# ---- Test 1: Node ----


def test_node_creation_defaults():
    node = MCTSNode(
        board=empty_board(9),
        player_to_move="black",
        history=[],
        recent_moves=[],
        consecutive_passes=0,
        black_captures=0,
        white_captures=0,
        parent=None,
        move=None,
        prior=1.0,
    )
    assert node.parent is None
    assert node.children == {}
    assert node.visit_count == 0
    assert node.value_sum == 0.0
    assert node.prior == 1.0
    assert node.q_value == 0.0  # 0/0 guarded, not a ZeroDivisionError


def test_node_parent_and_children_relationship():
    board_size = 9
    model = FakeModel(board_size)
    root = make_root_node(_root_state(board_size), history=[])
    expand(root, board_size, model, torch.device("cpu"))

    assert len(root.children) > 0
    for child in root.children.values():
        assert child.parent is root
        assert child.visit_count == 0
        assert child.value_sum == 0.0


# ---- Test 2: PUCT ----


def test_puct_score_uses_q_p_n_and_c_puct():
    board_size = 9
    parent = MCTSNode(
        board=empty_board(board_size), player_to_move="black", history=[], recent_moves=[],
        consecutive_passes=0, black_captures=0, white_captures=0, parent=None, move=None, prior=1.0,
    )
    parent.visit_count = 100

    child = MCTSNode(
        board=empty_board(board_size), player_to_move="white", history=[], recent_moves=[],
        consecutive_passes=0, black_captures=0, white_captures=0, parent=parent, move=(0, 0), prior=0.4,
    )
    child.visit_count = 3
    child.value_sum = 1.5  # q_value = 0.5, from white's (the child mover's) perspective

    c_puct = 2.0
    expected_u = c_puct * 0.4 * (100 ** 0.5) / (1 + 3)
    expected_score = -0.5 + expected_u  # negated: this move's value for BLACK, the parent's mover
    assert _puct_score(child, parent.visit_count, c_puct) == expected_score


def test_puct_prefers_higher_prior_when_unvisited():
    board_size = 9
    parent = MCTSNode(
        board=empty_board(board_size), player_to_move="black", history=[], recent_moves=[],
        consecutive_passes=0, black_captures=0, white_captures=0, parent=None, move=None, prior=1.0,
    )
    parent.visit_count = 10
    low_prior = MCTSNode(
        board=empty_board(board_size), player_to_move="white", history=[], recent_moves=[],
        consecutive_passes=0, black_captures=0, white_captures=0, parent=parent, move=(0, 0), prior=0.1,
    )
    high_prior = MCTSNode(
        board=empty_board(board_size), player_to_move="white", history=[], recent_moves=[],
        consecutive_passes=0, black_captures=0, white_captures=0, parent=parent, move=(0, 1), prior=0.9,
    )
    assert _puct_score(high_prior, parent.visit_count, 1.5) > _puct_score(low_prior, parent.visit_count, 1.5)


def test_puct_visiting_a_child_reduces_its_own_future_score():
    board_size = 9
    parent = MCTSNode(
        board=empty_board(board_size), player_to_move="black", history=[], recent_moves=[],
        consecutive_passes=0, black_captures=0, white_captures=0, parent=None, move=None, prior=1.0,
    )
    parent.visit_count = 10
    child = MCTSNode(
        board=empty_board(board_size), player_to_move="white", history=[], recent_moves=[],
        consecutive_passes=0, black_captures=0, white_captures=0, parent=parent, move=(0, 0), prior=0.5,
    )
    score_before = _puct_score(child, parent.visit_count, 1.5)
    child.visit_count = 5
    score_after = _puct_score(child, parent.visit_count, 1.5)
    assert score_after < score_before  # more visits -> smaller exploration bonus, all else equal


# ---- Test 3: Perspective ----


def test_backpropagation_flips_sign_at_every_level_as_in_the_spec_example():
    # Grandparent (black to move) -> parent (white to move) -> leaf (black to move).
    grandparent = MCTSNode(
        board=empty_board(9), player_to_move="black", history=[], recent_moves=[],
        consecutive_passes=0, black_captures=0, white_captures=0, parent=None, move=None, prior=1.0,
    )
    parent = MCTSNode(
        board=empty_board(9), player_to_move="white", history=[], recent_moves=[],
        consecutive_passes=0, black_captures=0, white_captures=0, parent=grandparent, move=(0, 0), prior=1.0,
    )
    leaf = MCTSNode(
        board=empty_board(9), player_to_move="black", history=[], recent_moves=[],
        consecutive_passes=0, black_captures=0, white_captures=0, parent=parent, move=(0, 1), prior=1.0,
    )

    backpropagate(leaf, 0.80)  # +0.80 for Black (the leaf's own mover)

    assert leaf.value_sum == 0.80
    assert parent.value_sum == -0.80  # White's turn one level up -- same result, opposite sign
    assert grandparent.value_sum == 0.80  # Black again two levels up
    for node in (leaf, parent, grandparent):
        assert node.visit_count == 1


def test_select_move_with_mcts_perspective_end_to_end():
    # A model that always says the position is great (+0.9) for whoever is *next* to
    # move there. So after playing any move, it's the opponent who inherits that +0.9 --
    # meaning the move itself must read as bad (~-0.9) for whoever just played it. This
    # is the correctly-flipped result, not a bug: it's exactly why the sign flip exists.
    from src.inference import select_move_with_mcts

    board_size = 9
    model = FakeModel(board_size, value=0.9)
    state = _root_state(board_size)
    result = select_move_with_mcts(
        model, board_size, state, history=[], device=torch.device("cpu"),
        config=MCTSConfig(simulations=20, c_puct=1.5),
    )
    assert result["top_moves"]
    for scored in result["top_moves"]:
        assert scored["q_value"] == pytest.approx(-0.9, abs=1e-3)


# ---- Test 4: Illegal moves ----


def test_expand_never_creates_a_child_on_an_occupied_point():
    board_size = 9
    board = empty_board(board_size)
    board[2][2] = "white"
    model = FakeModel(board_size)
    root = make_root_node(GameStateInput(board=board, board_size=board_size, current_player="black"), history=[])
    expand(root, board_size, model, torch.device("cpu"))
    assert (2, 2) not in root.children


def test_full_search_never_selects_an_illegal_move():
    board_size = 9
    board = empty_board(board_size)
    for row in range(board_size):
        for col in range(board_size):
            board[row][col] = "black" if (row + col) % 2 == 0 else "white"
    board[2][2] = None  # the only empty point besides pass
    model = PolicyValueNetwork(board_size=board_size, residual_channels=4, residual_blocks=1)
    model.eval()
    root = make_root_node(GameStateInput(board=board, board_size=board_size, current_player="black"), history=[])
    run_search(root, board_size, model, torch.device("cpu"), MCTSConfig(simulations=30))

    legal_moves = set(root.children.keys())
    assert legal_moves.issubset({(2, 2), None})


# ---- Test 5: PASS ----


def test_pass_is_a_normal_child_and_can_be_selected():
    board_size = 9
    model = FakeModel(board_size, policy_bias={board_size * board_size: 100.0})  # PASS label dominates
    root = make_root_node(_root_state(board_size), history=[])
    run_search(root, board_size, model, torch.device("cpu"), MCTSConfig(simulations=10))

    assert None in root.children
    assert select_final_move(root, temperature=0.0) is None  # PASS wins on visit count


# ---- Test 6: Terminal ----


def test_terminal_node_does_not_invoke_the_network():
    board_size = 9
    model = FakeModel(board_size)
    node = MCTSNode(
        board=empty_board(board_size), player_to_move="black", history=[], recent_moves=[],
        consecutive_passes=2, black_captures=0, white_captures=0, parent=None, move=None, prior=1.0,
        is_terminal=True, is_expanded=True,
    )
    value = _terminal_value(node, board_size, komi=6.5)
    assert model.call_count == 0
    assert value == -1.0  # empty board, black to move, white wins by komi alone


def test_search_stops_growing_past_a_terminal_child():
    board_size = 9
    model = FakeModel(board_size, policy_bias={board_size * board_size: 100.0})  # search drives straight to PASS, PASS
    root = make_root_node(_root_state(board_size), history=[])
    run_search(root, board_size, model, torch.device("cpu"), MCTSConfig(simulations=15))

    pass_child = root.children[None]
    assert pass_child.is_terminal is False  # one pass isn't enough
    double_pass = pass_child.children.get(None)
    assert double_pass is not None
    assert double_pass.is_terminal is True
    assert double_pass.children == {}  # never expanded


# ---- Test 7: Policy ----


def test_children_priors_come_from_the_policy_distribution():
    board_size = 9
    label_a = move_to_label((0, 0), board_size)
    label_b = move_to_label((0, 1), board_size)
    model = FakeModel(board_size, policy_bias={label_a: 5.0, label_b: 1.0})
    root = make_root_node(_root_state(board_size), history=[])
    expand(root, board_size, model, torch.device("cpu"))

    assert root.children[(0, 0)].prior > root.children[(0, 1)].prior
    assert root.children[(0, 0)].prior > root.children[(1, 1)].prior  # an unbiased label


def test_priors_are_renormalized_over_legal_moves_only():
    board_size = 9
    board = empty_board(board_size)
    board[0][0] = "black"  # (0,0) occupied -- its raw policy mass must be excluded, not just zeroed
    model = FakeModel(board_size)
    root = make_root_node(GameStateInput(board=board, board_size=board_size, current_player="white"), history=[])
    expand(root, board_size, model, torch.device("cpu"))

    total_prior = sum(child.prior for child in root.children.values())
    assert abs(total_prior - 1.0) < 1e-4
    assert (0, 0) not in root.children


# ---- Test 8: Value ----


def test_expand_returns_the_value_networks_output_for_that_node():
    board_size = 9
    model = FakeModel(board_size, value=0.42)
    root = make_root_node(_root_state(board_size), history=[])
    value = expand(root, board_size, model, torch.device("cpu"))
    assert value == pytest.approx(0.42)


def test_leaf_value_drives_backpropagated_totals():
    board_size = 9
    model = FakeModel(board_size, value=-0.6)
    root = make_root_node(_root_state(board_size), history=[])
    run_search(root, board_size, model, torch.device("cpu"), MCTSConfig(simulations=1))
    # Exactly one simulation: selects a child of the (already expanded) root, expands it
    # (value -0.6 for that child's own mover), backpropagates up to root with a flip.
    visited_children = [c for c in root.children.values() if c.visit_count > 0]
    assert len(visited_children) == 1
    assert visited_children[0].value_sum == pytest.approx(-0.6)
    assert root.value_sum == pytest.approx(0.6)  # flipped once, back to root


# ---- Test 9: Backpropagation ----


def test_backpropagation_accumulates_across_multiple_simulations():
    board_size = 9
    model = FakeModel(board_size, value=0.5)
    root = make_root_node(_root_state(board_size), history=[])
    run_search(root, board_size, model, torch.device("cpu"), MCTSConfig(simulations=8))

    assert root.visit_count == 8
    total_child_visits = sum(c.visit_count for c in root.children.values())
    assert total_child_visits == 8
    assert root.q_value == pytest.approx(-0.5)  # every child is +0.5 for itself -> -0.5 for root


# ---- Configurable simulations / time limit ----


def test_time_limit_stops_the_search_before_the_simulation_budget():
    board_size = 9
    model = FakeModel(board_size, sleep_seconds=0.05)  # ~50ms per network call
    root = make_root_node(_root_state(board_size), history=[])
    # Budget for at most ~4 simulations' worth of network calls; asking for 1000 would
    # take ~50s without the time limit.
    simulations_run = run_search(
        root, board_size, model, torch.device("cpu"), MCTSConfig(simulations=1000, time_limit_ms=200)
    )
    assert 0 < simulations_run < 1000


def test_without_a_time_limit_the_full_simulation_budget_runs():
    board_size = 9
    model = FakeModel(board_size)
    root = make_root_node(_root_state(board_size), history=[])
    simulations_run = run_search(root, board_size, model, torch.device("cpu"), MCTSConfig(simulations=12, time_limit_ms=None))
    assert simulations_run == 12


# ---- Test 10: Integration ----


def test_full_search_on_a_real_position_returns_a_legal_sensible_result():
    board_size = 9
    model = PolicyValueNetwork(board_size=board_size, residual_channels=8, residual_blocks=2)
    model.eval()
    board = empty_board(board_size)
    board[4][4] = "black"
    state = GameStateInput(board=board, board_size=board_size, current_player="white")

    from src.inference import select_move_with_mcts

    result = select_move_with_mcts(
        model, board_size, state, history=[], device=torch.device("cpu"),
        config=MCTSConfig(simulations=40, c_puct=1.5),
    )

    assert result["simulations"] == 40
    assert result["root_visits"] == 40
    assert result["top_moves"]
    best = result["best_move"]
    assert best is None or (0 <= best["row"] < board_size and 0 <= best["col"] < board_size)
    if best is not None:
        assert board[best["row"]][best["col"]] is None
    visits_sum = sum(m["visits"] for m in result["top_moves"])
    assert visits_sum <= result["root_visits"]
