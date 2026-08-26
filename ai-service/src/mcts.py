"""Monte Carlo Tree Search with PUCT, on top of the existing PolicyValueNetwork.

Uses the app's own rules engine end to end -- go_board.py for move application/capture,
legal_moves.py for occupancy/suicide/Ko, scoring.py for the terminal result -- the exact
same functions inference.py's plain predict_move already uses, not a second
reimplementation of Go's rules. See inference.py::evaluate_batch/select_move_with_mcts
for the entry points a caller actually uses; this module is the tree/search internals.

Perspective convention (documented once, here, since it's the easiest place to get
wrong -- see AlphaZero's own papers for the same convention): every node's
`value_sum`/`q_value` is stored from the perspective of *that node's own*
`player_to_move` -- "how good is this position for whoever is about to move here".
Since a child's mover is always the opponent of its parent's mover, PUCT selection at a
node negates each child's Q before comparing (see `_puct_score`), and backpropagation
flips the sign at every step up the tree (see `backpropagate`). A leaf value of +0.80
for Black-to-move becomes -0.80 one level up, where White is to move, and +0.80 again
one level above that -- exactly the example in the spec this module was built from.
"""

import math
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import torch

from src.adapters.game_adapter import Board, GameStateInput, Player, Position, encode_position, move_to_label
from src.go_board import apply_move, serialize_board
from src.legal_moves import is_legal_move
from src.model import PolicyValueNetwork
from src.scoring import calculate_score


def _opponent(player: Player) -> Player:
    return "white" if player == "black" else "black"


@dataclass
class MCTSConfig:
    simulations: int = 400
    c_puct: float = 1.5
    time_limit_ms: Optional[int] = None
    # 0 (or anything below _TEMPERATURE_EPSILON) = deterministic: always the most-visited
    # move. >0 samples proportionally to visit_count**(1/temperature) -- see
    # select_final_move -- useful later for self-play exploration, not normal play.
    temperature: float = 0.0


_TEMPERATURE_EPSILON = 1e-3


@dataclass
class MCTSNode:
    board: Board
    player_to_move: Player
    history: List[str]  # serialized board states, oldest first, last entry == this node's own board
    recent_moves: List[Optional[Position]]  # most-recent-first, up to 3 -- see game_adapter.NUM_RECENT_MOVES
    consecutive_passes: int
    black_captures: int
    white_captures: int
    parent: Optional["MCTSNode"]
    move: Optional[Position]  # the move that was played to reach this node from its parent; None for the root too
    prior: float  # P(s,a): this node's prior probability, as assigned by the parent's expansion
    children: Dict[Optional[Position], "MCTSNode"] = field(default_factory=dict)
    visit_count: int = 0  # N
    value_sum: float = 0.0  # W
    is_expanded: bool = False
    is_terminal: bool = False
    terminal_value: Optional[float] = None  # cached once computed -- see _terminal_value

    @property
    def q_value(self) -> float:  # Q = W / N
        return self.value_sum / self.visit_count if self.visit_count > 0 else 0.0


def make_root_node(
    state: GameStateInput,
    history: List[str],
    consecutive_passes: int = 0,
    black_captures: int = 0,
    white_captures: int = 0,
) -> MCTSNode:
    """The root inherits the *real* game's history/captures/pass-count directly from the
    request -- everything an MCTSNode needs that isn't already in `state` itself."""
    return MCTSNode(
        board=state.board,
        player_to_move=state.current_player,
        history=list(history),
        recent_moves=list(state.recent_moves),
        consecutive_passes=consecutive_passes,
        black_captures=black_captures,
        white_captures=white_captures,
        parent=None,
        move=None,
        prior=1.0,
    )


def _puct_score(child: MCTSNode, parent_visits: int, c_puct: float) -> float:
    # -child.q_value: child.q_value is from the child's own mover's perspective, the
    # opponent of whoever is choosing at the parent -- see module docstring.
    q = -child.q_value
    u = c_puct * child.prior * math.sqrt(parent_visits) / (1 + child.visit_count)
    return q + u


def select_leaf(root: MCTSNode, c_puct: float) -> MCTSNode:
    """Walks down from `root` following the highest-PUCT child at each step, until an
    unexpanded node or a terminal node is reached."""
    node = root
    while node.is_expanded and not node.is_terminal and node.children:
        node = max(node.children.values(), key=lambda child: _puct_score(child, node.visit_count, c_puct))
    return node


def _legal_moves(board: Board, size: int, player: Player, history: List[str]) -> List[Optional[Position]]:
    """Every board point plus PASS, filtered down to what legal_moves.py actually
    accepts -- PASS is always legal, so this list is never empty."""
    candidates: List[Optional[Position]] = [(row, col) for row in range(size) for col in range(size)]
    candidates.append(None)
    return [pos for pos in candidates if is_legal_move(board, size, player, pos, history)]


def _count_stones(board: Board, player: Player) -> int:
    return sum(1 for row in board for stone in row if stone == player)


def expand(node: MCTSNode, board_size: int, model: PolicyValueNetwork, device: torch.device) -> float:
    """Runs Policy+Value once on `node`'s position, creates one child per legal move
    (priors renormalized over just the legal subset), and returns the value for `node`
    itself (its own mover's perspective) to feed into backpropagation."""
    state = GameStateInput(
        board=node.board, board_size=board_size, current_player=node.player_to_move, recent_moves=node.recent_moves
    )
    probs, values = evaluate_batch(model, [state], device)
    probs = probs[0]
    value = values[0].item()

    legal = _legal_moves(node.board, board_size, node.player_to_move, node.history)
    legal_labels = [move_to_label(pos, board_size) for pos in legal]
    legal_probs = probs[legal_labels]
    total = legal_probs.sum().item()
    normalized = (legal_probs / total) if total > 0 else torch.full_like(legal_probs, 1.0 / len(legal_labels))

    opponent = _opponent(node.player_to_move)
    for pos, prior in zip(legal, normalized.tolist()):
        if pos is None:
            child_board = node.board
            captures_this_move = 0
        else:
            child_board = apply_move(node.board, board_size, node.player_to_move, pos)
            captures_this_move = _count_stones(node.board, opponent) - _count_stones(child_board, opponent)

        child_black_captures = node.black_captures + (captures_this_move if node.player_to_move == "black" else 0)
        child_white_captures = node.white_captures + (captures_this_move if node.player_to_move == "white" else 0)
        child_consecutive_passes = node.consecutive_passes + 1 if pos is None else 0

        child = MCTSNode(
            board=child_board,
            player_to_move=opponent,
            history=node.history + [serialize_board(child_board)],
            recent_moves=([pos] + node.recent_moves)[:3],
            consecutive_passes=child_consecutive_passes,
            black_captures=child_black_captures,
            white_captures=child_white_captures,
            parent=node,
            move=pos,
            prior=prior,
        )
        if child_consecutive_passes >= 2:
            child.is_terminal = True
            child.is_expanded = True
        node.children[pos] = child

    node.is_expanded = True
    return value


def _terminal_value(node: MCTSNode, board_size: int, komi: float) -> float:
    """The actual game result (see scoring.py), from node.player_to_move's perspective
    -- computed once per terminal node and cached, since it never changes."""
    if node.terminal_value is not None:
        return node.terminal_value
    result = calculate_score(node.board, board_size, node.black_captures, node.white_captures, komi)
    if result.winner == "draw":
        value = 0.0
    else:
        value = 1.0 if result.winner == node.player_to_move else -1.0
    node.terminal_value = value
    return value


def backpropagate(leaf: MCTSNode, leaf_value: float) -> None:
    """Updates visit_count/value_sum from `leaf` up to the root, flipping the value's
    sign at every step -- see the module docstring's perspective convention."""
    value = leaf_value
    node: Optional[MCTSNode] = leaf
    while node is not None:
        node.visit_count += 1
        node.value_sum += value
        node = node.parent
        value = -value


def evaluate_batch(
    model: PolicyValueNetwork, states: List[GameStateInput], device: torch.device
):
    """The batching seam (see spec Paso 14): every network call in this module goes
    through here, already accepting a list of states -- this phase calls it with exactly
    one state per expansion (sequential MCTS, no virtual loss), but a future batched
    search (collecting several in-flight leaves before calling the network) only needs
    to change *how many* states are passed in, not this function itself."""
    tensors = torch.stack([encode_position(s) for s in states]).to(device)
    with torch.no_grad():
        policy_logits, values = model(tensors)
        probs = torch.softmax(policy_logits, dim=1)
    return probs.cpu(), values.cpu().squeeze(1)


def run_search(
    root: MCTSNode,
    board_size: int,
    model: PolicyValueNetwork,
    device: torch.device,
    config: MCTSConfig,
    komi: float = 6.5,
) -> int:
    """Runs up to `config.simulations` simulations (Selection -> Expansion -> Evaluation
    -> Backpropagation), stopping early at `config.time_limit_ms` if set. Mutates `root`
    in place (grows its tree) and returns how many simulations actually ran."""
    if not root.is_expanded:
        if root.consecutive_passes >= 2:
            root.is_terminal = True
        else:
            # Populates root.children (with their priors) so selection has somewhere to
            # go on simulation 1 -- deliberately NOT backpropagated, so root.visit_count
            # ends up exactly `simulations_run` (each simulation's own backprop passes
            # through root exactly once), not simulations_run + 1.
            expand(root, board_size, model, device)

    deadline = time.monotonic() + config.time_limit_ms / 1000 if config.time_limit_ms else None
    simulations_run = 0
    while simulations_run < config.simulations:
        if deadline is not None and time.monotonic() >= deadline:
            break
        leaf = select_leaf(root, config.c_puct)
        if leaf.is_terminal:
            value = _terminal_value(leaf, board_size, komi)
        else:
            value = expand(leaf, board_size, model, device)
        backpropagate(leaf, value)
        simulations_run += 1

    return simulations_run


def select_final_move(root: MCTSNode, temperature: float) -> Optional[Position]:
    """Picks a move from the root's children by visit count -- never by raw prior or
    Q alone (see spec Paso 11). Deterministic (most-visited) at/near temperature 0;
    otherwise samples proportionally to visit_count**(1/temperature), for future
    self-play-style exploration."""
    if not root.children:
        return None
    if temperature < _TEMPERATURE_EPSILON:
        return max(root.children.items(), key=lambda item: item[1].visit_count)[0]

    moves = list(root.children.keys())
    weights = [root.children[m].visit_count ** (1.0 / temperature) for m in moves]
    total = sum(weights)
    if total <= 0:
        return max(root.children.items(), key=lambda item: item[1].visit_count)[0]
    probs = [w / total for w in weights]
    return moves[torch.multinomial(torch.tensor(probs), 1).item()]
