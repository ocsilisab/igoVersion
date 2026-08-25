import { iterateGeneratedCards, SMALL_SHAPES, MEDIUM_SHAPES, LARGE_SHAPES, type GeneratedCard } from "./problemGenerators.js";
import { RANK_LEVELS, type TesujiCard } from "./types.js";

/**
 * Six difficulty tiers spanning the 24 rank levels (4 levels each): board size and shape
 * complexity both grow with rank, from a single stone in the corner of a 5x5 board at 15
 * kyu up to four-stone groups on a 9x9 board at 9 dan.
 */
const TIERS = [
  { boardSize: 5, shapes: SMALL_SHAPES },
  { boardSize: 6, shapes: SMALL_SHAPES },
  { boardSize: 6, shapes: MEDIUM_SHAPES },
  { boardSize: 7, shapes: MEDIUM_SHAPES },
  { boardSize: 8, shapes: LARGE_SHAPES },
  { boardSize: 9, shapes: LARGE_SHAPES },
];
const LEVELS_PER_TIER = 4;

function generateAllTesujiCards(): TesujiCard[] {
  const cards: TesujiCard[] = [];
  const extraCardLevels = new Set(RANK_LEVELS.map((_, i) => i).filter((i) => i % 4 === 0));
  let cursor = 0;
  let tierIterator: Generator<GeneratedCard> | null = null;

  RANK_LEVELS.forEach((rank, levelIndex) => {
    const rankValue = levelIndex < 15 ? -(15 - levelIndex) : levelIndex - 14;
    const cardsInLevel = extraCardLevels.has(levelIndex) ? 7 : 6;

    // A fresh, shared iterator every LEVELS_PER_TIER levels -- shared across those levels
    // so they don't repeat each other's problems, reset at each tier boundary since board
    // size/shapes change.
    if (levelIndex % LEVELS_PER_TIER === 0) {
      const tier = TIERS[levelIndex / LEVELS_PER_TIER];
      tierIterator = iterateGeneratedCards(tier.boardSize, tier.shapes);
    }

    for (let i = 0; i < cardsInLevel; i++) {
      const next = tierIterator!.next();
      if (next.done) {
        throw new Error(`No se pudieron generar suficientes problemas verificados para ${rank}.`);
      }
      const generated = next.value;
      cards.push({
        id: `tesuji-${cursor}`,
        name: generated.name,
        description: generated.description,
        rank,
        rankValue,
        problem: generated.problem,
      });
      cursor++;
    }
  });

  return cards;
}

/** All 150 tesuji problem cards the game defines, evenly spread across the 24 rank levels (6-7 per level). */
export const ALL_TESUJI_CARDS: TesujiCard[] = generateAllTesujiCards();
