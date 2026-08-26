"""Benchmarks direct Policy+Value inference vs Policy+Value+MCTS at several simulation
counts (see Paso 23 of the spec this was built from) -- lets the app pick a simulation
count per difficulty with real numbers instead of a guess.

Usage:
    python -m src.benchmark_mcts --checkpoint checkpoints/policy_value/best.pt --board-size 19
    python -m src.benchmark_mcts --checkpoint checkpoints/policy_value/best.pt --simulations 100 400 1600
"""

import argparse
import resource
import time
from pathlib import Path
from typing import Dict, List, Optional

import torch

from src.adapters.game_adapter import GameStateInput
from src.go_board import empty_board
from src.inference import predict_move_and_value, select_move_with_mcts
from src.mcts import MCTSConfig
from src.model import load_policy_value_checkpoint


def _peak_vram_mb(device: torch.device) -> Optional[float]:
    if device.type != "cuda":
        return None
    return torch.cuda.max_memory_allocated(device) / (1024 ** 2)


def _peak_ram_mb() -> float:
    # ru_maxrss is KB on Linux (including WSL), bytes on macOS -- this service only ever
    # runs on Linux (Docker/Render), so KB is the right unit here.
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def _representative_state(board_size: int) -> GameStateInput:
    """A handful of stones near the center rather than a totally empty board -- closer
    to a real mid-game position (nonzero group sizes, real legal-move filtering cost)
    without needing an actual game record."""
    board = empty_board(board_size)
    mid = board_size // 2
    board[mid][mid] = "black"
    board[mid][mid + 1] = "white"
    board[mid + 1][mid] = "white"
    return GameStateInput(board=board, board_size=board_size, current_player="black")


def benchmark_direct(model, board_size: int, state: GameStateInput, device: torch.device, repeats: int) -> Dict:
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    start = time.perf_counter()
    for _ in range(repeats):
        predict_move_and_value(model, board_size, state, history=[], device=device)
    elapsed = time.perf_counter() - start
    return {
        "mode": "policy_directa",
        "avg_ms_per_move": elapsed / repeats * 1000,
        "moves_per_sec": repeats / elapsed,
        "simulations_per_sec": None,
        "peak_vram_mb": _peak_vram_mb(device),
        "peak_ram_mb": _peak_ram_mb(),
    }


def benchmark_mcts(
    model, board_size: int, state: GameStateInput, device: torch.device, simulations: int, repeats: int
) -> Dict:
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    total_sims = 0
    start = time.perf_counter()
    for _ in range(repeats):
        result = select_move_with_mcts(
            model, board_size, state, history=[], device=device, config=MCTSConfig(simulations=simulations)
        )
        total_sims += result["simulations"]
    elapsed = time.perf_counter() - start
    return {
        "mode": f"mcts_{simulations}",
        "avg_ms_per_move": elapsed / repeats * 1000,
        "moves_per_sec": repeats / elapsed,
        "simulations_per_sec": total_sims / elapsed,
        "peak_vram_mb": _peak_vram_mb(device),
        "peak_ram_mb": _peak_ram_mb(),
    }


def run_benchmark(
    checkpoint_path: Path, board_size: int, simulations: List[int], repeats: int
) -> List[Dict]:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model, value_head_is_pretrained = load_policy_value_checkpoint(checkpoint_path, device)
    if not value_head_is_pretrained:
        raise SystemExit(f"{checkpoint_path} no tiene una Value Head entrenada -- MCTS la necesita.")

    state = _representative_state(board_size)

    results = [benchmark_direct(model, board_size, state, device, repeats=max(repeats, 5))]
    for sims in simulations:
        results.append(benchmark_mcts(model, board_size, state, device, sims, repeats=repeats))
    return results


def print_results(results: List[Dict], device: torch.device) -> None:
    print(f"\nDevice: {device}")
    header = f"{'Modo':<16}{'ms/jugada':>12}{'jugadas/s':>12}{'sims/s':>10}{'VRAM MB':>10}{'RAM MB':>10}"
    print(header)
    print("-" * len(header))
    for r in results:
        sims_per_sec = f"{r['simulations_per_sec']:.1f}" if r["simulations_per_sec"] is not None else "-"
        vram = f"{r['peak_vram_mb']:.1f}" if r["peak_vram_mb"] is not None else "-"
        print(
            f"{r['mode']:<16}{r['avg_ms_per_move']:>12.1f}{r['moves_per_sec']:>12.2f}"
            f"{sims_per_sec:>10}{vram:>10}{r['peak_ram_mb']:>10.1f}"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--checkpoint", type=Path,
        default=Path(__file__).resolve().parent.parent / "checkpoints" / "policy_value" / "best.pt",
    )
    parser.add_argument("--board-size", type=int, default=19)
    parser.add_argument("--simulations", type=int, nargs="+", default=[100, 200, 400, 800, 1600])
    parser.add_argument("--repeats", type=int, default=3, help="Decisions averaged per data point")
    args = parser.parse_args()

    results = run_benchmark(args.checkpoint, args.board_size, args.simulations, args.repeats)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print_results(results, device)


if __name__ == "__main__":
    main()
