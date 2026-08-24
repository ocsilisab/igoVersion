from src.preprocess_ogs import make_rank_filter
from src.sgf_utils import ParsedGame


def _game(black_rank, white_rank):
    return ParsedGame(board_size=9, moves=[], black_rank=black_rank, white_rank=white_rank)


def test_rank_filter_requires_both_players_to_meet_the_bar():
    is_dan_game = make_rank_filter(1.0)
    assert is_dan_game(_game("3d", "5d")) is True
    assert is_dan_game(_game("3d", "5k")) is False
    assert is_dan_game(_game("5k", "3d")) is False
    assert is_dan_game(_game("5k", "5k")) is False


def test_rank_filter_treats_missing_rank_as_not_meeting_the_bar():
    is_dan_game = make_rank_filter(1.0)
    assert is_dan_game(_game(None, "5d")) is False
    assert is_dan_game(_game("5d", None)) is False
