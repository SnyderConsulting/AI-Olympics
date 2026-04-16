export type TicTacToeMark = "X" | "O";
export type TicTacToeWinner = TicTacToeMark | "DRAW";
export type TicTacToeWinnerReason = "line" | "draw" | "timeout";
export type TicTacToeCell = TicTacToeMark | null;
export type TicTacToeBoard = TicTacToeCell[][];
export type TicTacToeMove = {
  row: number;
  column: number;
  notation: string;
};

export type TicTacToeState = {
  board: TicTacToeBoard;
  nextMark: TicTacToeMark;
  winner: TicTacToeWinner | null;
  winnerReason: TicTacToeWinnerReason | null;
  turnCount: number;
  winningLine: [number, number][] | null;
};

const WIN_LINES: [number, number][][] = [
  [
    [0, 0],
    [0, 1],
    [0, 2],
  ],
  [
    [1, 0],
    [1, 1],
    [1, 2],
  ],
  [
    [2, 0],
    [2, 1],
    [2, 2],
  ],
  [
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  [
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  [
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  [
    [0, 2],
    [1, 1],
    [2, 0],
  ],
];

export function createInitialTicTacToeState(): TicTacToeState {
  return {
    board: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => null)),
    nextMark: "X",
    winner: null,
    winnerReason: null,
    turnCount: 0,
    winningLine: null,
  };
}

export function parseTicTacToeState(stateJson: string): TicTacToeState {
  const parsed = JSON.parse(stateJson) as Partial<TicTacToeState>;

  return {
    board: parsed.board as TicTacToeBoard,
    nextMark: parsed.nextMark === "O" ? "O" : "X",
    winner:
      parsed.winner === "X" || parsed.winner === "O" || parsed.winner === "DRAW"
        ? parsed.winner
        : null,
    winnerReason:
      parsed.winnerReason === "line" ||
      parsed.winnerReason === "draw" ||
      parsed.winnerReason === "timeout"
        ? parsed.winnerReason
        : null,
    turnCount: parsed.turnCount ?? 0,
    winningLine: Array.isArray(parsed.winningLine) ? parsed.winningLine : null,
  };
}

export function serializeTicTacToeState(state: TicTacToeState): string {
  return JSON.stringify(state);
}

export function getPlayerMark(isPlayerOne: boolean): TicTacToeMark {
  return isPlayerOne ? "X" : "O";
}

export function boardToAscii(board: TicTacToeBoard): string {
  return board
    .map((row) => row.map((cell) => cell ?? ".").join(" "))
    .join("\n");
}

export function getLegalTicTacToeMoves(state: TicTacToeState): TicTacToeMove[] {
  if (state.winner) {
    return [];
  }

  const moves: TicTacToeMove[] = [];

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      if (state.board[row][column] !== null) {
        continue;
      }

      moves.push({
        row,
        column,
        notation: `row ${row}, column ${column}`,
      });
    }
  }

  return moves;
}

export function applyTicTacToeMove(
  state: TicTacToeState,
  row: number,
  column: number,
  mark: TicTacToeMark,
): TicTacToeState {
  if (state.winner) {
    throw new Error("Match already finished.");
  }

  if (state.nextMark !== mark) {
    throw new Error(`It is not ${mark}'s turn.`);
  }

  if (row < 0 || row > 2 || column < 0 || column > 2) {
    throw new Error("Moves must be within the 3x3 board.");
  }

  if (state.board[row]?.[column]) {
    throw new Error("That square is already taken.");
  }

  const nextBoard = state.board.map((currentRow) => [...currentRow]);
  nextBoard[row][column] = mark;

  const winner = getWinner(nextBoard);
  const isDraw = !winner && nextBoard.every((boardRow) => boardRow.every(Boolean));

  return {
    board: nextBoard,
    nextMark: mark === "X" ? "O" : "X",
    winner: winner?.mark ?? (isDraw ? "DRAW" : null),
    winnerReason: winner ? "line" : isDraw ? "draw" : null,
    turnCount: state.turnCount + 1,
    winningLine: winner?.line ?? null,
  };
}

export function applyTicTacToeForfeit(
  state: TicTacToeState,
  winner: TicTacToeMark,
): TicTacToeState {
  return {
    ...state,
    winner,
    winnerReason: "timeout",
    winningLine: null,
  };
}

function getWinner(board: TicTacToeBoard): { mark: TicTacToeMark; line: [number, number][] } | null {
  for (const line of WIN_LINES) {
    const [firstRow, firstColumn] = line[0];
    const firstCell = board[firstRow][firstColumn];

    if (!firstCell) {
      continue;
    }

    if (line.every(([row, column]) => board[row][column] === firstCell)) {
      return {
        mark: firstCell,
        line,
      };
    }
  }

  return null;
}
