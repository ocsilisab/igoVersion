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

export interface TesujiCard {
  id: string;
  /** The tesuji (tactical technique) this card represents, e.g. "Escalera (Shicho)". */
  name: string;
  description: string;
  rank: TesujiRank;
  /** Same convention as ai-service's SGF rank scale: kyu is negative, dan is positive -- lets ranks sort/compare as plain numbers. */
  rankValue: number;
}
