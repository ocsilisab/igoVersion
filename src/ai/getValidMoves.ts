import type { Board, GameState, Player, Position } from "../types/game";
import { tryMove } from "../utils/move";

export interface ValidAiMove {
  position: Position;
  capturedCount: number;
  resultingBoard: Board;
  boardState: string;
}

/**
 * Every legal move `aiColor` could play right now, computed through the exact same
 * `tryMove` rule engine the human player uses (occupancy, suicide, Ko) — the AI never
 * gets its own copy of the rules.
 */
export function getValidMoves(gameState: GameState, aiColor: Player): ValidAiMove[] {
  const { board, boardSize, history } = gameState;
  const moves: ValidAiMove[] = [];

  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (board[row][col] !== null) continue;

      const position: Position = { row, col };
      const result = tryMove(board, boardSize, aiColor, position, history);
      if (result.ok) {
        moves.push({
          position,
          capturedCount: result.capturedCount,
          resultingBoard: result.board,
          boardState: result.boardState,
        });
      }
    }
  }

  return moves;
}
