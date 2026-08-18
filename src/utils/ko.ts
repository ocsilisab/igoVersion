/**
 * Basic Ko rule: a move is illegal if the resulting board position is identical to the
 * position that existed immediately before the opponent's previous move (two plies back).
 * `history` holds one serialized board state per move already played, plus the initial
 * empty board at index 0 — so `history[history.length - 2]` is exactly that position.
 */
export function violatesKo(candidateBoardState: string, history: string[]): boolean {
  if (history.length < 2) return false;
  const stateTwoPliesAgo = history[history.length - 2];
  return candidateBoardState === stateTwoPliesAgo;
}
