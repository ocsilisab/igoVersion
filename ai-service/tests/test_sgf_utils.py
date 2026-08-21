from src.sgf_utils import parse_sgf_game, sgfmill_point_to_app_position


def test_sgfmill_corner_conversion_matches_app_top_left_origin():
    # Empirically verified against sgfmill directly: SGF "aa" -> sgfmill (18, 0) on a
    # 19x19 board. The app renders row 0 at the top (GoBoard.tsx), so that must become
    # app position (0, 0) -- the top-left corner in both.
    assert sgfmill_point_to_app_position((18, 0), 19) == (0, 0)
    assert sgfmill_point_to_app_position((0, 18), 19) == (18, 18)
    assert sgfmill_point_to_app_position(None, 19) is None


def test_parse_sgf_game_basic_sequence():
    raw = b"(;GM[1]FF[4]SZ[19];B[aa];W[ss];B[ab];W[])"
    game = parse_sgf_game(raw)
    assert game is not None
    assert game.board_size == 19
    assert game.moves == [
        ("black", (0, 0)),
        ("white", (18, 18)),
        ("black", (1, 0)),
        ("white", None),  # pass
    ]


def test_parse_sgf_game_rejects_non_19x19():
    raw = b"(;GM[1]FF[4]SZ[9];B[ee])"
    assert parse_sgf_game(raw) is None


def test_parse_sgf_game_rejects_handicap_games():
    raw = b"(;GM[1]FF[4]SZ[19]HA[2]AB[pd][dp];W[dd])"
    assert parse_sgf_game(raw) is None


def test_parse_sgf_game_rejects_malformed_input():
    assert parse_sgf_game(b"not an sgf file") is None


def test_parse_sgf_game_ignores_variations_keeps_mainline():
    # (;B[aa](;W[ss])(;W[gg])) -- two variations after black's move; sgfmill's
    # get_main_sequence() should only follow the first one.
    raw = b"(;GM[1]FF[4]SZ[19];B[aa](;W[ss])(;W[gg]))"
    game = parse_sgf_game(raw)
    assert game is not None
    assert game.moves == [("black", (0, 0)), ("white", (18, 18))]
