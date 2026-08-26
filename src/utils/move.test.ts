import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "./board";
import { tryMove } from "./move";
import { serializeBoard } from "./board";
import type { BoardSize } from "../types/game";

const SIZE: BoardSize = 9;

describe("tryMove", () => {
  it("allows placing a stone on an empty point", () => {
    const board = createEmptyBoard(SIZE);
    const result = tryMove(board, SIZE, "black", { row: 4, col: 4 }, []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.board[4][4]).toBe("black");
      expect(result.capturedCount).toBe(0);
    }
  });

  it("rejects placing a stone on an occupied point", () => {
    const board = createEmptyBoard(SIZE);
    board[4][4] = "black";

    const result = tryMove(board, SIZE, "white", { row: 4, col: 4 }, []);

    expect(result).toEqual({ ok: false, reason: "occupied" });
  });

  it("captures a lone enemy stone when its last liberty is filled", () => {
    const board = createEmptyBoard(SIZE);
    board[4][4] = "white";
    board[3][4] = "black";
    board[5][4] = "black";
    board[4][3] = "black";

    const result = tryMove(board, SIZE, "black", { row: 4, col: 5 }, []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.capturedCount).toBe(1);
      expect(result.board[4][4]).toBeNull();
    }
  });

  it("rejects a suicide move that captures nothing", () => {
    const board = createEmptyBoard(SIZE);
    board[3][4] = "white";
    board[5][4] = "white";
    board[4][3] = "white";
    board[4][5] = "white";
    // Each white neighbor keeps liberties of its own, so none of them get captured --
    // black's stone at (4,4) would have zero liberties and gain nothing in return.

    const result = tryMove(board, SIZE, "black", { row: 4, col: 4 }, []);

    expect(result).toEqual({ ok: false, reason: "suicide" });
  });

  it("rejects a move that recreates the board state from two plies ago (ko)", () => {
    // Classic ko shape:
    //   . B W .
    //   B W . W
    //   . B W .
    const board = createEmptyBoard(SIZE);
    board[0][1] = "black";
    board[0][2] = "white";
    board[1][0] = "black";
    board[1][1] = "white";
    board[1][3] = "white";
    board[2][1] = "black";
    board[2][2] = "white";

    const history = [serializeBoard(board)];

    // Black captures the lone white stone at (1,1).
    const blackCapture = tryMove(board, SIZE, "black", { row: 1, col: 2 }, history);
    expect(blackCapture.ok).toBe(true);
    if (!blackCapture.ok) return;
    expect(blackCapture.capturedCount).toBe(1);
    expect(blackCapture.board[1][1]).toBeNull();

    const historyAfterBlack = [...history, blackCapture.boardState];

    // White immediately recapturing at (1,1) would recreate the original position.
    const whiteRecapture = tryMove(blackCapture.board, SIZE, "white", { row: 1, col: 1 }, historyAfterBlack);

    expect(whiteRecapture).toEqual({ ok: false, reason: "ko" });
  });
});
