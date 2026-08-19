import type { Player } from "../types/game.js";
import type { OnlineGame, OnlinePlayer, YouInfo } from "./types.js";

/** Active (not-left) members of `team`, in join order — used for both display and turn rotation. */
export function activeRoster(game: OnlineGame, team: Player): OnlinePlayer[] {
  return game.players.filter((p) => p.team === team && p.active).sort((a, b) => a.turnOrder - b.turnOrder);
}

/** The specific player whose turn it is right now for `team`, or null if that team has no one left. */
export function getActivePlayer(game: OnlineGame, team: Player): OnlinePlayer | null {
  const roster = activeRoster(game, team);
  if (roster.length === 0) return null;
  const turnIndex = team === "black" ? game.blackTurnIndex : game.whiteTurnIndex;
  return roster[turnIndex % roster.length];
}

/** Team rosters as plain display-name arrays, for the same GameInfo roster row the local modes use. */
export function rosterNames(game: OnlineGame): { black: string[]; white: string[] } {
  return {
    black: activeRoster(game, "black").map((p) => p.displayName),
    white: activeRoster(game, "white").map((p) => p.displayName),
  };
}

/** Builds the `you` half of a GameResponse/GameMutationResponse for `guestId` against `game`. */
export function buildYouInfo(game: OnlineGame, guestId: string | null): YouInfo {
  const me = guestId ? game.players.find((p) => p.guestId === guestId && p.active) : undefined;
  const team = me?.team ?? null;
  const isYourTurn = Boolean(
    guestId &&
      team &&
      game.status === "playing" &&
      !game.isScoring &&
      game.currentPlayer === team &&
      getActivePlayer(game, team)?.guestId === guestId
  );

  return {
    guestId: guestId ?? "",
    userType: "guest",
    team,
    displayName: me?.displayName ?? "",
    isCreator: me?.isCreator ?? false,
    isYourTurn,
  };
}
