/**
 * Tiny, self-contained Go rules engine used only to construct and verify tesuji problems
 * at card-generation time (see problemGenerators.ts). Deliberately separate from
 * src/utils/* (the real game engine): those are typed against the app's own BoardSize
 * union (9/13/19) and full GameState, which doesn't fit small illustrative problem boards
 * (5x5-9x9) or a one-off "is this move actually correct" check. No legality/ko/suicide
 * rules here -- these are hand-constructed positions, not a live game, so the only thing
 * that matters is "what does playing this one move capture."
 */

export type Stone = "black" | "white";
export type Cell = Stone | null;
export type MiniBoard = Cell[][];

export function createEmptyBoard(size: number): MiniBoard {
  return Array.from({ length: size }, () => Array<Cell>(size).fill(null));
}

function cloneBoard(board: MiniBoard): MiniBoard {
  return board.map((row) => [...row]);
}

export function inBounds(row: number, col: number, size: number): boolean {
  return row >= 0 && row < size && col >= 0 && col < size;
}

function neighborsOf(row: number, col: number, size: number): [number, number][] {
  const candidates: [number, number][] = [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1],
  ];
  return candidates.filter(([r, c]) => inBounds(r, c, size));
}

export function opponent(color: Stone): Stone {
  return color === "black" ? "white" : "black";
}

interface Group {
  stones: [number, number][];
  liberties: Set<string>;
}

export function getGroup(board: MiniBoard, row: number, col: number, size: number): Group {
  const color = board[row][col];
  const stones: [number, number][] = [];
  const liberties = new Set<string>();
  const visited = new Set<string>([`${row},${col}`]);
  const stack: [number, number][] = [[row, col]];

  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    stones.push([r, c]);

    for (const [nr, nc] of neighborsOf(r, c, size)) {
      const neighborStone = board[nr][nc];
      const key = `${nr},${nc}`;
      if (neighborStone === null) {
        liberties.add(key);
      } else if (neighborStone === color && !visited.has(key)) {
        visited.add(key);
        stack.push([nr, nc]);
      }
    }
  }

  return { stones, liberties };
}

export function countLiberties(board: MiniBoard, row: number, col: number, size: number): number {
  if (board[row][col] === null) return 0;
  return getGroup(board, row, col, size).liberties.size;
}

/** Plays `color` at (row, col) and removes any now-libertyless opponent groups. No legality checks. */
export function playMove(board: MiniBoard, row: number, col: number, color: Stone, size: number): MiniBoard {
  const next = cloneBoard(board);
  next[row][col] = color;
  const opp = opponent(color);
  const visited = new Set<string>();

  for (const [nr, nc] of neighborsOf(row, col, size)) {
    if (next[nr][nc] !== opp) continue;
    const key = `${nr},${nc}`;
    if (visited.has(key)) continue;

    const group = getGroup(next, nr, nc, size);
    group.stones.forEach(([r, c]) => visited.add(`${r},${c}`));

    if (group.liberties.size === 0) {
      group.stones.forEach(([r, c]) => {
        next[r][c] = null;
      });
    }
  }

  return next;
}
