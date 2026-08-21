"""Single-move prediction: encode the position -> model -> softmax -> filter out
illegal moves (legal_moves.py) -> top-N legal moves ranked by probability.

Kept separate from service.py (the HTTP layer) so it's directly callable from Python
(tests, scripts, a future local/offline use) without going through HTTP.
"""

from typing import List, Optional, TypedDict

import torch
import torch.nn as nn

from src.adapters.game_adapter import NUM_LABELS, GameStateInput, encode_position, label_to_move
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
    must match the current position (the same one `history[-1]` was derived from)."""
    tensor = encode_position(state).unsqueeze(0).to(device)
    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits[0], dim=0)

    ranked_labels = torch.argsort(probs, descending=True).tolist()

    top_moves: List[ScoredMove] = []
    for label in ranked_labels:
        move = label_to_move(label, state.board_size)
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
