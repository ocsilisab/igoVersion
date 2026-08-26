"""Single-move prediction: encode the position -> model -> softmax -> filter out
illegal moves (legal_moves.py) -> top-N legal moves ranked by probability.

Kept separate from service.py (the HTTP layer) so it's directly callable from Python
(tests, scripts, a future local/offline use) without going through HTTP.
"""

from typing import List, Optional, Tuple, TypedDict

import torch
import torch.nn as nn

from src.adapters.game_adapter import (
    NUM_LABELS,
    GameStateInput,
    embed_in_canvas,
    encode_position,
    label_to_move,
)
from src.legal_moves import is_legal_move
from src.mcts import MCTSConfig, make_root_node, run_search, select_final_move
from src.model import PolicyValueNetwork


class ScoredMove(TypedDict):
    move: Optional[dict]  # {"row": int, "col": int} or None for pass
    probability: float


class PredictionResult(TypedDict):
    move: Optional[dict]
    probability: float
    top_moves: List[ScoredMove]


class PredictionWithValueResult(PredictionResult):
    # +1 = very favorable for the player to move now, 0 = balanced, -1 = very
    # unfavorable -- see model.py::PolicyValueNetwork's docstring for the convention.
    value: float


class ScoredMCTSMove(TypedDict):
    move: Optional[dict]
    visits: int
    probability: float  # visits / total root visits -- NOT a network probability
    q_value: float  # how good this move looks for whoever plays it (see mcts.py)
    prior: float  # the Policy Network's raw prior for this move, before search


class MCTSPredictionResult(TypedDict):
    best_move: Optional[dict]
    simulations: int
    root_visits: int
    top_moves: List[ScoredMCTSMove]


def _move_to_json(move) -> Optional[dict]:
    return None if move is None else {"row": move[0], "col": move[1]}


def _encode_for_model(model_board_size: int, state: GameStateInput) -> Tuple[torch.Tensor, bool]:
    """Shared by predict_move and predict_move_and_value: embeds into the model's own
    canvas size when there's no dedicated checkpoint for `state.board_size` (see
    embed_in_canvas). Returns (input tensor with a batch dim, is_native)."""
    is_native = model_board_size == state.board_size
    encode_state = state if is_native else embed_in_canvas(state)
    return encode_position(encode_state).unsqueeze(0), is_native


def _rank_legal_moves(
    probs: torch.Tensor,
    model_board_size: int,
    state: GameStateInput,
    history: List[str],
    is_native: bool,
    top_n: int,
) -> List[ScoredMove]:
    """Shared by predict_move and predict_move_and_value: turns a [NUM_LABELS] softmax
    distribution into the top-N legal moves, ranked descending."""
    ranked_labels = torch.argsort(probs, descending=True).tolist()

    top_moves: List[ScoredMove] = []
    for label in ranked_labels:
        move = label_to_move(label, model_board_size)  # decoded in the model's own space
        if not is_native and move is not None and (move[0] >= state.board_size or move[1] >= state.board_size):
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
    return top_moves


def predict_move(
    model: nn.Module,
    model_board_size: int,
    state: GameStateInput,
    history: List[str],
    device: torch.device,
    top_n: int = 5,
) -> PredictionResult:
    """`history` is the app's own GameState.history (serialized board states, oldest
    first) -- needed for the Ko check inside is_legal_move. `state.board`/`state.board_size`
    must match the current position (the same one `history[-1]` was derived from).

    `model_board_size` is the size `model` was actually trained for -- almost always
    equal to `state.board_size` (the common case: a request for a size that has its own
    checkpoint), encoded/decoded directly with no adaptation. When they differ (no
    dedicated checkpoint yet for `state.board_size`, so the caller passed the 19x19 model
    as a fallback instead), this goes through embed_in_canvas: the model still runs on a
    `model_board_size`x`model_board_size` tensor, but labels are decoded in that same
    (larger) space and anything landing outside the real, smaller board is filtered out
    below, before legality is even checked against the real board/size.

    Works with a plain PolicyNetwork only -- see predict_move_and_value for a
    PolicyValueNetwork that also returns a position evaluation."""
    tensor, is_native = _encode_for_model(model_board_size, state)
    tensor = tensor.to(device)
    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits[0], dim=0)

    top_moves = _rank_legal_moves(probs, model_board_size, state, history, is_native, top_n)
    best = top_moves[0]
    return {"move": best["move"], "probability": best["probability"], "top_moves": top_moves}


def predict_move_and_value(
    model: PolicyValueNetwork,
    model_board_size: int,
    state: GameStateInput,
    history: List[str],
    device: torch.device,
    top_n: int = 5,
) -> PredictionWithValueResult:
    """Same as predict_move, plus a `value` field: the Value Head's evaluation of this
    position from the current player's own perspective (+1 very favorable, 0 balanced,
    -1 very unfavorable -- see model.py::PolicyValueNetwork). Requires a PolicyValueNetwork
    (forward returns (policy_logits, value)), not a plain PolicyNetwork."""
    tensor, is_native = _encode_for_model(model_board_size, state)
    tensor = tensor.to(device)
    with torch.no_grad():
        logits, value = model(tensor)
        probs = torch.softmax(logits[0], dim=0)

    top_moves = _rank_legal_moves(probs, model_board_size, state, history, is_native, top_n)
    best = top_moves[0]
    return {
        "move": best["move"],
        "probability": best["probability"],
        "top_moves": top_moves,
        "value": value.item(),
    }


def select_move_with_mcts(
    model: PolicyValueNetwork,
    board_size: int,
    state: GameStateInput,
    history: List[str],
    device: torch.device,
    config: Optional[MCTSConfig] = None,
    consecutive_passes: int = 0,
    black_captures: int = 0,
    white_captures: int = 0,
    komi: float = 6.5,
    top_n: int = 5,
) -> MCTSPredictionResult:
    """Runs a full MCTS/PUCT search (see mcts.py) rooted at `state` and returns the move
    with the most visits, plus per-move search statistics. Requires a checkpoint trained
    natively for `board_size` -- unlike predict_move/predict_move_and_value, this never
    falls back to embed_in_canvas: MCTS's own rules engine (go_board.py/legal_moves.py)
    always operates on the real board size, so there's nothing to adapt in the search
    itself, but the network must be able to evaluate that exact size directly.

    `consecutive_passes`/`black_captures`/`white_captures`/`komi` seed the root with the
    real game's own state -- without them a fresh root can't correctly detect "one more
    pass ends the game" or score a terminal node the search reaches partway through."""
    cfg = config or MCTSConfig()
    root = make_root_node(
        state,
        history,
        consecutive_passes=consecutive_passes,
        black_captures=black_captures,
        white_captures=white_captures,
    )
    simulations_run = run_search(root, board_size, model, device, cfg, komi=komi)
    best_move = select_final_move(root, cfg.temperature)

    ranked = sorted(root.children.values(), key=lambda child: child.visit_count, reverse=True)
    top_moves: List[ScoredMCTSMove] = [
        {
            "move": _move_to_json(child.move),
            "visits": child.visit_count,
            "probability": (child.visit_count / root.visit_count) if root.visit_count > 0 else 0.0,
            "q_value": -child.q_value,  # negated: value of the move FOR whoever plays it, not for the opponent to move next
            "prior": child.prior,
        }
        for child in ranked[:top_n]
    ]

    return {
        "best_move": _move_to_json(best_move),
        "simulations": simulations_run,
        "root_visits": root.visit_count,
        "top_moves": top_moves,
    }
