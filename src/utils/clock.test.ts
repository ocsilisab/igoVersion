import { describe, expect, it } from "vitest";
import { createInitialClock, formatClock, isValidTimeControl, tickClock, type TimeControl } from "./clock";

const japanese: TimeControl = { style: "japanese", mainSeconds: 60, periods: 3, periodSeconds: 30 };
const canadian: TimeControl = { style: "canadian", mainSeconds: 60, moves: 5, seconds: 30 };

describe("tickClock — main time", () => {
  it("consumes main time normally without entering byo-yomi", () => {
    const clock = createInitialClock(japanese);
    const { clock: next, timedOut } = tickClock(clock, 20_000, japanese, true);
    expect(timedOut).toBe(false);
    expect(next.phase).toBe("main");
    expect(next.mainMsLeft).toBe(40_000);
  });

  it("overflows into a fresh byo-yomi period once main time runs out", () => {
    const clock = createInitialClock(japanese);
    // 60s of main time + 10s into the first period.
    const { clock: next, timedOut } = tickClock(clock, 70_000, japanese, true);
    expect(timedOut).toBe(false);
    expect(next.phase).toBe("extra");
    expect(next.mainMsLeft).toBe(0);
    expect(next.unitsLeft).toBe(3); // landed within the period -- not burned
    expect(next.extraMsLeft).toBe(30_000); // completed move resets to a fresh period
  });
});

describe("tickClock — Japanese byo-yomi", () => {
  it("resets the period to full after a move that lands within it", () => {
    const clock = { mainMsLeft: 0, phase: "extra" as const, unitsLeft: 3, extraMsLeft: 30_000 };
    const { clock: next, timedOut } = tickClock(clock, 12_000, japanese, true);
    expect(timedOut).toBe(false);
    expect(next.unitsLeft).toBe(3);
    expect(next.extraMsLeft).toBe(30_000);
  });

  it("burns exactly one period when a single move exceeds it, then resets fresh", () => {
    const clock = { mainMsLeft: 0, phase: "extra" as const, unitsLeft: 3, extraMsLeft: 30_000 };
    // 30s burns the period, +5s lands within the next one.
    const { clock: next, timedOut } = tickClock(clock, 35_000, japanese, true);
    expect(timedOut).toBe(false);
    expect(next.unitsLeft).toBe(2);
    expect(next.extraMsLeft).toBe(30_000);
  });

  it("times out once the last period is exceeded", () => {
    const clock = { mainMsLeft: 0, phase: "extra" as const, unitsLeft: 1, extraMsLeft: 30_000 };
    const { clock: next, timedOut } = tickClock(clock, 31_000, japanese, true);
    expect(timedOut).toBe(true);
    expect(next.unitsLeft).toBe(0);
  });

  it("cascades through several fully-exceeded periods for a very large elapsed time", () => {
    const clock = createInitialClock(japanese); // 60s main, 3x30s
    // 60s main + 3x30s periods (all 3 burned) + 31s over -> should time out.
    const { timedOut } = tickClock(clock, 60_000 + 3 * 30_000 + 1_000, japanese, true);
    expect(timedOut).toBe(true);
  });

  it("cascades through exactly enough periods to land safely in the last one", () => {
    const clock = createInitialClock(japanese); // 60s main, 3x30s
    // 60s main + 2 burned periods (60s) + 10s into the 3rd -- still alive.
    const { clock: next, timedOut } = tickClock(clock, 60_000 + 2 * 30_000 + 10_000, japanese, true);
    expect(timedOut).toBe(false);
    expect(next.unitsLeft).toBe(1);
    expect(next.extraMsLeft).toBe(30_000);
  });

  it("a lazy check (no move) only drains the current period without resetting or burning it early", () => {
    const clock = { mainMsLeft: 0, phase: "extra" as const, unitsLeft: 3, extraMsLeft: 30_000 };
    const { clock: next, timedOut } = tickClock(clock, 12_000, japanese, false);
    expect(timedOut).toBe(false);
    expect(next.unitsLeft).toBe(3);
    expect(next.extraMsLeft).toBe(18_000);
  });

  it("a lazy check detects a timeout if the pending move already overran every period", () => {
    const clock = { mainMsLeft: 0, phase: "extra" as const, unitsLeft: 1, extraMsLeft: 30_000 };
    const { timedOut } = tickClock(clock, 45_000, japanese, false);
    expect(timedOut).toBe(true);
  });
});

describe("tickClock — Canadian byo-yomi", () => {
  it("decrements the move counter without resetting the block until it's completed", () => {
    const clock = { mainMsLeft: 0, phase: "extra" as const, unitsLeft: 5, extraMsLeft: 30_000 };
    const { clock: next, timedOut } = tickClock(clock, 5_000, canadian, true);
    expect(timedOut).toBe(false);
    expect(next.unitsLeft).toBe(4);
    expect(next.extraMsLeft).toBe(25_000);
  });

  it("resets to a fresh full block once the required moves are completed, discarding leftover time", () => {
    const clock = { mainMsLeft: 0, phase: "extra" as const, unitsLeft: 1, extraMsLeft: 30_000 };
    const { clock: next, timedOut } = tickClock(clock, 5_000, canadian, true);
    expect(timedOut).toBe(false);
    expect(next.unitsLeft).toBe(5);
    expect(next.extraMsLeft).toBe(30_000);
  });

  it("times out immediately if a single move exceeds the block's remaining time", () => {
    const clock = { mainMsLeft: 0, phase: "extra" as const, unitsLeft: 5, extraMsLeft: 30_000 };
    const { timedOut } = tickClock(clock, 31_000, canadian, true);
    expect(timedOut).toBe(true);
  });

  it("a lazy check detects a timeout without needing a move to be made", () => {
    const clock = { mainMsLeft: 0, phase: "extra" as const, unitsLeft: 5, extraMsLeft: 30_000 };
    const { timedOut } = tickClock(clock, 31_000, canadian, false);
    expect(timedOut).toBe(true);
  });

  it("a lazy check mid-block just drains time without touching the move count", () => {
    const clock = { mainMsLeft: 0, phase: "extra" as const, unitsLeft: 5, extraMsLeft: 30_000 };
    const { clock: next, timedOut } = tickClock(clock, 10_000, canadian, false);
    expect(timedOut).toBe(false);
    expect(next.unitsLeft).toBe(5);
    expect(next.extraMsLeft).toBe(20_000);
  });
});

describe("formatClock", () => {
  it("formats main time as m:ss", () => {
    expect(formatClock({ mainMsLeft: 125_000, phase: "main", unitsLeft: 0, extraMsLeft: 0 }, "japanese")).toBe("2:05");
  });

  it("formats Japanese byo-yomi as periods×time", () => {
    expect(formatClock({ mainMsLeft: 0, phase: "extra", unitsLeft: 2, extraMsLeft: 28_000 }, "japanese")).toBe("2×0:28");
  });

  it("formats Canadian byo-yomi as moves·time", () => {
    expect(formatClock({ mainMsLeft: 0, phase: "extra", unitsLeft: 4, extraMsLeft: 12_000 }, "canadian")).toBe("4j·0:12");
  });
});

describe("isValidTimeControl", () => {
  it("accepts a valid Japanese time control", () => {
    expect(isValidTimeControl({ style: "japanese", mainSeconds: 600, periods: 3, periodSeconds: 30 })).toBe(true);
  });

  it("accepts a valid Canadian time control", () => {
    expect(isValidTimeControl({ style: "canadian", mainSeconds: 900, moves: 20, seconds: 300 })).toBe(true);
  });

  it("rejects an unknown style", () => {
    expect(isValidTimeControl({ style: "fischer", mainSeconds: 600 })).toBe(false);
  });

  it("rejects out-of-range values", () => {
    expect(isValidTimeControl({ style: "japanese", mainSeconds: 600, periods: 999, periodSeconds: 30 })).toBe(false);
    expect(isValidTimeControl({ style: "canadian", mainSeconds: 5, moves: 20, seconds: 300 })).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isValidTimeControl(null)).toBe(false);
    expect(isValidTimeControl("japanese")).toBe(false);
    expect(isValidTimeControl(42)).toBe(false);
  });
});
