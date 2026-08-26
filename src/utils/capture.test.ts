import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "./board";
import { removeDeadGroups } from "./capture";
import type { BoardSize } from "../types/game";

const SIZE: BoardSize = 9;

describe("removeDeadGroups", () => {
  it("captures a single stone surrounded on all four sides", () => {
    const board = createEmptyBoard(SIZE);
    board[4][4] = "white";
    board[3][4] = "black";
    board[5][4] = "black";
    board[4][3] = "black";
    board[4][5] = "black";

    const result = removeDeadGroups(board, "white", SIZE);

    expect(result.capturedCount).toBe(1);
    expect(result.board[4][4]).toBeNull();
  });

  it("captures a whole multi-stone group at once, not stone by stone", () => {
    const board = createEmptyBoard(SIZE);
    // A 2-stone white group with black surrounding every external liberty.
    board[4][4] = "white";
    board[4][5] = "white";
    board[3][4] = "black";
    board[3][5] = "black";
    board[5][4] = "black";
    board[5][5] = "black";
    board[4][3] = "black";
    board[4][6] = "black";

    const result = removeDeadGroups(board, "white", SIZE);

    expect(result.capturedCount).toBe(2);
    expect(result.board[4][4]).toBeNull();
    expect(result.board[4][5]).toBeNull();
  });

  it("leaves a group with at least one liberty untouched", () => {
    const board = createEmptyBoard(SIZE);
    board[4][4] = "white";
    board[3][4] = "black";
    board[5][4] = "black";
    board[4][3] = "black";
    // (4,5) left empty -- one real liberty remains.

    const result = removeDeadGroups(board, "white", SIZE);

    expect(result.capturedCount).toBe(0);
    expect(result.board[4][4]).toBe("white");
  });

  it("only removes groups of the requested color", () => {
    const board = createEmptyBoard(SIZE);
    board[0][0] = "black";
    board[0][1] = "white";
    board[1][0] = "white";
    // Black's lone corner stone has zero liberties, but we only asked to sweep white.

    const result = removeDeadGroups(board, "white", SIZE);

    expect(result.capturedCount).toBe(0);
    expect(result.board[0][0]).toBe("black");
  });
});
