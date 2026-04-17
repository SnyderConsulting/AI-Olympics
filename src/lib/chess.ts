import {
  Chess,
  type Color as ChessJsColor,
  type Move as ChessJsMove,
  type PieceSymbol as ChessJsPieceSymbol,
} from "chess.js";

import { parseMoveNotation } from "@/lib/move-notation";

export type ChessPlayerColor = "WHITE" | "BLACK";
export type ChessWinner = ChessPlayerColor | "DRAW";
export type ChessWinnerReason =
  | "checkmate"
  | "stalemate"
  | "insufficient-material"
  | "threefold-repetition"
  | "fifty-move-rule"
  | "timeout";

export type ChessMove = {
  from: string;
  to: string;
  piece: ChessJsPieceSymbol;
  color: ChessPlayerColor;
  san: string;
  lan: string;
  notation: string;
  captured: ChessJsPieceSymbol | null;
  promotion: string | null;
  isCapture: boolean;
  isPromotion: boolean;
  isEnPassant: boolean;
  isKingsideCastle: boolean;
  isQueensideCastle: boolean;
};

export type ChessState = {
  fen: string;
  history: string[];
  winner: ChessWinner | null;
  winnerReason: ChessWinnerReason | null;
  turnCount: number;
  lastMove: ChessMove | null;
};

const STRUCTURED_MOVE_KEYS = [
  "notation",
  "move",
  "moveNotation",
  "move_notation",
  "selectedMove",
  "selected_move",
  "choice",
] as const;

export function createInitialChessState(): ChessState {
  const chess = new Chess();

  return {
    fen: chess.fen(),
    history: [],
    winner: null,
    winnerReason: null,
    turnCount: 0,
    lastMove: null,
  };
}

export function parseChessState(stateJson: string): ChessState {
  const parsed = JSON.parse(stateJson) as Partial<ChessState>;
  const state: ChessState = {
    fen: typeof parsed.fen === "string" && parsed.fen.length > 0
      ? parsed.fen
      : new Chess().fen(),
    history: Array.isArray(parsed.history)
      ? parsed.history.filter((entry): entry is string => typeof entry === "string")
      : [],
    winner:
      parsed.winner === "WHITE" || parsed.winner === "BLACK" || parsed.winner === "DRAW"
        ? parsed.winner
        : null,
    winnerReason:
      parsed.winnerReason === "checkmate" ||
      parsed.winnerReason === "stalemate" ||
      parsed.winnerReason === "insufficient-material" ||
      parsed.winnerReason === "threefold-repetition" ||
      parsed.winnerReason === "fifty-move-rule" ||
      parsed.winnerReason === "timeout"
        ? parsed.winnerReason
        : null,
    turnCount: typeof parsed.turnCount === "number" ? parsed.turnCount : 0,
    lastMove: isChessMove(parsed.lastMove) ? parsed.lastMove : null,
  };

  hydrateChess(state);

  return state;
}

export function serializeChessState(state: ChessState): string {
  return JSON.stringify(state);
}

export function getChessPlayerColor(isPlayerOne: boolean): ChessPlayerColor {
  return isPlayerOne ? "WHITE" : "BLACK";
}

export function getChessPlayerLabel(color: ChessPlayerColor): string {
  return color === "WHITE" ? "White" : "Black";
}

export function hydrateChess(state: ChessState): Chess {
  const chess = new Chess();

  for (const move of state.history) {
    chess.move(move, { strict: false });
  }

  if (state.history.length === 0 && state.fen !== chess.fen()) {
    chess.load(state.fen);
  } else if (state.history.length > 0 && state.fen !== chess.fen()) {
    throw new Error("Invalid chess state.");
  }

  return chess;
}

export function renderChessBoard(state: ChessState): string {
  const chess = hydrateChess(state);
  const rows = chess.board().map((row, index) => {
    const rank = 8 - index;
    const cells = row.map((cell) => {
      if (!cell) {
        return ".";
      }

      return cell.color === "w" ? cell.type.toUpperCase() : cell.type;
    });

    return `${rank} ${cells.join(" ")}`;
  });

  return `  a b c d e f g h\n${rows.join("\n")}`;
}

export function getLegalChessMoves(state: ChessState): ChessMove[] {
  if (state.winner) {
    return [];
  }

  return hydrateChess(state)
    .moves({ verbose: true })
    .map(toChessMove)
    .sort((left, right) => {
      return (
        left.notation.localeCompare(right.notation) ||
        left.lan.localeCompare(right.lan)
      );
    });
}

export function parseChessMoveNotation(
  notation: string,
  legalMoves: readonly ChessMove[],
  state: ChessState,
) {
  try {
    return parseMoveNotation(notation, legalMoves);
  } catch (originalError) {
    const candidate = extractNotationCandidate(notation);

    if (!candidate) {
      throw originalError;
    }

    const chess = hydrateChess(state);

    try {
      const parsedMove = chess.move(candidate, { strict: false });
      chess.undo();

      const matchingMove = legalMoves.find((move) => {
        return (
          move.from === parsedMove.from &&
          move.to === parsedMove.to &&
          (move.promotion ?? null) ===
            (parsedMove.promotion ? parsedMove.promotion.toUpperCase() : null)
        );
      });

      if (matchingMove) {
        return matchingMove;
      }
    } catch {
      // Fall through to the original notation parsing error.
    }

    throw originalError;
  }
}

export function applyChessMove(state: ChessState, move: ChessMove): ChessState {
  if (state.winner) {
    throw new Error("Match already finished.");
  }

  const chess = hydrateChess(state);
  const appliedMove = chess.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion?.toLowerCase(),
  });

  if (!appliedMove) {
    throw new Error("Illegal chess move.");
  }

  return buildNextChessState(chess, state, appliedMove);
}

export function applyChessForfeit(
  state: ChessState,
  winner: ChessPlayerColor,
): ChessState {
  return {
    ...state,
    winner,
    winnerReason: "timeout",
  };
}

function buildNextChessState(
  chess: Chess,
  previousState: ChessState,
  appliedMove: ChessJsMove,
): ChessState {
  const nextState: ChessState = {
    fen: chess.fen(),
    history: [...previousState.history, appliedMove.lan],
    winner: null,
    winnerReason: null,
    turnCount: previousState.turnCount + 1,
    lastMove: toChessMove(appliedMove),
  };

  if (chess.isCheckmate()) {
    nextState.winner = toPlayerColor(appliedMove.color);
    nextState.winnerReason = "checkmate";
    return nextState;
  }

  if (chess.isStalemate()) {
    nextState.winner = "DRAW";
    nextState.winnerReason = "stalemate";
    return nextState;
  }

  if (chess.isInsufficientMaterial()) {
    nextState.winner = "DRAW";
    nextState.winnerReason = "insufficient-material";
    return nextState;
  }

  if (chess.isThreefoldRepetition()) {
    nextState.winner = "DRAW";
    nextState.winnerReason = "threefold-repetition";
    return nextState;
  }

  if (chess.isDrawByFiftyMoves()) {
    nextState.winner = "DRAW";
    nextState.winnerReason = "fifty-move-rule";
    return nextState;
  }

  return nextState;
}

function toChessMove(move: ChessJsMove): ChessMove {
  return {
    from: move.from,
    to: move.to,
    piece: move.piece,
    color: toPlayerColor(move.color),
    san: move.san,
    lan: move.lan,
    notation: move.san,
    captured: move.captured ?? null,
    promotion: move.promotion ? move.promotion.toUpperCase() : null,
    isCapture: move.isCapture(),
    isPromotion: move.isPromotion(),
    isEnPassant: move.isEnPassant(),
    isKingsideCastle: move.isKingsideCastle(),
    isQueensideCastle: move.isQueensideCastle(),
  };
}

function toPlayerColor(color: ChessJsColor): ChessPlayerColor {
  return color === "w" ? "WHITE" : "BLACK";
}

function extractNotationCandidate(raw: string): string | null {
  const trimmed = stripCodeFences(raw).trim();

  if (!trimmed) {
    return null;
  }

  try {
    return findNotationValue(JSON.parse(trimmed));
  } catch {
    return trimmed;
  }
}

function findNotationValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const notation = findNotationValue(entry);

      if (notation) {
        return notation;
      }
    }

    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  for (const key of STRUCTURED_MOVE_KEYS) {
    const notation = findNotationValue(record[key]);

    if (notation) {
      return notation;
    }
  }

  for (const entry of Object.values(record)) {
    const notation = findNotationValue(entry);

    if (notation) {
      return notation;
    }
  }

  return null;
}

function stripCodeFences(value: string) {
  return value.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
}

function isChessMove(value: unknown): value is ChessMove {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ChessMove>;

  return (
    typeof record.from === "string" &&
    typeof record.to === "string" &&
    typeof record.san === "string" &&
    typeof record.lan === "string" &&
    typeof record.notation === "string" &&
    (record.color === "WHITE" || record.color === "BLACK")
  );
}
