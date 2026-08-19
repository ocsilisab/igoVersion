import type { Player, TeamRoster } from "../types/game";

/**
 * Alternates newly-added players onto black/white so team sizes stay as even as
 * possible; black (which always moves first) picks up the extra seat when the total
 * is odd. Used by every local (solo/AI) setup screen's live team-split preview.
 */
export function splitIntoTeams(playerNames: string[]): TeamRoster {
  const black: string[] = [];
  const white: string[] = [];
  playerNames.forEach((name, index) => {
    (index % 2 === 0 ? black : white).push(name);
  });
  return { black, white };
}

/** The roster member whose turn it is right now for `color`, given the rotation index. */
export function activeTeamMember(teams: TeamRoster, turnIndex: Record<Player, number>, color: Player): string | undefined {
  const roster = teams[color];
  if (roster.length === 0) return undefined;
  return roster[turnIndex[color] % roster.length];
}
