import pytest
import torch

from src.adapters.game_adapter import (
    BOARD_SIZE,
    NUM_CHANNELS,
    NUM_LABELS,
    PASS_LABEL,
    GameStateInput,
    embed_in_canvas,
    encode_position,
    game_state_from_json,
    label_to_move,
    move_to_label,
)


def empty_board():
    return [[None] * BOARD_SIZE for _ in range(BOARD_SIZE)]


def test_encode_shape_and_dtype():
    state = GameStateInput(board=empty_board(), board_size=BOARD_SIZE, current_player="black")
    tensor = encode_position(state)
    assert tensor.shape == (NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE)
    assert tensor.dtype == torch.float32


def test_stone_channels_are_isolated_per_color():
    board = empty_board()
    board[3][4] = "black"
    board[10][10] = "white"
    state = GameStateInput(board=board, board_size=BOARD_SIZE, current_player="white")
    tensor = encode_position(state)
    assert tensor[0, 3, 4] == 1.0
    assert tensor[1, 10, 10] == 1.0
    assert tensor[0].sum() == 1.0
    assert tensor[1].sum() == 1.0


def test_current_player_channel_black_to_move():
    state = GameStateInput(board=empty_board(), board_size=BOARD_SIZE, current_player="black")
    tensor = encode_position(state)
    assert torch.all(tensor[2] == 1.0)


def test_current_player_channel_white_to_move():
    state = GameStateInput(board=empty_board(), board_size=BOARD_SIZE, current_player="white")
    tensor = encode_position(state)
    assert torch.all(tensor[2] == 0.0)


def test_recent_moves_channel_order():
    state = GameStateInput(
        board=empty_board(),
        board_size=BOARD_SIZE,
        current_player="black",
        recent_moves=[(0, 0), (18, 18), None],
    )
    tensor = encode_position(state)
    assert tensor[3, 0, 0] == 1.0
    assert tensor[3].sum() == 1.0
    assert tensor[4, 18, 18] == 1.0
    assert tensor[4].sum() == 1.0
    assert tensor[5].sum() == 0.0  # pass o sin jugada anterior -> canal vacio


def test_recent_moves_fewer_than_three_pads_with_empty_channels():
    state = GameStateInput(
        board=empty_board(), board_size=BOARD_SIZE, current_player="black", recent_moves=[(5, 5)]
    )
    tensor = encode_position(state)
    assert tensor[3, 5, 5] == 1.0
    assert tensor[4].sum() == 0.0
    assert tensor[5].sum() == 0.0


def test_rejects_wrong_board_size():
    small_board = [[None] * 9 for _ in range(9)]
    state = GameStateInput(board=small_board, board_size=9, current_player="black")
    with pytest.raises(ValueError):
        encode_position(state)


def test_rejects_mismatched_board_dimensions():
    bad_board = [[None] * BOARD_SIZE for _ in range(BOARD_SIZE - 1)]
    state = GameStateInput(board=bad_board, board_size=BOARD_SIZE, current_player="black")
    with pytest.raises(ValueError):
        encode_position(state)


def test_rejects_too_many_recent_moves():
    state = GameStateInput(
        board=empty_board(),
        board_size=BOARD_SIZE,
        current_player="black",
        recent_moves=[(0, 0), (1, 1), (2, 2), (3, 3)],
    )
    with pytest.raises(ValueError):
        encode_position(state)


@pytest.mark.parametrize("row,col", [(0, 0), (18, 18), (5, 12), (0, 18), (18, 0)])
def test_move_label_roundtrip(row, col):
    label = move_to_label((row, col))
    assert label_to_move(label) == (row, col)


def test_pass_label_roundtrip():
    assert move_to_label(None) == PASS_LABEL
    assert label_to_move(PASS_LABEL) is None


def test_label_out_of_range_raises():
    with pytest.raises(ValueError):
        label_to_move(NUM_LABELS)
    with pytest.raises(ValueError):
        label_to_move(-1)


def test_game_state_from_json_matches_direct_construction():
    board = empty_board()
    board[2][3] = "black"
    payload = {
        "board": board,
        "board_size": BOARD_SIZE,
        "current_player": "white",
        "recent_moves": [{"row": 2, "col": 3}, None],
    }
    state = game_state_from_json(payload)
    direct = GameStateInput(
        board=board, board_size=BOARD_SIZE, current_player="white", recent_moves=[(2, 3), None]
    )
    assert torch.equal(encode_position(state), encode_position(direct))


def test_game_state_from_json_defaults_recent_moves_to_empty():
    payload = {"board": empty_board(), "board_size": BOARD_SIZE, "current_player": "black"}
    state = game_state_from_json(payload)
    assert state.recent_moves == []


def test_embed_in_canvas_leaves_a_19x19_state_untouched():
    state = GameStateInput(board=empty_board(), board_size=BOARD_SIZE, current_player="black")
    assert embed_in_canvas(state) is state


def test_embed_in_canvas_places_smaller_board_in_top_left_corner():
    small_board = [[None] * 9 for _ in range(9)]
    small_board[0][0] = "black"
    small_board[8][8] = "white"
    state = GameStateInput(board=small_board, board_size=9, current_player="white", recent_moves=[(8, 8)])

    canvas_state = embed_in_canvas(state)

    assert canvas_state.board_size == BOARD_SIZE
    assert canvas_state.current_player == "white"
    assert canvas_state.recent_moves == [(8, 8)]  # no offset -- same coordinates
    assert canvas_state.board[0][0] == "black"
    assert canvas_state.board[8][8] == "white"
    # Everything outside the embedded 9x9 corner stays empty.
    assert canvas_state.board[9][0] is None
    assert canvas_state.board[0][9] is None
    assert canvas_state.board[18][18] is None


def test_embed_in_canvas_is_a_valid_19x19_input():
    small_board = [[None] * 13 for _ in range(13)]
    small_board[5][5] = "black"
    state = GameStateInput(board=small_board, board_size=13, current_player="black")
    tensor = encode_position(embed_in_canvas(state))
    assert tensor.shape == (NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE)
    assert tensor[0, 5, 5] == 1.0
