"""HTTP inference service: POST /ai/move.

Run locally with:
    uvicorn src.service:app --host 0.0.0.0 --port 8000

The web app never loads PyTorch directly (see Fase 1 analysis) -- it (or, for the
online mode, a small proxy in api/) would POST the current position here and get back
a ranked list of legal moves. This process is independent of the Vercel deployment;
nothing in api/ or src/ (the TS app) is changed by this file.
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional

import torch
import torch.nn as nn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.adapters.game_adapter import BOARD_SIZE, SUPPORTED_BOARD_SIZES, GameStateInput, Player, Stone
from src.inference import predict_move, predict_move_and_value
from src.model import PolicyValueNetwork, load_model_from_checkpoint, load_policy_value_checkpoint

SERVICE_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = SERVICE_ROOT / "config.yaml"

# One checkpoint filename per board size, all under checkpoints/ -- 19x19 keeps its
# original name (that's the one already deployed) rather than being renamed to match.
CHECKPOINT_FILENAMES: Dict[int, str] = {size: f"best_{size}x{size}.pt" for size in SUPPORTED_BOARD_SIZES}
CHECKPOINT_FILENAMES[BOARD_SIZE] = "best.pt"

# Same per-size naming, one level under checkpoints/policy_value/ (see
# train_policy_value.py) -- optional: the service runs exactly as before (no `value` in
# the response) for any size that doesn't have one yet.
VALUE_CHECKPOINT_FILENAMES = CHECKPOINT_FILENAMES


class PositionPayload(BaseModel):
    row: int
    col: int


class MoveRequest(BaseModel):
    board: List[List[Stone]] = Field(..., description="board_size x board_size, \"black\"/\"white\"/null")
    board_size: int = BOARD_SIZE
    current_player: Player
    recent_moves: List[Optional[PositionPayload]] = Field(
        default_factory=list, description="Most-recent-first, up to 3 entries; null = pass or no earlier move"
    )
    history: List[str] = Field(
        default_factory=list,
        description="Serialized board states (app's GameState.history), oldest first -- needed for the Ko check",
    )
    top_n: int = Field(default=5, ge=1, le=20)


class ScoredMoveResponse(BaseModel):
    move: Optional[PositionPayload]
    probability: float


class MoveResponse(BaseModel):
    move: Optional[PositionPayload]
    probability: float
    top_moves: List[ScoredMoveResponse]
    # Only present (non-null) when a Policy+Value checkpoint is loaded for the requested
    # board size (see VALUE_CHECKPOINT_FILENAMES) -- null for a Policy-only response,
    # which the existing TypeScript client already ignores (see chooseNeuralMove.ts).
    # +1 = very favorable for the player to move now, 0 = balanced, -1 = very unfavorable.
    value: Optional[float] = None


class ModelState:
    models: Dict[int, nn.Module] = {}
    value_models: Dict[int, PolicyValueNetwork] = {}
    device: torch.device = torch.device("cpu")


state = ModelState()


def _resolve_checkpoint_path(board_size: int) -> Path:
    # IGO_AI_CHECKPOINT (no size suffix) is kept as the 19x19 override for backward
    # compatibility with the already-deployed Render setup; every other size gets its own
    # IGO_AI_CHECKPOINT_<size> variable instead.
    env_var = "IGO_AI_CHECKPOINT" if board_size == BOARD_SIZE else f"IGO_AI_CHECKPOINT_{board_size}"
    override = os.environ.get(env_var)
    if override:
        return Path(override)
    return SERVICE_ROOT / "checkpoints" / CHECKPOINT_FILENAMES[board_size]


def _resolve_value_checkpoint_path(board_size: int) -> Path:
    env_var = "IGO_AI_VALUE_CHECKPOINT" if board_size == BOARD_SIZE else f"IGO_AI_VALUE_CHECKPOINT_{board_size}"
    override = os.environ.get(env_var)
    if override:
        return Path(override)
    return SERVICE_ROOT / "checkpoints" / "policy_value" / VALUE_CHECKPOINT_FILENAMES[board_size]


@asynccontextmanager
async def lifespan(_: FastAPI):
    state.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    for board_size in SUPPORTED_BOARD_SIZES:
        checkpoint_path = _resolve_checkpoint_path(board_size)
        if checkpoint_path.exists():
            # Deliberately not fatal when missing (tests instantiate `app` without any
            # trained checkpoint present) -- /ai/move reports a clear 503 instead.
            state.models[board_size] = load_model_from_checkpoint(checkpoint_path, state.device)

        value_checkpoint_path = _resolve_value_checkpoint_path(board_size)
        if value_checkpoint_path.exists():
            value_model, _ = load_policy_value_checkpoint(value_checkpoint_path, state.device)
            state.value_models[board_size] = value_model
    yield


app = FastAPI(title="igoVersion AI service", lifespan=lifespan)

# Local-only dev tool (no auth, no cookies) served from a different port than Vite's
# dev server, hence CORS -- wildcard origin is fine here since nothing here relies on
# credentials and the service isn't meant to be exposed publicly as-is.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model_loaded": bool(state.models),
        "models_loaded": sorted(state.models.keys()),
        # Board sizes that additionally return a `value` field from /ai/move (see
        # MoveResponse) -- empty until at least one checkpoints/policy_value/*.pt exists.
        "value_models_loaded": sorted(state.value_models.keys()),
        "device": str(state.device),
    }


@app.post("/ai/move", response_model=MoveResponse)
def ai_move(request: MoveRequest) -> MoveResponse:
    if request.board_size not in SUPPORTED_BOARD_SIZES:
        raise HTTPException(
            status_code=400,
            detail=f"board_size soportados: {SUPPORTED_BOARD_SIZES}, se recibio {request.board_size}.",
        )
    if len(request.board) != request.board_size or any(len(row) != request.board_size for row in request.board):
        raise HTTPException(status_code=400, detail="Las dimensiones de 'board' no coinciden con board_size.")

    game_state = GameStateInput(
        board=request.board,
        board_size=request.board_size,
        current_player=request.current_player,
        recent_moves=[None if m is None else (m.row, m.col) for m in request.recent_moves],
    )

    # A native Policy+Value checkpoint for this exact size, if one has been trained yet,
    # takes priority (adds `value` to the response). Otherwise falls back to the
    # Policy-only story exactly as before the Value Head existed: a checkpoint native to
    # this size, or the 19x19 one via inference.py::predict_move's embed_in_canvas path.
    value_model = state.value_models.get(request.board_size)
    if value_model is not None:
        return predict_move_and_value(
            value_model, request.board_size, game_state, request.history, state.device, top_n=request.top_n
        )

    model = state.models.get(request.board_size)
    model_board_size = request.board_size
    if model is None:
        model = state.models.get(BOARD_SIZE)
        model_board_size = BOARD_SIZE
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="Modelo no cargado (no se encontro checkpoint para ningun board_size soportado).",
        )

    return predict_move(model, model_board_size, game_state, request.history, state.device, top_n=request.top_n)
