import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "../utils/board";
import { tryMove } from "../utils/move";
import { isGameEffectivelyOver, bestBeneficialMove, type ScoredEndgameCandidate } from "./detectGameEnd";
import type { BoardSize } from "../types/game";

const SIZE: BoardSize = 9;

/**
 * A board with one real neutral point (a "dame" at (4,4), walled in on three sides by
 * black and the fourth by white) plus one settled point of territory for each color
 * (the (0,0) and (8,8) corners, each walled off by a single color).
 */
function buildDameBoard() {
  const board = createEmptyBoard(SIZE);
  board[3][4] = "black";
  board[5][4] = "black";
  board[4][3] = "black";
  board[4][5] = "white";
  board[0][1] = "black";
  board[1][0] = "black";
  board[8][7] = "white";
  board[7][8] = "white";
  return board;
}

describe("isGameEffectivelyOver", () => {
  it("is over immediately when there are no candidate moves left", () => {
    const board = createEmptyBoard(SIZE);
    expect(isGameEffectivelyOver(board, SIZE, 0, "black", [])).toBe(true);
  });

  it("is not over while a real dame move is still on the table", () => {
    const board = buildDameBoard();
    const dame = tryMove(board, SIZE, "black", { row: 4, col: 4 }, []);
    expect(dame.ok).toBe(true);
    if (!dame.ok) return;

    const isOver = isGameEffectivelyOver(board, SIZE, 0, "black", [
      { capturedCount: dame.capturedCount, resultingBoard: dame.board },
    ]);

    expect(isOver).toBe(false);
  });

  it("treats filling your own already-settled territory as gaining nothing", () => {
    const board = buildDameBoard();
    const fillOwnTerritory = tryMove(board, SIZE, "black", { row: 0, col: 0 }, []);
    expect(fillOwnTerritory.ok).toBe(true);
    if (!fillOwnTerritory.ok) return;

    const isOver = isGameEffectivelyOver(board, SIZE, 0, "black", [
      { capturedCount: fillOwnTerritory.capturedCount, resultingBoard: fillOwnTerritory.board },
    ]);

    expect(isOver).toBe(true);
  });
});

describe("bestBeneficialMove", () => {
  it("prefers a real dame over filling your own territory", () => {
    const board = buildDameBoard();
    const dame = tryMove(board, SIZE, "black", { row: 4, col: 4 }, []);
    const fillOwnTerritory = tryMove(board, SIZE, "black", { row: 0, col: 0 }, []);
    if (!dame.ok || !fillOwnTerritory.ok) throw new Error("setup moves should be legal");

    const candidates: ScoredEndgameCandidate[] = [
      { position: { row: 4, col: 4 }, capturedCount: dame.capturedCount, resultingBoard: dame.board },
      { position: { row: 0, col: 0 }, capturedCount: fillOwnTerritory.capturedCount, resultingBoard: fillOwnTerritory.board },
    ];

    const best = bestBeneficialMove(board, SIZE, 0, "black", candidates);

    expect(best?.position).toEqual({ row: 4, col: 4 });
  });

  /**
   * Regression test for a real bug: a white group that findHopelessEnemyGroups already
   * recognizes as dead (one small eye, board mostly settled) gets fully credited to black
   * as territory+captures *before* any move is even considered. Actually playing out the
   * finishing capture must not look like extra profit on top of that -- it was already
   * banked. Board: a dense, mostly-settled position (occupancy well above the heuristic's
   * 0.75 gate) with a genuinely alive white group (two real eyes, at (8,1) and (8,4)) plus
   * a separate, genuinely hopeless 3-stone white group (a single eye at (8,8)) with only
   * one real liberty left, also at (8,8).
   */
  it("does not treat finishing the capture of an already-hopeless group as beneficial", () => {
    const board = createEmptyBoard(SIZE);
    for (let row = 0; row <= 6; row++) {
      for (let col = 0; col < SIZE; col++) {
        board[row][col] = "black";
      }
    }
    // Alive white group with two real eyes at (8,1) and (8,4).
    for (const col of [0, 1, 2, 3, 4, 5]) board[7][col] = "white";
    for (const col of [0, 2, 3, 5]) board[8][col] = "white";
    // Black spacers keep the alive group and the hopeless group from merging.
    board[7][6] = "black";
    board[8][6] = "black";
    // Hopeless white group: a single eye at (8,8), one real liberty.
    board[7][7] = "white";
    board[7][8] = "white";
    board[8][7] = "white";

    const finishingCapture = tryMove(board, SIZE, "black", { row: 8, col: 8 }, []);
    expect(finishingCapture.ok).toBe(true);
    if (!finishingCapture.ok) return;
    expect(finishingCapture.capturedCount).toBe(3);

    const candidate: ScoredEndgameCandidate = {
      position: { row: 8, col: 8 },
      capturedCount: finishingCapture.capturedCount,
      resultingBoard: finishingCapture.board,
    };

    expect(isGameEffectivelyOver(board, SIZE, 0, "black", [candidate])).toBe(true);
    expect(bestBeneficialMove(board, SIZE, 0, "black", [candidate])).toBeNull();
  });
});
