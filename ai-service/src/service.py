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
from typing import List, Optional

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.adapters.game_adapter import BOARD_SIZE, SUPPORTED_BOARD_SIZES, GameStateInput, Player, Stone
from src.inference import predict_move
from src.model import load_model_from_checkpoint

SERVICE_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = SERVICE_ROOT / "config.yaml"
DEFAULT_CHECKPOINT_PATH = SERVICE_ROOT / "checkpoints" / "best.pt"


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


class ModelState:
    model = None
    device: torch.device = torch.device("cpu")


state = ModelState()


def _resolve_checkpoint_path() -> Path:
    override = os.environ.get("IGO_AI_CHECKPOINT")
    return Path(override) if override else DEFAULT_CHECKPOINT_PATH


@asynccontextmanager
async def lifespan(_: FastAPI):
    checkpoint_path = _resolve_checkpoint_path()
    if checkpoint_path.exists():
        # Deliberately not fatal when missing (tests instantiate `app` without a
        # trained checkpoint present) -- /ai/move reports a clear 503 instead.
        state.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        state.model = load_model_from_checkpoint(checkpoint_path, state.device)
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
    return {"status": "ok", "model_loaded": state.model is not None, "device": str(state.device)}


@app.post("/ai/move", response_model=MoveResponse)
def ai_move(request: MoveRequest) -> MoveResponse:
    if state.model is None:
        raise HTTPException(
            status_code=503,
            detail=f"Modelo no cargado (no se encontro checkpoint en {_resolve_checkpoint_path()}).",
        )

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

    result = predict_move(
        state.model, game_state, request.history, state.device, top_n=request.top_n
    )
    return result
