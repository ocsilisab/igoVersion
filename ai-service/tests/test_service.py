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


def test_ai_move_rejects_wrong_board_size(client):
    health = client.get("/health").json()
    if not health["model_loaded"]:
        pytest.skip("No hay checkpoint entrenado disponible en este entorno.")

    response = client.post(
        "/ai/move",
        json={
            "board": [[None] * 9 for _ in range(9)],
            "board_size": 9,
            "current_player": "black",
            "recent_moves": [],
            "history": [],
        },
    )
    assert response.status_code == 400


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
