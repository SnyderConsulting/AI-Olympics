import { parseMoveNotation } from "@/lib/move-notation";

export const CHECKERS_DRAW_STALE_PLY_LIMIT = 80;

export type CheckersPlayerColor = "RED" | "BLACK";
export type CheckersPieceKind = "MAN" | "KING";
export type CheckersWinner = CheckersPlayerColor | "DRAW";
export type CheckersWinnerReason = "capture-all" | "no-legal-moves" | "stale-position" | "timeout";

export type CheckersPiece = {
  color: CheckersPlayerColor;
  kind: CheckersPieceKind;
};

export type CheckersCell = CheckersPiece | null;
export type CheckersBoard = CheckersCell[][];

export type CheckersPosition = {
  row: number;
  column: number;
};

export type CheckersMove = {
  from: CheckersPosition;
  sequence: CheckersPosition[];
  captures: CheckersPosition[];
  piece: CheckersPiece;
  isCapture: boolean;
  promotes: boolean;
  notation: string;
};

export type CheckersState = {
  board: CheckersBoard;
  nextPlayer: CheckersPlayerColor;
  winner: CheckersWinner | null;
  winnerReason: CheckersWinnerReason | null;
  turnCount: number;
  staleHalfmoveCount: number;
  lastMove: CheckersMove | null;
};

const KING_DIRECTIONS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

const MAN_DIRECTIONS: Record<CheckersPlayerColor, readonly [number, number][]> = {
  RED: [
    [1, -1],
    [1, 1],
  ],
  BLACK: [
    [-1, -1],
    [-1, 1],
  ],
};

export function createInitialCheckersState(): CheckersState {
  const board = createEmptyCheckersBoard();

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      if (isPlayableSquare(row, column)) {
        board[row][column] = { color: "RED", kind: "MAN" };
      }
    }
  }

  for (let row = 5; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      if (isPlayableSquare(row, column)) {
        board[row][column] = { color: "BLACK", kind: "MAN" };
      }
    }
  }

  return {
    board,
    nextPlayer: "RED",
    winner: null,
    winnerReason: null,
    turnCount: 0,
    staleHalfmoveCount: 0,
    lastMove: null,
  };
}

export function createEmptyCheckersBoard(): CheckersBoard {
  return Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null));
}

export function parseCheckersState(stateJson: string): CheckersState {
  const parsed = JSON.parse(stateJson) as Partial<CheckersState>;

  if (!Array.isArray(parsed.board) || parsed.board.length !== 8) {
    throw new Error("Invalid checkers state.");
  }

  return {
    board: parsed.board as CheckersBoard,
    nextPlayer: parsed.nextPlayer === "BLACK" ? "BLACK" : "RED",
    winner:
      parsed.winner === "BLACK" || parsed.winner === "RED" || parsed.winner === "DRAW"
        ? parsed.winner
        : null,
    winnerReason:
      parsed.winnerReason === "capture-all" ||
      parsed.winnerReason === "no-legal-moves" ||
      parsed.winnerReason === "stale-position" ||
      parsed.winnerReason === "timeout"
        ? parsed.winnerReason
        : null,
    turnCount: parsed.turnCount ?? 0,
    staleHalfmoveCount: parsed.staleHalfmoveCount ?? 0,
    lastMove: parsed.lastMove ?? null,
  };
}

export function serializeCheckersState(state: CheckersState): string {
  return JSON.stringify(state);
}

export function getCheckersPlayerColor(isPlayerOne: boolean): CheckersPlayerColor {
  return isPlayerOne ? "RED" : "BLACK";
}

export function getCheckersPlayerLabel(color: CheckersPlayerColor): string {
  return color === "RED" ? "Red" : "Black";
}

export function renderCheckersBoard(board: CheckersBoard): string {
  const rows = board.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => {
      if (!isPlayableSquare(rowIndex, columnIndex)) {
        return "_";
      }

      if (!cell) {
        return ".";
      }

      return getPieceSymbol(cell);
    });

    return `${rowIndex} ${cells.join(" ")}`;
  });

  return `  0 1 2 3 4 5 6 7\n${rows.join("\n")}`;
}

export function getLegalCheckersMoves(state: CheckersState): CheckersMove[] {
  if (state.winner) {
    return [];
  }

  const captureMoves: CheckersMove[] = [];

  forEachOwnedPiece(state.board, state.nextPlayer, (piece, position) => {
    captureMoves.push(...getCaptureMovesForPiece(state.board, position, piece));
  });

  if (captureMoves.length > 0) {
    return sortMoves(captureMoves);
  }

  const simpleMoves: CheckersMove[] = [];

  forEachOwnedPiece(state.board, state.nextPlayer, (piece, position) => {
    simpleMoves.push(...getSimpleMovesForPiece(state.board, position, piece));
  });

  return sortMoves(simpleMoves);
}

export function parseCheckersMoveNotation(
  notation: string,
  legalMoves: readonly CheckersMove[],
) {
  try {
    return parseMoveNotation(notation, legalMoves);
  } catch (error) {
    const parsedPath = extractCheckersMovePath(notation);

    if (!parsedPath) {
      throw error;
    }

    const coordinateMatch = legalMoves.find((move) => {
      const movePath = [move.from, ...move.sequence];

      return (
        movePath.length === parsedPath.length &&
        movePath.every((position, index) => positionsEqual(position, parsedPath[index]))
      );
    });

    if (coordinateMatch) {
      return coordinateMatch;
    }

    throw error;
  }
}

export function applyCheckersMove(
  state: CheckersState,
  args: {
    fromRow: number;
    fromColumn: number;
    sequence: CheckersPosition[];
  },
): CheckersState {
  if (state.winner) {
    throw new Error("Match already finished.");
  }

  const legalMoves = getLegalCheckersMoves(state);
  const matchingMove = legalMoves.find((move) =>
    positionsEqual(move.from, { row: args.fromRow, column: args.fromColumn }) &&
    sequencesEqual(move.sequence, args.sequence),
  );

  if (!matchingMove) {
    throw new Error("Illegal checkers move.");
  }

  const nextBoard = applyResolvedMoveToBoard(state.board, matchingMove);
  const nextPlayer = getOpponentColor(state.nextPlayer);
  const staleHalfmoveCount =
    matchingMove.isCapture || matchingMove.promotes
      ? 0
      : state.staleHalfmoveCount + 1;

  const nextState: CheckersState = {
    board: nextBoard,
    nextPlayer,
    winner: null,
    winnerReason: null,
    turnCount: state.turnCount + 1,
    staleHalfmoveCount,
    lastMove: matchingMove,
  };

  const remainingOpponentPieces = countPieces(nextBoard, nextPlayer);

  if (remainingOpponentPieces === 0) {
    return {
      ...nextState,
      winner: state.nextPlayer,
      winnerReason: "capture-all",
    };
  }

  const opponentMoves = getLegalCheckersMoves(nextState);

  if (opponentMoves.length === 0) {
    return {
      ...nextState,
      winner: state.nextPlayer,
      winnerReason: "no-legal-moves",
    };
  }

  if (staleHalfmoveCount >= CHECKERS_DRAW_STALE_PLY_LIMIT) {
    return {
      ...nextState,
      winner: "DRAW",
      winnerReason: "stale-position",
    };
  }

  return nextState;
}

export function applyCheckersForfeit(
  state: CheckersState,
  winner: CheckersPlayerColor,
): CheckersState {
  return {
    ...state,
    winner,
    winnerReason: "timeout",
  };
}

function getSimpleMovesForPiece(
  board: CheckersBoard,
  from: CheckersPosition,
  piece: CheckersPiece,
): CheckersMove[] {
  const moves: CheckersMove[] = [];

  for (const [rowDelta, columnDelta] of getDirections(piece)) {
    const row = from.row + rowDelta;
    const column = from.column + columnDelta;

    if (!isInBounds(row, column) || board[row][column] !== null) {
      continue;
    }

    const sequence = [{ row, column }];
    moves.push(createCheckersMove(from, sequence, [], piece));
  }

  return moves;
}

function getCaptureMovesForPiece(
  board: CheckersBoard,
  from: CheckersPosition,
  piece: CheckersPiece,
): CheckersMove[] {
  return extendCaptureSequence(board, from, from, piece, [], []);
}

function extendCaptureSequence(
  board: CheckersBoard,
  origin: CheckersPosition,
  current: CheckersPosition,
  piece: CheckersPiece,
  sequence: CheckersPosition[],
  captures: CheckersPosition[],
): CheckersMove[] {
  const moves: CheckersMove[] = [];

  for (const [rowDelta, columnDelta] of getDirections(piece)) {
    const jumpedRow = current.row + rowDelta;
    const jumpedColumn = current.column + columnDelta;
    const landingRow = current.row + rowDelta * 2;
    const landingColumn = current.column + columnDelta * 2;

    if (!isInBounds(jumpedRow, jumpedColumn) || !isInBounds(landingRow, landingColumn)) {
      continue;
    }

    const jumpedPiece = board[jumpedRow][jumpedColumn];
    if (!jumpedPiece || jumpedPiece.color === piece.color || board[landingRow][landingColumn] !== null) {
      continue;
    }

    const nextBoard = cloneBoard(board);
    nextBoard[current.row][current.column] = null;
    nextBoard[jumpedRow][jumpedColumn] = null;

    const landing = { row: landingRow, column: landingColumn };
    const nextSequence = [...sequence, landing];
    const nextCaptures = [...captures, { row: jumpedRow, column: jumpedColumn }];
    const promotes =
      piece.kind === "MAN" && landing.row === getPromotionRow(piece.color);

    const nextPiece = promotes ? { ...piece, kind: "KING" as const } : piece;
    nextBoard[landing.row][landing.column] = nextPiece;

    if (promotes) {
      moves.push(createCheckersMove(origin, nextSequence, nextCaptures, piece));
      continue;
    }

    const continuations = extendCaptureSequence(
      nextBoard,
      origin,
      landing,
      nextPiece,
      nextSequence,
      nextCaptures,
    );

    if (continuations.length > 0) {
      moves.push(...continuations);
      continue;
    }

    moves.push(createCheckersMove(origin, nextSequence, nextCaptures, piece));
  }

  return moves;
}

function createCheckersMove(
  from: CheckersPosition,
  sequence: CheckersPosition[],
  captures: CheckersPosition[],
  piece: CheckersPiece,
): CheckersMove {
  const promotes =
    piece.kind === "MAN" &&
    sequence.length > 0 &&
    sequence[sequence.length - 1].row === getPromotionRow(piece.color);

  return {
    from,
    sequence,
    captures,
    piece,
    isCapture: captures.length > 0,
    promotes,
    notation: formatCheckersMoveNotation(from, sequence, captures.length > 0),
  };
}

function applyResolvedMoveToBoard(board: CheckersBoard, move: CheckersMove): CheckersBoard {
  const nextBoard = cloneBoard(board);
  const startingPiece = nextBoard[move.from.row][move.from.column];

  if (!startingPiece) {
    throw new Error("Piece not found for resolved checkers move.");
  }

  nextBoard[move.from.row][move.from.column] = null;

  let current = move.from;

  for (const landing of move.sequence) {
    if (Math.abs(landing.row - current.row) === 2) {
      const capturedRow = (landing.row + current.row) / 2;
      const capturedColumn = (landing.column + current.column) / 2;
      nextBoard[capturedRow][capturedColumn] = null;
    }

    current = landing;
  }

  const finalPiece =
    startingPiece.kind === "MAN" &&
    current.row === getPromotionRow(startingPiece.color)
      ? { ...startingPiece, kind: "KING" as const }
      : startingPiece;

  nextBoard[current.row][current.column] = finalPiece;

  return nextBoard;
}

function sortMoves(moves: CheckersMove[]) {
  return [...moves].sort((left, right) => left.notation.localeCompare(right.notation));
}

function extractCheckersMovePath(notation: string) {
  const matches = Array.from(notation.matchAll(/([0-7])\s*,\s*([0-7])/g));

  if (matches.length < 2) {
    return null;
  }

  return matches.map((match) => ({
    row: Number.parseInt(match[1], 10),
    column: Number.parseInt(match[2], 10),
  }));
}

function getDirections(piece: CheckersPiece) {
  return piece.kind === "KING" ? KING_DIRECTIONS : MAN_DIRECTIONS[piece.color];
}

function getPromotionRow(color: CheckersPlayerColor) {
  return color === "RED" ? 7 : 0;
}

function getPieceSymbol(piece: CheckersPiece) {
  if (piece.color === "RED") {
    return piece.kind === "KING" ? "R" : "r";
  }

  return piece.kind === "KING" ? "B" : "b";
}

function getOpponentColor(color: CheckersPlayerColor): CheckersPlayerColor {
  return color === "RED" ? "BLACK" : "RED";
}

function countPieces(board: CheckersBoard, color: CheckersPlayerColor) {
  let count = 0;

  for (const row of board) {
    for (const cell of row) {
      if (cell?.color === color) {
        count += 1;
      }
    }
  }

  return count;
}

function cloneBoard(board: CheckersBoard): CheckersBoard {
  return board.map((row) =>
    row.map((cell) => (cell ? { ...cell } : null)),
  );
}

function formatCheckersMoveNotation(
  from: CheckersPosition,
  sequence: CheckersPosition[],
  isCapture: boolean,
) {
  return [from, ...sequence]
    .map((position) => `${position.row},${position.column}`)
    .join(isCapture ? " x " : " -> ");
}

function positionsEqual(left: CheckersPosition, right: CheckersPosition) {
  return left.row === right.row && left.column === right.column;
}

function sequencesEqual(left: CheckersPosition[], right: CheckersPosition[]) {
  return (
    left.length === right.length &&
    left.every((position, index) => positionsEqual(position, right[index]))
  );
}

function isInBounds(row: number, column: number) {
  return row >= 0 && row < 8 && column >= 0 && column < 8;
}

function isPlayableSquare(row: number, column: number) {
  return (row + column) % 2 === 1;
}

function forEachOwnedPiece(
  board: CheckersBoard,
  color: CheckersPlayerColor,
  callback: (piece: CheckersPiece, position: CheckersPosition) => void,
) {
  for (let row = 0; row < board.length; row += 1) {
    for (let column = 0; column < board[row].length; column += 1) {
      const piece = board[row][column];

      if (!piece || piece.color !== color) {
        continue;
      }

      callback(piece, { row, column });
    }
  }
}
