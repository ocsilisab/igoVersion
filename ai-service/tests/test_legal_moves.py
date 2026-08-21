from src.go_board import empty_board, serialize_board
from src.legal_moves import is_legal_move


def test_pass_is_always_legal():
    board = empty_board(9)
    assert is_legal_move(board, 9, "black", None, []) is True


def test_empty_point_on_empty_board_is_legal():
    board = empty_board(9)
    assert is_legal_move(board, 9, "black", (4, 4), []) is True


def test_occupied_point_is_illegal():
    board = empty_board(9)
    board[4][4] = "white"
    assert is_legal_move(board, 9, "black", (4, 4), []) is False


def test_suicide_move_is_illegal():
    # White stone alone at a corner with all liberties filled by black except the corner
    # itself -- playing there for white would leave 0 liberties without any capture.
    board = empty_board(9)
    board[0][1] = "black"
    board[1][0] = "black"
    assert is_legal_move(board, 9, "white", (0, 0), []) is False


def test_move_that_captures_and_thereby_gains_liberties_is_legal():
    # Corner point (0,0): playing black there would be suicide on its own (surrounded by
    # white), UNLESS it captures the white stone at (0,1) first (which is itself down to
    # its last liberty, (0,0)) -- after the capture, black has a liberty at (0,1).
    board = empty_board(9)
    board[0][1] = "white"
    board[1][0] = "black"
    board[1][1] = "black"
    assert is_legal_move(board, 9, "black", (0, 0), []) is True


def test_ko_violation_is_illegal():
    board = empty_board(9)
    # Precompute the exact board state that results from playing black at (5, 5) on this
    # board, and inject it as "the position 2 plies ago" -- that's what should make the
    # move illegal, regardless of how the position was actually reached.
    resulting_board = empty_board(9)
    resulting_board[5][5] = "black"
    # history[-2] (two plies ago) must equal the resulting state for this to violate Ko.
    history = [serialize_board(resulting_board), "irrelevant newer state"]
    assert is_legal_move(board, 9, "black", (5, 5), history) is False


def test_move_not_matching_two_plies_ago_is_not_a_ko_violation():
    board = empty_board(9)
    history = [serialize_board(empty_board(9)), "irrelevant newer state"]  # empty != after playing
    assert is_legal_move(board, 9, "black", (5, 5), history) is True


def test_move_allowed_when_history_too_short_for_ko():
    board = empty_board(9)
    assert is_legal_move(board, 9, "black", (4, 4), []) is True
    assert is_legal_move(board, 9, "black", (4, 4), [serialize_board(board)]) is True


def test_serialize_board_format():
    board = empty_board(3)
    board[0][0] = "black"
    board[1][1] = "white"
    assert serialize_board(board) == "B../.W./..."
