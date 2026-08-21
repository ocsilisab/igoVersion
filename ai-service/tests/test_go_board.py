from src.go_board import apply_move, empty_board


def test_place_stone_on_empty_point():
    board = empty_board(9)
    board = apply_move(board, 9, "black", (4, 4))
    assert board[4][4] == "black"


def test_pass_does_not_change_board_and_returns_same_reference():
    board = empty_board(9)
    result = apply_move(board, 9, "black", None)
    assert result is board


def test_single_stone_capture():
    # White stone at (0,0) surrounded by black on both orthogonal neighbors (corner
    # point has exactly 2 neighbors) -- last black move at (0,1) or (1,0) captures it.
    board = empty_board(9)
    board[0][0] = "white"
    board[1][0] = "black"
    board = apply_move(board, 9, "black", (0, 1))
    assert board[0][0] is None
    assert board[0][1] == "black"
    assert board[1][0] == "black"


def test_group_capture_removes_whole_group_not_just_touched_stone():
    board = empty_board(9)
    # White group of two stones (0,0)-(0,1), surrounded except for the final liberty at (0,2).
    board[0][0] = "white"
    board[0][1] = "white"
    board[1][0] = "black"
    board[1][1] = "black"
    board = apply_move(board, 9, "black", (0, 2))
    assert board[0][0] is None
    assert board[0][1] is None
    assert board[0][2] == "black"


def test_move_does_not_mutate_input_board():
    board = empty_board(9)
    original_row = board[4]
    apply_move(board, 9, "black", (4, 4))
    assert board[4][4] is None
    assert board[4] is original_row
