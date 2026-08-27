/**
 * Pure Go clock logic (main time + byo-yomi), shared between the local/AI modes (driven
 * client-side, tick-by-tick via a setInterval) and the online mode (server-authoritative,
 * driven by comparing `now()` against a stored `turn_started_at` on every request — see
 * api/_lib/gameRepo.ts::resolveGameClock). No dependency on React, Supabase, or wall-clock
 * time itself: every function here takes an explicit `elapsedMs` and is fully deterministic,
 * which is what makes it possible to unit test exhaustively (see clock.test.ts) and to reuse
 * identically on both the client and the server without ever duplicating the rules.
 */

export type TimeControlStyle = "japanese" | "canadian";

export type TimeControl =
  | { style: "japanese"; mainSeconds: number; periods: number; periodSeconds: number }
  | { style: "canadian"; mainSeconds: number; moves: number; seconds: number };

export interface ClockState {
  mainMsLeft: number;
  phase: "main" | "extra";
  /** Japanese: byo-yomi periods left. Canadian: moves left in the current block. Only
   * meaningful once `phase === "extra"`. */
  unitsLeft: number;
  /** Ms left in the current byo-yomi period (Japanese) or the current move block
   * (Canadian). Only meaningful once `phase === "extra"`. */
  extraMsLeft: number;
}

export function createInitialClock(tc: TimeControl): ClockState {
  return {
    mainMsLeft: tc.mainSeconds * 1000,
    phase: "main",
    unitsLeft: tc.style === "japanese" ? tc.periods : tc.moves,
    extraMsLeft: 0,
  };
}

function extraUnitMs(tc: TimeControl): number {
  return (tc.style === "japanese" ? tc.periodSeconds : tc.seconds) * 1000;
}

/**
 * Applies `elapsedMs` of real thinking time to `clock`, returning the resulting state and
 * whether the clock ran out. `moveCompleted` distinguishes the two callers:
 *
 * - `true` (a move/pass actually arrived, after `elapsedMs` of thinking): Japanese resets
 *   the current period to a fresh full one once the move lands within it (the classic "you
 *   never carry over leftover byo-yomi seconds" rule) — periods are only ever consumed by
 *   *exceeding* one. Canadian decrements the block's move counter, and once it reaches zero
 *   the whole block resets to fresh full time, discarding any leftover (also the classic
 *   rule — no carryover).
 * - `false` (nobody has moved yet; a lazy check — e.g. a poll — is only asking "has this
 *   pending move already run out of time"): the state just reflects time draining within
 *   the current period/block, with no unit consumed and no reset, since no move exists to
 *   attribute one to.
 *
 * `elapsedMs` can be arbitrarily large (a player who disappeared for an hour) — Japanese
 * correctly cascades through as many fully-exceeded periods as that implies rather than
 * only ever burning one; Canadian has no such cascade because failing a single block is
 * already an immediate timeout, by design (see the style comment below).
 */
export function tickClock(
  clock: ClockState,
  elapsedMs: number,
  tc: TimeControl,
  moveCompleted: boolean
): { clock: ClockState; timedOut: boolean } {
  let remaining = Math.max(0, elapsedMs);
  let phase = clock.phase;
  let mainMsLeft = clock.mainMsLeft;
  let unitsLeft = clock.unitsLeft;
  let extraMsLeft = clock.extraMsLeft;

  if (phase === "main") {
    if (remaining < mainMsLeft) {
      return { clock: { mainMsLeft: mainMsLeft - remaining, phase, unitsLeft, extraMsLeft }, timedOut: false };
    }
    remaining -= mainMsLeft;
    mainMsLeft = 0;
    phase = "extra";
    extraMsLeft = extraUnitMs(tc);
  }

  if (tc.style === "japanese") {
    while (unitsLeft > 0 && remaining > extraMsLeft) {
      remaining -= extraMsLeft;
      unitsLeft -= 1;
      extraMsLeft = extraUnitMs(tc);
    }
    // Either the loop stopped because the move landed within a real remaining period
    // (unitsLeft > 0), or it burned through the very last one and there's still leftover
    // time with no period left to place it in -- `extraMsLeft` from the loop's last
    // iteration is meaningless in that second case, so this must be checked first.
    if (unitsLeft === 0 && remaining > 0) {
      return { clock: { mainMsLeft: 0, phase: "extra", unitsLeft: 0, extraMsLeft: 0 }, timedOut: true };
    }
    const newExtraMsLeft = moveCompleted ? extraUnitMs(tc) : extraMsLeft - remaining;
    return { clock: { mainMsLeft: 0, phase: "extra", unitsLeft, extraMsLeft: newExtraMsLeft }, timedOut: false };
  }

  // Canadian: failing to complete the block's required moves within its time is an
  // immediate timeout -- there is no "burn one block, get a fresh one" concept the way
  // Japanese has with periods, so unlike the loop above this is only ever one comparison.
  if (remaining > extraMsLeft) {
    return { clock: { mainMsLeft: 0, phase: "extra", unitsLeft, extraMsLeft: 0 }, timedOut: true };
  }
  if (!moveCompleted) {
    return { clock: { mainMsLeft: 0, phase: "extra", unitsLeft, extraMsLeft: extraMsLeft - remaining }, timedOut: false };
  }
  const remainingMoves = unitsLeft - 1;
  if (remainingMoves <= 0) {
    // Block completed within time -- resets fully, any leftover time is discarded.
    return { clock: { mainMsLeft: 0, phase: "extra", unitsLeft: tc.moves, extraMsLeft: extraUnitMs(tc) }, timedOut: false };
  }
  return { clock: { mainMsLeft: 0, phase: "extra", unitsLeft: remainingMoves, extraMsLeft: extraMsLeft - remaining }, timedOut: false };
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** "12:34" for main time (or extra time above a minute), "0:07" style below a minute. */
function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${pad2(seconds)}`;
}

/** Human-readable clock value for ClockDisplay.tsx — main time, or "2×0:28" (periods left ×
 * time left in the current one) / "3j·1:12" (moves left in the block · time left) once in
 * byo-yomi. */
export function formatClock(clock: ClockState, style: TimeControlStyle): string {
  if (clock.phase === "main") return formatMs(clock.mainMsLeft);
  const unit = style === "japanese" ? `${clock.unitsLeft}×` : `${clock.unitsLeft}j·`;
  return `${unit}${formatMs(clock.extraMsLeft)}`;
}

const MIN_MAIN_SECONDS = 10;
const MAX_MAIN_SECONDS = 3 * 60 * 60;
const MIN_JAPANESE_PERIODS = 1;
const MAX_JAPANESE_PERIODS = 20;
const MIN_JAPANESE_PERIOD_SECONDS = 5;
const MAX_JAPANESE_PERIOD_SECONDS = 5 * 60;
const MIN_CANADIAN_MOVES = 1;
const MAX_CANADIAN_MOVES = 50;
const MIN_CANADIAN_SECONDS = 10;
const MAX_CANADIAN_SECONDS = 60 * 60;

/** Server-side validation for a client-supplied TimeControl — never trust the shape/ranges
 * a request claims, the same way board sizes/komi/max players are whitelisted elsewhere
 * (see api/games/index.ts). `undefined`/`null` (no time control at all) is valid input,
 * callers check for that separately since it means "untimed game". */
export function isValidTimeControl(value: unknown): value is TimeControl {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.mainSeconds !== "number" || !Number.isInteger(v.mainSeconds)) return false;
  if (v.mainSeconds < MIN_MAIN_SECONDS || v.mainSeconds > MAX_MAIN_SECONDS) return false;

  if (v.style === "japanese") {
    return (
      typeof v.periods === "number" &&
      Number.isInteger(v.periods) &&
      v.periods >= MIN_JAPANESE_PERIODS &&
      v.periods <= MAX_JAPANESE_PERIODS &&
      typeof v.periodSeconds === "number" &&
      Number.isInteger(v.periodSeconds) &&
      v.periodSeconds >= MIN_JAPANESE_PERIOD_SECONDS &&
      v.periodSeconds <= MAX_JAPANESE_PERIOD_SECONDS
    );
  }
  if (v.style === "canadian") {
    return (
      typeof v.moves === "number" &&
      Number.isInteger(v.moves) &&
      v.moves >= MIN_CANADIAN_MOVES &&
      v.moves <= MAX_CANADIAN_MOVES &&
      typeof v.seconds === "number" &&
      Number.isInteger(v.seconds) &&
      v.seconds >= MIN_CANADIAN_SECONDS &&
      v.seconds <= MAX_CANADIAN_SECONDS
    );
  }
  return false;
}
