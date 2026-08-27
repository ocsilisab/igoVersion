import type { Player } from "../types/game";
import { formatClock, type ClockState, type TimeControlStyle } from "../utils/clock";
import "./ClockDisplay.css";

interface ClockDisplayProps {
  /** A color missing here has no clock at all (e.g. the AI's side in an AI game) and is
   * simply not shown. */
  clocks: Partial<Record<Player, ClockState>>;
  style: TimeControlStyle;
  currentPlayer: Player;
  gameOver?: boolean;
}

const COLORS: Player[] = ["black", "white"];

export default function ClockDisplay({ clocks, style, currentPlayer, gameOver }: ClockDisplayProps) {
  const shown = COLORS.filter((color) => clocks[color]);
  if (shown.length === 0) return null;

  return (
    <div className="clock-display">
      {shown.map((color) => {
        const clock = clocks[color]!;
        const running = !gameOver && color === currentPlayer;
        const low = clock.phase === "extra" || clock.mainMsLeft < 30_000;
        return (
          <div
            key={color}
            className={`clock-item ${running ? "clock-item-active" : ""} ${low ? "clock-item-low" : ""}`}
          >
            <span className={`stone-dot stone-dot-${color}`} />
            <span className="clock-value">{formatClock(clock, style)}</span>
          </div>
        );
      })}
    </div>
  );
}
