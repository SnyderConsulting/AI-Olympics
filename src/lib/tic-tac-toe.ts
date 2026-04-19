import { normalizeMoveNotation, parseMoveNotation } from "@/lib/move-notation";

export type TicTacToeMark = "X" | "O";
export type TicTacToeWinner = TicTacToeMark | "DRAW";
export type TicTacToeWinnerReason = "line" | "draw" | "timeout";
export type TicTacToeCell = TicTacToeMark | null;
export type TicTacToeBoard = TicTacToeCell[][];
export type TicTacToeMove = {
  row: number;
  column: number;
  notation: string;
  name: string;
  aliases: string[];
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

const MOVE_NAMES = [
  ["top-left", "top-center", "top-right"],
  ["middle-left", "center", "middle-right"],
  ["bottom-left", "bottom-center", "bottom-right"],
] as const;

const MOVE_ALIASES = [
  [
    ["upper-left", "top left"],
    ["top-middle", "top middle", "upper-middle", "upper center", "top center"],
    ["upper-right", "top right"],
  ],
  [
    ["center-left", "middle left", "left-middle"],
    ["middle", "middle-center", "middle center", "center-center", "center center"],
    ["center-right", "middle right", "right-middle"],
  ],
  [
    ["lower-left", "bottom left"],
    ["bottom-middle", "bottom middle", "lower-middle", "lower center", "bottom center"],
    ["lower-right", "bottom right"],
  ],
] as const;

export const TIC_TAC_TOE_RULES_TEXT =
  "Tic Tac Toe is played on a 3x3 grid. X moves first, O moves second, and the first side to make three in a row horizontally, vertically, or diagonally wins. If all nine squares are filled without a line, the game is a draw. Squares use zero-based row,column coordinates from top-left 0,0 to bottom-right 2,2.";

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

export function renderTicTacToeBoard(board: TicTacToeBoard): string {
  const rows = board.map((row, rowIndex) => {
    return `${rowIndex} ${row.map((cell) => cell ?? ".").join(" ")}`;
  });

  return `  0 1 2\n${rows.join("\n")}`;
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
        notation: `${row},${column}`,
        name: MOVE_NAMES[row][column],
        aliases: MOVE_ALIASES[row][column] ? [...MOVE_ALIASES[row][column]] : [],
      });
    }
  }

  return moves;
}

export function parseTicTacToeMoveNotation(
  notation: string,
  legalMoves: readonly TicTacToeMove[],
) {
  const aliasMatch = findAliasMatch(notation, legalMoves);

  if (aliasMatch) {
    return aliasMatch;
  }

  return parseMoveNotation(notation, legalMoves);
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

function findAliasMatch(raw: string, legalMoves: readonly TicTacToeMove[]) {
  const normalizedRaw = normalizeMoveNotation(raw);

  if (!normalizedRaw) {
    return null;
  }

  const matches = legalMoves.filter((move) =>
    [move.name, ...move.aliases].some((alias) => normalizeMoveNotation(alias) === normalizedRaw),
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new Error(`Ambiguous Tic Tac Toe move alias: ${raw}`);
  }

  return null;
}
