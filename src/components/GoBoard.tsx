import { Fragment } from "react";
import type { Board, BoardSize, Position } from "../types/game";
import { posKey } from "../utils/board";
import { getHoshiPositions } from "../utils/hoshi";
import "./GoBoard.css";

interface GoBoardProps {
  board: Board;
  boardSize: BoardSize;
  lastMove: Position | null;
  onPlaceStone: (pos: Position) => void;
  disabled?: boolean;
  /** When set, dims the board and shows this text (e.g. "La IA está pensando…"). */
  overlayText?: string;
  /**
   * Scoring/dead-stone-marking mode: when `onToggleDead` is provided, clicking any stone
   * toggles it (and its whole group) instead of placing a new one — `onPlaceStone` and
   * `disabled` are ignored for stone cells while this is active.
   */
  deadStones?: Set<string>;
  onToggleDead?: (pos: Position) => void;
  /** "Bombas" extension: the most recent bomb drop, shown as a marker over its blast radius. */
  lastBomb?: { center: Position; affected: Position[] } | null;
}

const VIEW_SIZE = 100;
const MARGIN = 6;

export default function GoBoard({
  board,
  boardSize,
  lastMove,
  onPlaceStone,
  disabled,
  overlayText,
  deadStones,
  onToggleDead,
  lastBomb,
}: GoBoardProps) {
  const isScoringMode = Boolean(onToggleDead);
  const step = (VIEW_SIZE - MARGIN * 2) / (boardSize - 1);
  const coord = (i: number) => MARGIN + i * step;
  const starPoints = getHoshiPositions(boardSize);
  const bombAffectedKeys = new Set((lastBomb?.affected ?? []).map(posKey));

  return (
    <div className="go-board-wrapper">
      <svg
        viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
        className="go-board-svg"
        role="grid"
        aria-label={`Tablero de Go ${boardSize} por ${boardSize}`}
      >
        <rect x={0} y={0} width={VIEW_SIZE} height={VIEW_SIZE} className="board-bg" rx={2} />

        {Array.from({ length: boardSize }).map((_, i) => (
          <Fragment key={`line-${i}`}>
            <line x1={coord(i)} y1={coord(0)} x2={coord(i)} y2={coord(boardSize - 1)} className="board-line" />
            <line x1={coord(0)} y1={coord(i)} x2={coord(boardSize - 1)} y2={coord(i)} className="board-line" />
          </Fragment>
        ))}

        {starPoints.map((p, idx) => (
          <circle key={`star-${idx}`} cx={coord(p.col)} cy={coord(p.row)} r={Math.max(step * 0.08, 0.5)} className="star-point" />
        ))}

        {board.map((rowArr, row) =>
          rowArr.map((stone, col) => {
            const cx = coord(col);
            const cy = coord(row);
            const isEmpty = stone === null;
            const isLastMove = lastMove?.row === row && lastMove?.col === col;
            const isDead = stone !== null && (deadStones?.has(posKey({ row, col })) ?? false);
            const isBombCenter = lastBomb?.center.row === row && lastBomb.center.col === col;
            const isBombAffected = bombAffectedKeys.has(posKey({ row, col }));
            const canPlace = !isScoringMode && !disabled && isEmpty;
            const canToggleDead = isScoringMode && stone !== null;

            const handleClick = () => {
              if (canToggleDead) onToggleDead!({ row, col });
              else if (canPlace) onPlaceStone({ row, col });
            };

            return (
              <g key={`${row}-${col}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={step * 0.48}
                  className={`cell-hit ${canPlace || canToggleDead ? "cell-hit-active" : ""}`}
                  onClick={handleClick}
                />
                {stone && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={step * 0.45}
                    className={`stone stone-${stone} ${isDead ? "stone-dead" : ""}`}
                  />
                )}
                {isDead && (
                  <g className="dead-marker">
                    <line x1={cx - step * 0.22} y1={cy - step * 0.22} x2={cx + step * 0.22} y2={cy + step * 0.22} />
                    <line x1={cx - step * 0.22} y1={cy + step * 0.22} x2={cx + step * 0.22} y2={cy - step * 0.22} />
                  </g>
                )}
                {isLastMove && stone && !isDead && (
                  <circle cx={cx} cy={cy} r={step * 0.16} className="last-move-marker" />
                )}
                {isBombAffected && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={step * (isBombCenter ? 0.46 : 0.3)}
                    className={`bomb-marker ${isBombCenter ? "bomb-marker-center" : ""}`}
                  />
                )}
              </g>
            );
          })
        )}
      </svg>

      {overlayText && (
        <div className="go-board-overlay">
          <span>{overlayText}</span>
        </div>
      )}
    </div>
  );
}
