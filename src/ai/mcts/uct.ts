/** Upper Confidence bound applied to Trees — √2 is the standard exploration constant (Kocsis & Szepesvári). */
export const UCT_EXPLORATION = Math.SQRT2;

/**
 * Balances exploitation (win rate so far) against exploration (how rarely this child has
 * been visited relative to its parent). An unvisited child always scores +Infinity so
 * every option gets tried at least once before any get revisited.
 */
export function uctScore(
  childVisits: number,
  childWins: number,
  parentVisits: number,
  explorationConstant: number = UCT_EXPLORATION
): number {
  if (childVisits === 0) return Infinity;
  const exploitation = childWins / childVisits;
  const exploration = explorationConstant * Math.sqrt(Math.log(parentVisits) / childVisits);
  return exploitation + exploration;
}
