import type { Stone } from "./goEngine.js";

/** Ordered from weakest to strongest, matching the standard kyu/dan scale (15 kyu is a
 * beginner, 1 kyu is just below amateur dan level, 9 dan is the top amateur rank). */
export const RANK_LEVELS = [
  "15 kyu",
  "14 kyu",
  "13 kyu",
  "12 kyu",
  "11 kyu",
  "10 kyu",
  "9 kyu",
  "8 kyu",
  "7 kyu",
  "6 kyu",
  "5 kyu",
  "4 kyu",
  "3 kyu",
  "2 kyu",
  "1 kyu",
  "1 dan",
  "2 dan",
  "3 dan",
  "4 dan",
  "5 dan",
  "6 dan",
  "7 dan",
  "8 dan",
  "9 dan",
] as const;

export type TesujiRank = (typeof RANK_LEVELS)[number];

export interface ProblemStone {
  row: number;
  col: number;
  color: Stone;
}

/**
 * A tesuji problem: a fixed board position, whose turn it is, and the one point that
 * solves it. Every problem is generated and verified against goEngine.ts at card-creation
 * time (see problemGenerators.ts) -- the solution is never just asserted, it's the result
 * of actually simulating the move.
 */
export interface TesujiProblem {
  boardSize: number;
  stones: ProblemStone[];
  toPlay: Stone;
  solution: { row: number; col: number };
  /** What the player is asked to do, e.g. "Blancas juega. Captura el grupo negro." */
  prompt: string;
}

export interface TesujiCard {
  id: string;
  name: string;
  description: string;
  rank: TesujiRank;
  /** Same convention as ai-service's SGF rank scale: kyu is negative, dan is positive -- lets ranks sort/compare as plain numbers. */
  rankValue: number;
  problem: TesujiProblem;
}
