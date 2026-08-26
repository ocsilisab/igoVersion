from src.go_board import empty_board
from src.scoring import calculate_score


def test_empty_board_white_wins_by_komi_alone():
    board = empty_board(9)
    result = calculate_score(board, 9, black_captures=0, white_captures=0, komi=6.5)
    assert result.black_score == 0
    assert result.white_score == 6.5
    assert result.winner == "white"


def test_zero_komi_empty_board_is_a_draw():
    board = empty_board(9)
    result = calculate_score(board, 9, black_captures=0, white_captures=0, komi=0)
    assert result.winner == "draw"


def test_territory_awarded_only_to_the_single_bordering_color():
    # A black stone on one side, empty region entirely surrounded by black -- that
    # region is black territory. No white stones at all.
    board = empty_board(5)
    board[0][0] = "black"
    board[0][1] = "black"
    board[1][0] = "black"
    board[1][1] = "black"
    # Point (4,4) borders nothing black or white directly but the whole rest of the
    # board is one connected empty region bordering only black -- so it's all black's.
    result = calculate_score(board, 5, black_captures=0, white_captures=0, komi=0)
    assert result.black_stones == 4
    assert result.white_stones == 0
    assert result.black_territory == 5 * 5 - 4  # every empty point, all bordering only black
    assert result.white_territory == 0
    assert result.winner == "black"


def test_neutral_region_bordering_both_colors_awards_no_territory():
    board = empty_board(5)
    board[2][0] = "black"
    board[2][4] = "white"
    result = calculate_score(board, 5, black_captures=0, white_captures=0, komi=0)
    # The single big empty region touches both colors -- neutral, no territory for either.
    assert result.black_territory == 0
    assert result.white_territory == 0


def test_captures_count_toward_score():
    board = empty_board(5)
    result = calculate_score(board, 5, black_captures=3, white_captures=0, komi=0)
    assert result.black_score == 3
    assert result.winner == "black"


def test_higher_score_wins_regardless_of_which_side():
    board = empty_board(5)
    for row in range(5):
        for col in range(3):
            board[row][col] = "black"
    result = calculate_score(board, 5, black_captures=0, white_captures=0, komi=0)
    assert result.winner == "black"
    assert result.black_score > result.white_score
