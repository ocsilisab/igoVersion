import { createEmptyBoard, getGroup, countLiberties, inBounds, playMove } from "./goEngine.js";
import type { ProblemStone, TesujiProblem } from "./types.js";

interface Shape {
  /** Relative row,col offsets from an anchor point; must describe one orthogonally-connected group. */
  cells: [number, number][];
}

const SHAPES: Shape[] = [
  { cells: [[0, 0]] }, // single stone
  { cells: [[0, 0], [0, 1]] }, // horizontal pair
  { cells: [[0, 0], [1, 0]] }, // vertical pair
  { cells: [[0, 0], [0, 1], [1, 0]] }, // L-tromino
  { cells: [[0, 0], [0, 1], [0, 2]] }, // straight three
  { cells: [[0, 0], [0, 1], [1, 0], [1, 1]] }, // 2x2 square
  { cells: [[0, 0], [0, 1], [0, 2], [0, 3]] }, // straight four
  { cells: [[0, 0], [0, 1], [1, 1], [1, 2]] }, // S/Z tetromino
  { cells: [[0, 0], [1, 0], [2, 0], [0, 1]] }, // L-tetromino
];

export const SMALL_SHAPES = SHAPES.slice(0, 3);
export const MEDIUM_SHAPES = SHAPES.slice(2, 6);
export const LARGE_SHAPES = SHAPES.slice(5, 9);

function shapeAt(shape: Shape, anchorRow: number, anchorCol: number): [number, number][] {
  return shape.cells.map(([dr, dc]) => [anchorRow + dr, anchorCol + dc]);
}

function positionLabel(row: number, col: number, boardSize: number): string {
  const edgeDistance = Math.min(row, col, boardSize - 1 - row, boardSize - 1 - col);
  if (edgeDistance === 0) return "en la esquina";
  if (edgeDistance === 1) return "en el lateral";
  return "en el centro";
}

export interface GeneratedCard {
  name: string;
  description: string;
  problem: TesujiProblem;
}

const CAPTURE_DESCRIPTION =
  "Un grupo sin libertades se captura entero de golpe. Encuentra el único punto que se la quita.";
const ESCAPE_DESCRIPTION =
  "Tu grupo está en atari -- a una libertad de ser capturado. Encuentra el único punto que lo salva.";

/**
 * Places `shape` as one connected black group and fills every one of its liberties except
 * one (chosen deterministically by `solutionIndex`) with white stones. Which framings the
 * remaining point actually supports is then verified by simulating both moves with
 * goEngine.ts, never assumed: white playing there is only offered once removing the black
 * group is confirmed, and black playing there is only offered once the resulting group is
 * confirmed to still have a liberty (a real escape, not a dead end).
 */
function buildAtariCandidate(
  boardSize: number,
  shape: Shape,
  anchorRow: number,
  anchorCol: number,
  solutionIndex: number
): { capture: TesujiProblem; escape: TesujiProblem | null } | null {
  const cells = shapeAt(shape, anchorRow, anchorCol);
  if (cells.some(([r, c]) => !inBounds(r, c, boardSize))) return null;

  const board = createEmptyBoard(boardSize);
  for (const [r, c] of cells) board[r][c] = "black";

  const { liberties } = getGroup(board, cells[0][0], cells[0][1], boardSize);
  const libArr = Array.from(liberties)
    .map((k) => k.split(",").map(Number) as [number, number])
    .sort(([r1, c1], [r2, c2]) => r1 - r2 || c1 - c2);

  if (libArr.length < 2) return null;
  const index = solutionIndex % libArr.length;
  const [solRow, solCol] = libArr[index];
  const toFill = libArr.filter((_, i) => i !== index);

  for (const [r, c] of toFill) board[r][c] = "white";

  // Reject constructions where a filler stone would itself have zero liberties -- it
  // would be an illegal placement in a real game and would corrupt the position.
  for (const [r, c] of toFill) {
    if (countLiberties(board, r, c, boardSize) === 0) return null;
  }

  const stones: ProblemStone[] = [
    ...cells.map(([r, c]) => ({ row: r, col: c, color: "black" as const })),
    ...toFill.map(([r, c]) => ({ row: r, col: c, color: "white" as const })),
  ];

  const afterWhitePlays = playMove(board, solRow, solCol, "white", boardSize);
  const blackSurvivesCapture = cells.some(([r, c]) => afterWhitePlays[r][c] === "black");
  if (blackSurvivesCapture) return null;

  const capture: TesujiProblem = {
    boardSize,
    stones,
    toPlay: "white",
    solution: { row: solRow, col: solCol },
    prompt: "Blancas juega. Captura el grupo negro.",
  };

  const afterBlackPlays = playMove(board, solRow, solCol, "black", boardSize);
  const escapeLiberties = countLiberties(afterBlackPlays, solRow, solCol, boardSize);
  const escape: TesujiProblem | null =
    escapeLiberties > 0
      ? { boardSize, stones, toPlay: "black", solution: { row: solRow, col: solCol }, prompt: "Negras juega. El grupo está en atari — sálvalo." }
      : null;

  return { capture, escape };
}

/**
 * Deterministically and lazily sweeps every (shape, position, which-liberty-is-the-answer)
 * combination on a `boardSize` board, yielding a verified card for each one that produces a
 * valid construction. Always yields in the same order for the same inputs -- callers pull a
 * fixed number of cards per rank level from one shared iterator per tier, so results (and
 * therefore card ids) are stable across app builds.
 */
export function* iterateGeneratedCards(boardSize: number, shapes: Shape[]): Generator<GeneratedCard> {
  for (const shape of shapes) {
    for (let anchorRow = 0; anchorRow < boardSize; anchorRow++) {
      for (let anchorCol = 0; anchorCol < boardSize; anchorCol++) {
        for (let solutionIndex = 0; solutionIndex < 4; solutionIndex++) {
          const built = buildAtariCandidate(boardSize, shape, anchorRow, anchorCol, solutionIndex);
          if (!built) continue;

          const preferEscape = (anchorRow + anchorCol + solutionIndex) % 2 === 0;
          const chosen = preferEscape ? (built.escape ?? built.capture) : built.capture;
          const isCapture = chosen.toPlay === "white";
          const label = positionLabel(chosen.stones[0].row, chosen.stones[0].col, boardSize);

          yield {
            name: isCapture ? `Captura ${label}` : `Escape ${label}`,
            description: isCapture ? CAPTURE_DESCRIPTION : ESCAPE_DESCRIPTION,
            problem: chosen,
          };
        }
      }
    }
  }
}
