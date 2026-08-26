import pytest
import torch

from src.adapters.game_adapter import BOARD_SIZE, GameStateInput
from src.go_board import empty_board
from src.inference import predict_move, predict_move_and_value
from src.model import PolicyNetwork, PolicyValueNetwork


def tiny_model(board_size=BOARD_SIZE):
    torch.manual_seed(0)
    model = PolicyNetwork(board_size=board_size, residual_channels=4, residual_blocks=1)
    model.eval()
    return model


def tiny_policy_value_model(board_size=BOARD_SIZE):
    torch.manual_seed(0)
    model = PolicyValueNetwork(board_size=board_size, residual_channels=4, residual_blocks=1)
    model.eval()
    return model


def test_predict_move_returns_up_to_top_n_moves():
    model = tiny_model()
    state = GameStateInput(board=empty_board(BOARD_SIZE), board_size=BOARD_SIZE, current_player="black")
    result = predict_move(model, BOARD_SIZE, state, history=[], device=torch.device("cpu"), top_n=5)
    assert len(result["top_moves"]) == 5
    assert result["move"] == result["top_moves"][0]["move"]
    assert result["probability"] == result["top_moves"][0]["probability"]


def test_predict_move_never_suggests_an_occupied_point():
    model = tiny_model()
    board = empty_board(BOARD_SIZE)
    # Occupy every point except two, so predictions are forced into a tiny legal set.
    for row in range(BOARD_SIZE):
        for col in range(BOARD_SIZE):
            board[row][col] = "black" if (row + col) % 2 == 0 else "white"
    board[10][10] = None
    board[10][11] = None

    state = GameStateInput(board=board, board_size=BOARD_SIZE, current_player="black")
    result = predict_move(model, BOARD_SIZE, state, history=[], device=torch.device("cpu"), top_n=10)

    for scored in result["top_moves"]:
        move = scored["move"]
        if move is not None:
            assert board[move["row"]][move["col"]] is None


def test_predict_move_probabilities_are_descending():
    model = tiny_model()
    state = GameStateInput(board=empty_board(BOARD_SIZE), board_size=BOARD_SIZE, current_player="white")
    result = predict_move(model, BOARD_SIZE, state, history=[], device=torch.device("cpu"), top_n=5)
    probs = [m["probability"] for m in result["top_moves"]]
    assert probs == sorted(probs, reverse=True)


def test_predict_move_json_shape_uses_row_col_or_none_for_pass():
    model = tiny_model()
    state = GameStateInput(board=empty_board(BOARD_SIZE), board_size=BOARD_SIZE, current_player="black")
    result = predict_move(model, BOARD_SIZE, state, history=[], device=torch.device("cpu"), top_n=3)
    for scored in result["top_moves"]:
        move = scored["move"]
        assert move is None or (isinstance(move, dict) and set(move.keys()) == {"row", "col"})


@pytest.mark.parametrize("board_size", [9, 13])
def test_predict_move_on_smaller_board_stays_within_bounds(board_size):
    # No dedicated checkpoint for this size -- the 19x19 model runs via embed_in_canvas.
    # Every suggested move must still land inside the *real* (smaller) board, never in
    # the empty padding.
    model = tiny_model()
    state = GameStateInput(board=empty_board(board_size), board_size=board_size, current_player="black")
    result = predict_move(model, BOARD_SIZE, state, history=[], device=torch.device("cpu"), top_n=10)
    for scored in result["top_moves"]:
        move = scored["move"]
        if move is not None:
            assert 0 <= move["row"] < board_size
            assert 0 <= move["col"] < board_size


def test_predict_move_on_smaller_board_never_suggests_an_occupied_point():
    model = tiny_model()
    board_size = 9
    board = empty_board(board_size)
    for row in range(board_size):
        for col in range(board_size):
            board[row][col] = "black" if (row + col) % 2 == 0 else "white"
    board[4][4] = None
    board[4][5] = None

    state = GameStateInput(board=board, board_size=board_size, current_player="black")
    result = predict_move(model, BOARD_SIZE, state, history=[], device=torch.device("cpu"), top_n=5)

    for scored in result["top_moves"]:
        move = scored["move"]
        if move is not None:
            assert board[move["row"]][move["col"]] is None


def test_predict_move_uses_a_native_model_directly_with_no_embedding():
    # When a dedicated checkpoint exists for the requested size, predict_move must encode
    # and decode natively (no embed_in_canvas padding, no out-of-bounds filtering needed).
    board_size = 9
    model = tiny_model(board_size=board_size)
    board = empty_board(board_size)
    board[3][3] = "black"

    state = GameStateInput(board=board, board_size=board_size, current_player="white")
    result = predict_move(model, board_size, state, history=[], device=torch.device("cpu"), top_n=5)

    assert len(result["top_moves"]) == 5
    for scored in result["top_moves"]:
        move = scored["move"]
        if move is not None:
            assert 0 <= move["row"] < board_size
            assert 0 <= move["col"] < board_size
            assert board[move["row"]][move["col"]] is None


def test_predict_move_and_value_includes_a_value_field_within_tanh_range():
    model = tiny_policy_value_model()
    state = GameStateInput(board=empty_board(BOARD_SIZE), board_size=BOARD_SIZE, current_player="black")
    result = predict_move_and_value(model, BOARD_SIZE, state, history=[], device=torch.device("cpu"), top_n=5)
    assert -1.0 <= result["value"] <= 1.0


def test_predict_move_and_value_move_selection_matches_predict_move():
    # Same trunk + Policy Head weights (same seed) -- the chosen move and its top_moves
    # must be identical whether obtained via predict_move or predict_move_and_value; only
    # the extra `value` field should differ between the two calls.
    policy_only = tiny_model()
    dual = tiny_policy_value_model()
    state = GameStateInput(board=empty_board(BOARD_SIZE), board_size=BOARD_SIZE, current_player="white")

    policy_result = predict_move(policy_only, BOARD_SIZE, state, history=[], device=torch.device("cpu"), top_n=5)
    dual_result = predict_move_and_value(dual, BOARD_SIZE, state, history=[], device=torch.device("cpu"), top_n=5)

    assert policy_result["move"] == dual_result["move"]
    assert policy_result["top_moves"] == dual_result["top_moves"]
    assert "value" not in policy_result
    assert isinstance(dual_result["value"], float)


def test_predict_move_and_value_on_smaller_board_stays_within_bounds():
    model = tiny_policy_value_model()
    board_size = 9
    state = GameStateInput(board=empty_board(board_size), board_size=board_size, current_player="black")
    result = predict_move_and_value(model, BOARD_SIZE, state, history=[], device=torch.device("cpu"), top_n=10)
    for scored in result["top_moves"]:
        move = scored["move"]
        if move is not None:
            assert 0 <= move["row"] < board_size
            assert 0 <= move["col"] < board_size
