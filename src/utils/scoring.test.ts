import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "./board";
import { calculateScore, removeDeadStones } from "./scoring";
import type { BoardSize } from "../types/game";

const SIZE: BoardSize = 9;

describe("calculateScore", () => {
  it("awards only komi on a totally empty board", () => {
    const board = createEmptyBoard(SIZE);

    const result = calculateScore(board, SIZE, 0, 0, 6.5);

    expect(result.blackScore).toBe(0);
    expect(result.whiteScore).toBe(6.5);
    expect(result.winner).toBe("white");
  });

  it("counts an enclosed region as territory only for the color that alone borders it", () => {
    const board = createEmptyBoard(SIZE);
    // Corner (0,0) is walled off by black alone.
    board[0][1] = "black";
    board[1][0] = "black";
    // Far corner (8,8) is walled off by white alone.
    board[8][8] = "white";

    const result = calculateScore(board, SIZE, 0, 0, 6.5);

    expect(result.blackTerritoryPoints).toEqual([{ row: 0, col: 0 }]);
    expect(result.blackTerritory).toBe(1);
    // Everything else touches both colors (or neither), so it stays neutral.
    expect(result.whiteTerritory).toBe(0);
    expect(result.blackScore).toBe(3); // 2 stones + 1 territory point
    expect(result.whiteScore).toBe(7.5); // 1 stone + 6.5 komi
    expect(result.winner).toBe("white");
  });

  it("declares a draw when both scores tie exactly", () => {
    const board = createEmptyBoard(SIZE);
    board[0][0] = "black";
    board[8][8] = "white";

    const result = calculateScore(board, SIZE, 0, 0, 0);

    expect(result.blackScore).toBe(result.whiteScore);
    expect(result.winner).toBe("draw");
  });
});

describe("removeDeadStones", () => {
  it("removes only the marked stones and tallies each color separately", () => {
    const board = createEmptyBoard(SIZE);
    board[1][1] = "black";
    board[2][2] = "white";
    board[3][3] = "black";

    const result = removeDeadStones(board, new Set(["1,1", "2,2"]));

    expect(result.board[1][1]).toBeNull();
    expect(result.board[2][2]).toBeNull();
    expect(result.board[3][3]).toBe("black");
    expect(result.deadBlack).toBe(1);
    expect(result.deadWhite).toBe(1);
  });
});
