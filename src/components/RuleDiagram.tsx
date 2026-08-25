import { Fragment } from "react";
import "./RuleDiagram.css";

interface DiagramStone {
  row: number;
  col: number;
  color: "black" | "white";
  /** Shown crossed out, like a captured/dead stone — see GoBoard.tsx's dead-stone marker. */
  dead?: boolean;
}

interface DiagramTerritory {
  row: number;
  col: number;
  color: "black" | "white";
}

interface RuleDiagramProps {
  /** Small illustrative grid, unrelated to real board sizes (9/13/19) -- just big enough to show the point being made. */
  size: number;
  stones?: DiagramStone[];
  /** Empty points to highlight as liberties, with a small ring marker. */
  liberties?: { row: number; col: number }[];
  territory?: DiagramTerritory[];
  /** Caption shown under the diagram, e.g. "Antes" / "Después". */
  caption?: string;
}

const VIEW_SIZE = 100;
const MARGIN = 12;

export default function RuleDiagram({ size, stones = [], liberties = [], territory = [], caption }: RuleDiagramProps) {
  const step = (VIEW_SIZE - MARGIN * 2) / (size - 1);
  const coord = (i: number) => MARGIN + i * step;
  const stoneAt = (row: number, col: number) => stones.find((s) => s.row === row && s.col === col);
  const territoryAt = (row: number, col: number) => territory.find((t) => t.row === row && t.col === col);

  return (
    <figure className="rule-diagram">
      <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} className="rule-diagram-svg" role="img" aria-label={caption ?? "Diagrama de ejemplo"}>
        <rect x={0} y={0} width={VIEW_SIZE} height={VIEW_SIZE} className="rule-diagram-bg" rx={4} />

        {Array.from({ length: size }).map((_, i) => (
          <Fragment key={`line-${i}`}>
            <line x1={coord(i)} y1={coord(0)} x2={coord(i)} y2={coord(size - 1)} className="rule-diagram-line" />
            <line x1={coord(0)} y1={coord(i)} x2={coord(size - 1)} y2={coord(i)} className="rule-diagram-line" />
          </Fragment>
        ))}

        {Array.from({ length: size }).map((_, row) =>
          Array.from({ length: size }).map((_, col) => {
            const cx = coord(col);
            const cy = coord(row);
            const stone = stoneAt(row, col);
            const isLiberty = liberties.some((l) => l.row === row && l.col === col);
            const owner = territoryAt(row, col)?.color;

            return (
              <g key={`${row}-${col}`}>
                {stone && (
                  <circle cx={cx} cy={cy} r={step * 0.45} className={`rule-diagram-stone rule-diagram-stone-${stone.color}`} />
                )}
                {stone?.dead && (
                  <g className="rule-diagram-dead-marker">
                    <line x1={cx - step * 0.22} y1={cy - step * 0.22} x2={cx + step * 0.22} y2={cy + step * 0.22} />
                    <line x1={cx - step * 0.22} y1={cy + step * 0.22} x2={cx + step * 0.22} y2={cy - step * 0.22} />
                  </g>
                )}
                {isLiberty && <circle cx={cx} cy={cy} r={step * 0.22} className="rule-diagram-liberty" />}
                {owner && (
                  <rect
                    x={cx - step * 0.18}
                    y={cy - step * 0.18}
                    width={step * 0.36}
                    height={step * 0.36}
                    className={`rule-diagram-territory rule-diagram-territory-${owner}`}
                  />
                )}
              </g>
            );
          })
        )}
      </svg>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
