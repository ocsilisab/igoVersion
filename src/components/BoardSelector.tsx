import type { BoardSize } from "../types/game";

interface BoardSelectorProps {
  currentSize: BoardSize;
  onSelect: (size: BoardSize) => void;
}

const SIZES: BoardSize[] = [9, 13, 19];

export default function BoardSelector({ currentSize, onSelect }: BoardSelectorProps) {
  return (
    <label className="board-selector">
      <span className="board-selector-label">Modo de juego</span>
      <select
        className="board-selector-select"
        value={currentSize}
        onChange={(e) => onSelect(Number(e.target.value) as BoardSize)}
      >
        {SIZES.map((size) => (
          <option key={size} value={size}>
            {size} × {size}
          </option>
        ))}
      </select>
    </label>
  );
}
