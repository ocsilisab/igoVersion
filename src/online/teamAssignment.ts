import type { Player } from "../types/game.js";

/**
 * Simulates the same "smaller team, ties to black" rule the server uses when seats get
 * claimed one-by-one (see gameRepo.ts::joinPendingGame), so all N seats can be
 * pre-assigned a team at creation time and the creator's live preview always matches
 * what actually gets created. Seat 0 is always the creator, already on `creatorColor`.
 */
export function assignSeatTeams(creatorColor: Player, totalPlayers: number): Player[] {
  const teams: Player[] = [creatorColor];
  for (let i = 1; i < totalPlayers; i++) {
    const blackCount = teams.filter((t) => t === "black").length;
    const whiteCount = teams.filter((t) => t === "white").length;
    teams.push(blackCount <= whiteCount ? "black" : "white");
  }
  return teams;
}
