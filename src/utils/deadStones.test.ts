import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "./board";
import { suggestDeadGroups, toggleDeadStoneGroup } from "./deadStones";
import type { BoardSize } from "../types/game";

const SIZE: BoardSize = 9;

describe("suggestDeadGroups", () => {
  it("does not suggest a group whose territory is one big undivided region", () => {
    // A typical settled game: one wall, one large open territory behind it -- exactly the
    // shape that used to be miscounted as "only 1 eye" and wrongly marked dead.
    const board = createEmptyBoard(SIZE);
    for (let col = 0; col < SIZE; col++) board[2][col] = "black";
    // Rows 0-1 (18 empty points) are enclosed by row 2 alone.

    const suggested = suggestDeadGroups(board, SIZE);

    expect(suggested.size).toBe(0);
  });

  it("suggests lone stones dead when their only territory is a single tiny shared point", () => {
    const board = createEmptyBoard(SIZE);
    board[0][1] = "black";
    board[1][0] = "black";
    board[8][8] = "white"; // keeps the rest of the board neutral instead of "black territory"

    const suggested = suggestDeadGroups(board, SIZE);

    expect(suggested.has("0,1")).toBe(true);
    expect(suggested.has("1,0")).toBe(true);
  });

  it("does not suggest a group with two separate small eyes", () => {
    const board = createEmptyBoard(SIZE);
    for (const row of [0, 1, 2, 3, 4, 5, 6]) {
      for (let col = 0; col < SIZE; col++) board[row][col] = "white";
    }
    for (const col of [0, 1, 2, 3, 4, 5, 6, 7, 8]) board[7][col] = col <= 5 ? "black" : "white";
    board[8][0] = "black";
    board[8][2] = "black";
    board[8][3] = "black";
    board[8][5] = "black";
    for (const col of [6, 7, 8]) board[8][col] = "white";
    // (8,1) and (8,4) are left empty -- two separate one-point eyes bordered only by black.

    const suggested = suggestDeadGroups(board, SIZE);

    expect(suggested.has("7,0")).toBe(false);
    expect(suggested.has("8,0")).toBe(false);
  });
});

describe("toggleDeadStoneGroup", () => {
  it("marks the whole connected group dead, then revives it on a second toggle", () => {
    const board = createEmptyBoard(SIZE);
    board[4][4] = "black";
    board[4][5] = "black";

    const marked = toggleDeadStoneGroup(board, SIZE, { row: 4, col: 4 }, new Set());
    expect(marked.has("4,4")).toBe(true);
    expect(marked.has("4,5")).toBe(true);

    const revived = toggleDeadStoneGroup(board, SIZE, { row: 4, col: 4 }, marked);
    expect(revived.size).toBe(0);
  });

  it("leaves the set unchanged when clicking an empty point", () => {
    const board = createEmptyBoard(SIZE);
    const deadStones = new Set<string>();

    const result = toggleDeadStoneGroup(board, SIZE, { row: 0, col: 0 }, deadStones);

    expect(result).toBe(deadStones);
  });
});
