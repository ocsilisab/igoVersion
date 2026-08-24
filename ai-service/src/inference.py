"""Single-move prediction: encode the position -> model -> softmax -> filter out
illegal moves (legal_moves.py) -> top-N legal moves ranked by probability.

Kept separate from service.py (the HTTP layer) so it's directly callable from Python
(tests, scripts, a future local/offline use) without going through HTTP.
"""

from typing import List, Optional, TypedDict

import torch
import torch.nn as nn

from src.adapters.game_adapter import (
    BOARD_SIZE,
    NUM_LABELS,
    GameStateInput,
    embed_in_canvas,
    encode_position,
    label_to_move,
)
from src.legal_moves import is_legal_move


class ScoredMove(TypedDict):
    move: Optional[dict]  # {"row": int, "col": int} or None for pass
    probability: float


class PredictionResult(TypedDict):
    move: Optional[dict]
    probability: float
    top_moves: List[ScoredMove]


def _move_to_json(move) -> Optional[dict]:
    return None if move is None else {"row": move[0], "col": move[1]}


def predict_move(
    model: nn.Module,
    state: GameStateInput,
    history: List[str],
    device: torch.device,
    top_n: int = 5,
) -> PredictionResult:
    """`history` is the app's own GameState.history (serialized board states, oldest
    first) -- needed for the Ko check inside is_legal_move. `state.board`/`state.board_size`
    must match the current position (the same one `history[-1]` was derived from).

    `state.board_size` smaller than 19 is handled via embed_in_canvas -- the model always
    runs on a 19x19 tensor, but labels are decoded in that same 19x19 space and anything
    landing outside the real (smaller) board is filtered out below, before legality is
    even checked against the real board/size."""
    tensor = encode_position(embed_in_canvas(state)).unsqueeze(0).to(device)
    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits[0], dim=0)

    ranked_labels = torch.argsort(probs, descending=True).tolist()

    top_moves: List[ScoredMove] = []
    for label in ranked_labels:
        move = label_to_move(label, BOARD_SIZE)  # always decoded in canvas (19x19) space
        if move is not None and (move[0] >= state.board_size or move[1] >= state.board_size):
            continue  # falls outside the real board -- not an actual candidate
        if is_legal_move(state.board, state.board_size, state.current_player, move, history):
            top_moves.append({"move": _move_to_json(move), "probability": probs[label].item()})
            if len(top_moves) >= top_n:
                break

    if not top_moves:
        # Every point on the board is either occupied or illegal (extremely rare, but
        # pass is always legal per is_legal_move so this branch should never trigger --
        # kept as a defensive fallback rather than letting the caller get an empty list).
        top_moves = [{"move": None, "probability": 0.0}]

    best = top_moves[0]
    return {"move": best["move"], "probability": best["probability"], "top_moves": top_moves}
