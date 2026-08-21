"""Adapter between the web app's game-state shape and the neural network's tensor input.

Mirrors src/types/game.ts on the TypeScript side (Board = Stone[][], Player, Position),
without importing anything from that project — this is the seam the spec asks for: the
web app never needs to know about PyTorch, and this module never needs to know about
React/Vercel/Supabase. `game_state_from_json` is what an HTTP handler in Fase 5 will call
after `json.loads`-ing the request body.

v1 scope: 19x19 only, matching the pro-game dataset (see ai-service/config.yaml). The app
itself also supports 9x9/13x13, but this model does not — see Fase 1 analysis.
"""

from dataclasses import dataclass, field
from typing import List, Literal, Optional, Tuple

import torch

Player = Literal["black", "white"]
Stone = Optional[Player]
Board = List[List[Stone]]
Position = Tuple[int, int]  # (row, col) — same field order as the app's {row, col}

BOARD_SIZE = 19
NUM_CHANNELS = 6
NUM_RECENT_MOVES = 3
PASS_LABEL = BOARD_SIZE * BOARD_SIZE  # 361
NUM_LABELS = PASS_LABEL + 1  # 362


@dataclass
class GameStateInput:
    board: Board
    board_size: int
    current_player: Player
    # Most-recent-first: recent_moves[0] is the last move played, [1] the one before that,
    # [2] the one before that. `None` covers both "that ply was a pass" and "the game
    # hadn't reached that far back yet" — both render as an empty channel, since neither
    # case has a board position to mark.
    recent_moves: List[Optional[Position]] = field(default_factory=list)


def _validate(state: GameStateInput) -> None:
    if state.board_size != BOARD_SIZE:
        raise ValueError(
            f"Este modelo solo soporta tableros de {BOARD_SIZE}x{BOARD_SIZE}; "
            f"se recibio board_size={state.board_size}."
        )
    if len(state.board) != BOARD_SIZE or any(len(row) != BOARD_SIZE for row in state.board):
        raise ValueError("Las dimensiones del tablero no coinciden con board_size.")
    if len(state.recent_moves) > NUM_RECENT_MOVES:
        raise ValueError(f"recent_moves no puede tener mas de {NUM_RECENT_MOVES} elementos.")


def encode_position(state: GameStateInput) -> torch.Tensor:
    """Converts a GameStateInput into a [6, 19, 19] float32 tensor (no batch dim — the
    DataLoader/inference caller is responsible for stacking/batching)."""
    _validate(state)
    tensor = torch.zeros((NUM_CHANNELS, BOARD_SIZE, BOARD_SIZE), dtype=torch.float32)

    for row in range(BOARD_SIZE):
        board_row = state.board[row]
        for col in range(BOARD_SIZE):
            stone = board_row[col]
            if stone == "black":
                tensor[0, row, col] = 1.0
            elif stone == "white":
                tensor[1, row, col] = 1.0

    if state.current_player == "black":
        tensor[2].fill_(1.0)

    for i, move in enumerate(state.recent_moves[:NUM_RECENT_MOVES]):
        if move is not None:
            row, col = move
            tensor[3 + i, row, col] = 1.0

    return tensor


def move_to_label(move: Optional[Position], board_size: int = BOARD_SIZE) -> int:
    """(row, col) -> flat index in [0, board_size^2); None (pass) -> board_size^2."""
    if move is None:
        return board_size * board_size
    row, col = move
    return row * board_size + col


def label_to_move(label: int, board_size: int = BOARD_SIZE) -> Optional[Position]:
    """Inverse of move_to_label."""
    pass_label = board_size * board_size
    if label < 0 or label > pass_label:
        raise ValueError(f"Label fuera de rango [0, {pass_label}]: {label}")
    if label == pass_label:
        return None
    return (label // board_size, label % board_size)


def game_state_from_json(data: dict) -> GameStateInput:
    """Parses the JSON body the web app will POST in Fase 5 (board as nested
    "black"/"white"/null, recent_moves as a list of {"row","col"} or null) into a
    GameStateInput."""
    raw_recent = data.get("recent_moves", [])
    recent_moves: List[Optional[Position]] = [
        None if m is None else (m["row"], m["col"]) for m in raw_recent[:NUM_RECENT_MOVES]
    ]
    return GameStateInput(
        board=data["board"],
        board_size=data["board_size"],
        current_player=data["current_player"],
        recent_moves=recent_moves,
    )
