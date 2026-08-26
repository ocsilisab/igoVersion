import pytest
from fastapi.testclient import TestClient

from src.adapters.game_adapter import BOARD_SIZE
from src.go_board import empty_board


@pytest.fixture(scope="module")
def client():
    from src.service import app

    with TestClient(app) as c:
        yield c


def _empty_board_json():
    return [[None] * BOARD_SIZE for _ in range(BOARD_SIZE)]


def test_health_endpoint_reports_model_status(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert "status" in body
    assert "model_loaded" in body
    assert "value_models_loaded" in body
    # checkpoints/policy_value/best.pt (19x19 only, trained via train_policy_value.py)
    # is committed to the repo -- 9x9/13x13 don't have one yet.
    assert body["value_models_loaded"] == [BOARD_SIZE]


def test_ai_move_includes_a_value_for_a_size_with_a_trained_value_checkpoint(client):
    health = client.get("/health").json()
    if BOARD_SIZE not in health["value_models_loaded"]:
        pytest.skip("No hay checkpoint Policy+Value entrenado para 19x19 en este entorno.")

    response = client.post(
        "/ai/move",
        json={
            "board": _empty_board_json(),
            "board_size": BOARD_SIZE,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
            "top_n": 3,
        },
    )
    assert response.status_code == 200
    value = response.json()["value"]
    assert value is not None
    assert -1.0 <= value <= 1.0


def test_ai_move_has_no_value_for_a_size_without_a_trained_value_checkpoint(client):
    health = client.get("/health").json()
    board_size = 9
    if board_size not in health["models_loaded"]:
        pytest.skip("No hay checkpoint Policy entrenado para 9x9 en este entorno.")
    if board_size in health["value_models_loaded"]:
        pytest.skip("9x9 ya tiene checkpoint Policy+Value -- este test ya no aplica.")

    response = client.post(
        "/ai/move",
        json={
            "board": [[None] * board_size for _ in range(board_size)],
            "board_size": board_size,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
            "top_n": 3,
        },
    )
    assert response.status_code == 200
    assert response.json()["value"] is None


def test_ai_move_returns_a_legal_move_on_empty_board(client):
    health = client.get("/health").json()
    if not health["model_loaded"]:
        pytest.skip("No hay checkpoint entrenado disponible en este entorno.")

    response = client.post(
        "/ai/move",
        json={
            "board": _empty_board_json(),
            "board_size": BOARD_SIZE,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
            "top_n": 5,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["top_moves"]) == 5
    assert body["move"] == body["top_moves"][0]["move"]
    assert 0.0 <= body["probability"] <= 1.0
    move = body["move"]
    assert move is None or (0 <= move["row"] < BOARD_SIZE and 0 <= move["col"] < BOARD_SIZE)


def test_ai_move_rejects_unsupported_board_size(client):
    health = client.get("/health").json()
    if not health["model_loaded"]:
        pytest.skip("No hay checkpoint entrenado disponible en este entorno.")

    response = client.post(
        "/ai/move",
        json={
            "board": [[None] * 5 for _ in range(5)],
            "board_size": 5,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
        },
    )
    assert response.status_code == 400


@pytest.mark.parametrize("board_size", [9, 13])
def test_ai_move_accepts_smaller_board_sizes(client, board_size):
    # 9x9 and 13x13 run via embed_in_canvas (see game_adapter.py) rather than a
    # dedicated model -- there's only ever the one 19x19-trained checkpoint.
    health = client.get("/health").json()
    if not health["model_loaded"]:
        pytest.skip("No hay checkpoint entrenado disponible en este entorno.")

    response = client.post(
        "/ai/move",
        json={
            "board": [[None] * board_size for _ in range(board_size)],
            "board_size": board_size,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
            "top_n": 5,
        },
    )
    assert response.status_code == 200
    body = response.json()
    for scored in body["top_moves"]:
        move = scored["move"]
        assert move is None or (0 <= move["row"] < board_size and 0 <= move["col"] < board_size)


def test_ai_move_never_suggests_an_occupied_point(client):
    health = client.get("/health").json()
    if not health["model_loaded"]:
        pytest.skip("No hay checkpoint entrenado disponible en este entorno.")

    board = empty_board(BOARD_SIZE)
    for row in range(BOARD_SIZE):
        for col in range(BOARD_SIZE):
            board[row][col] = "black" if (row + col) % 2 == 0 else "white"
    board[9][9] = None
    board[9][10] = None

    response = client.post(
        "/ai/move",
        json={
            "board": board,
            "board_size": BOARD_SIZE,
            "current_player": "white",
            "recent_moves": [],
            "history": [],
            "top_n": 10,
        },
    )
    assert response.status_code == 200
    for scored in response.json()["top_moves"]:
        move = scored["move"]
        if move is not None:
            assert board[move["row"]][move["col"]] is None


def test_ai_move_mcts_returns_sane_result_for_a_native_value_checkpoint(client):
    health = client.get("/health").json()
    if BOARD_SIZE not in health["value_models_loaded"]:
        pytest.skip("No hay checkpoint Policy+Value entrenado para 19x19 en este entorno.")

    response = client.post(
        "/ai/move/mcts",
        json={
            "board": _empty_board_json(),
            "board_size": BOARD_SIZE,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
            "simulations": 10,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["simulations"] == 10
    assert body["root_visits"] == 10
    assert body["top_moves"]
    for scored in body["top_moves"]:
        assert 0.0 <= scored["probability"] <= 1.0
        move = scored["move"]
        assert move is None or (0 <= move["row"] < BOARD_SIZE and 0 <= move["col"] < BOARD_SIZE)


def test_ai_move_mcts_respects_simulations_override(client):
    health = client.get("/health").json()
    if BOARD_SIZE not in health["value_models_loaded"]:
        pytest.skip("No hay checkpoint Policy+Value entrenado para 19x19 en este entorno.")

    response = client.post(
        "/ai/move/mcts",
        json={
            "board": _empty_board_json(),
            "board_size": BOARD_SIZE,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
            "simulations": 5,
        },
    )
    assert response.status_code == 200
    assert response.json()["simulations"] == 5


def test_ai_move_mcts_returns_503_for_a_size_without_a_value_checkpoint(client):
    health = client.get("/health").json()
    board_size = 9
    if board_size in health["value_models_loaded"]:
        pytest.skip("9x9 ya tiene checkpoint Policy+Value -- este test ya no aplica.")

    response = client.post(
        "/ai/move/mcts",
        json={
            "board": [[None] * board_size for _ in range(board_size)],
            "board_size": board_size,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
        },
    )
    assert response.status_code == 503


def test_ai_move_mcts_rejects_unsupported_board_size(client):
    response = client.post(
        "/ai/move/mcts",
        json={
            "board": [[None] * 5 for _ in range(5)],
            "board_size": 5,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
        },
    )
    assert response.status_code == 400


def test_ai_move_mcts_rejects_simulations_above_the_cap(client):
    # This endpoint is public and unauthenticated with no other rate limiting in this
    # service -- an unbounded `simulations` would tie up the shared CPU for minutes per
    # request. Pydantic's le= should reject this before any search ever runs.
    response = client.post(
        "/ai/move/mcts",
        json={
            "board": _empty_board_json(),
            "board_size": BOARD_SIZE,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
            "simulations": 3_000_000,
        },
    )
    assert response.status_code == 422


def test_ai_move_mcts_rejects_time_limit_above_the_cap(client):
    response = client.post(
        "/ai/move/mcts",
        json={
            "board": _empty_board_json(),
            "board_size": BOARD_SIZE,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
            "time_limit_ms": 600_000,
        },
    )
    assert response.status_code == 422


def test_ai_move_rejects_an_oversized_board(client):
    # Same public/unauthenticated/no-rate-limiting reasoning as the simulations/time_limit_ms
    # caps above -- a wildly oversized board should never even reach the handler's own
    # "board_size not supported" check.
    huge_size = BOARD_SIZE + 50
    response = client.post(
        "/ai/move",
        json={
            "board": [[None] * huge_size for _ in range(huge_size)],
            "board_size": huge_size,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
        },
    )
    assert response.status_code == 422


def test_ai_move_rejects_a_ragged_row_above_the_cap(client):
    board = _empty_board_json()
    board[0] = [None] * (BOARD_SIZE + 50)
    response = client.post(
        "/ai/move",
        json={
            "board": board,
            "board_size": BOARD_SIZE,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
        },
    )
    assert response.status_code == 422


def test_ai_move_rejects_history_above_the_cap(client):
    response = client.post(
        "/ai/move",
        json={
            "board": _empty_board_json(),
            "board_size": BOARD_SIZE,
            "current_player": "black",
            "recent_moves": [],
            "history": ["."] * 2001,
        },
    )
    assert response.status_code == 422
