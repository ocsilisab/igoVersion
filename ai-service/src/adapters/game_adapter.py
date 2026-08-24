"""Adapter between the web app's game-state shape and the neural network's tensor input.

Mirrors src/types/game.ts on the TypeScript side (Board = Stone[][], Player, Position),
without importing anything from that project — this is the seam the spec asks for: the
web app never needs to know about PyTorch, and this module never needs to know about
React/Vercel/Supabase. `game_state_from_json` is what an HTTP handler in Fase 5 will call
after `json.loads`-ing the request body.

Started 19x19-only (matching the original pro-game dataset, see ai-service/config.yaml)
but every function here now works natively for any size in SUPPORTED_BOARD_SIZES — a
9x9 or 13x13 checkpoint, once one exists, trains and runs through the exact same code as
the 19x19 one. embed_in_canvas is the separate, explicit adaptation used only when no
dedicated checkpoint exists yet for the requested size.
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

# 9x9 and 13x13 are supported at inference time only, via embed_in_canvas below -- the
# model itself is still the one and only checkpoint trained on 19x19 games; see that
# function's docstring for why this is the only way to run it on a smaller board at all.
SUPPORTED_BOARD_SIZES = (9, 13, BOARD_SIZE)


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
    if state.board_size not in SUPPORTED_BOARD_SIZES:
        raise ValueError(
            f"board_size no soportado: {state.board_size}. Soportados: {SUPPORTED_BOARD_SIZES}."
        )
    if len(state.board) != state.board_size or any(len(row) != state.board_size for row in state.board):
        raise ValueError("Las dimensiones del tablero no coinciden con board_size.")
    if len(state.recent_moves) > NUM_RECENT_MOVES:
        raise ValueError(f"recent_moves no puede tener mas de {NUM_RECENT_MOVES} elementos.")


def encode_position(state: GameStateInput) -> torch.Tensor:
    """Converts a GameStateInput into a [6, board_size, board_size] float32 tensor (no
    batch dim — the DataLoader/inference caller is responsible for stacking/batching).
    Works natively for any of SUPPORTED_BOARD_SIZES -- there's no single fixed shape here
    since each board size trains (or, for 9x9/13x13 without their own checkpoint yet, is
    embedded into) its own model; see embed_in_canvas for that adaptation."""
    _validate(state)
    size = state.board_size
    tensor = torch.zeros((NUM_CHANNELS, size, size), dtype=torch.float32)

    for row in range(size):
        board_row = state.board[row]
        for col in range(size):
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


def embed_in_canvas(state: GameStateInput) -> GameStateInput:
    """Places a smaller board's stones in the top-left corner of a full 19x19 canvas, so
    the trained policy network -- whose final layer (model.py::PolicyNetwork.policy_fc)
    is a Linear layer sized for exactly board_size=19 and cannot accept any other input
    shape at all, retrained or not -- can be run on a 9x9 or 13x13 game without
    retraining. `state.board_size` is returned unchanged (still 9/13); only the encoded
    tensor sees a 19x19 canvas. If already 19x19, returns `state` as-is.

    This is a best-effort adaptation, not an equivalent one: the model was trained
    exclusively on full 19x19 professional games, where the whole board is in play from
    move one. A 9x9 game embedded in one corner, with the rest of the canvas frozen empty
    for the entire game, looks like nothing in its training data -- expect noticeably
    weaker play than on 19x19, not just "the same model, smaller board."
    """
    if state.board_size == BOARD_SIZE:
        return state

    canvas: Board = [[None] * BOARD_SIZE for _ in range(BOARD_SIZE)]
    for row in range(state.board_size):
        canvas[row][: state.board_size] = state.board[row]

    return GameStateInput(
        board=canvas,
        board_size=BOARD_SIZE,
        current_player=state.current_player,
        # Coordinates are unchanged: the corner embedding uses no offset, so a move at
        # (r, c) on the real board is still at (r, c) on the canvas.
        recent_moves=state.recent_moves,
    )


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
