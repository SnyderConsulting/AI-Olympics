import type { Agent, Match, MatchMove } from "@/generated/prisma/client";

import {
  applyCheckersMove,
  createInitialCheckersState,
  parseCheckersState,
  renderCheckersBoard,
  type CheckersPosition,
  type CheckersState,
} from "@/lib/checkers";
import {
  applyChessMove,
  createInitialChessState,
  getLegalChessMoves,
  parseChessMoveNotation,
  parseChessState,
  renderChessBoard,
  type ChessMove,
  type ChessState,
} from "@/lib/chess";
import {
  applyTicTacToeMove,
  createInitialTicTacToeState,
  parseTicTacToeState,
  renderTicTacToeBoard,
  type TicTacToeBoard,
  type TicTacToeMark,
  type TicTacToeState,
  type TicTacToeWinner,
  type TicTacToeWinnerReason,
} from "@/lib/tic-tac-toe";
import {
  createFrontierReplayVisual,
  createInitialFrontierState,
  parseFrontierReplayVisual,
  parseFrontierState,
  renderFrontierBoard,
  type FrontierReplayVisual,
  type FrontierState,
} from "@/lib/frontier";

export type ReplayableMatch = Match & {
  playerOne: Agent;
  playerTwo: Agent | null;
  winner: Agent | null;
  moves: MatchMove[];
};

export type MatchReplayFrame = {
  index: number;
  board: string;
  headline: string;
  notation: string | null;
  actorName: string | null;
  createdAt: string | null;
  isTerminal: boolean;
  visual: MatchReplayVisual | null;
};

export type MatchReplay = {
  frames: MatchReplayFrame[];
  unavailableReason: string | null;
};

type ReplayPayload = Record<string, unknown>;

export type TicTacToeReplayVisual = {
  kind: "tic-tac-toe";
  board: TicTacToeBoard;
  nextMark: TicTacToeMark;
  winner: TicTacToeWinner | null;
  winnerReason: TicTacToeWinnerReason | null;
  winningLine: [number, number][] | null;
};

export type MatchReplayVisual = FrontierReplayVisual | TicTacToeReplayVisual;

export function buildMatchReplay(match: ReplayableMatch): MatchReplay {
  try {
    switch (match.gameKey) {
      case "tic-tac-toe":
        return buildTicTacToeReplay(match);
      case "checkers":
        return buildCheckersReplay(match);
      case "chess":
        return buildChessReplay(match);
      case "frontier":
        return buildFrontierReplay(match);
      default:
        return {
          frames: [],
          unavailableReason: `Replay is not supported for ${match.gameKey}.`,
        };
    }
  } catch {
    return {
      frames: [],
      unavailableReason: "Replay unavailable for this match.",
    };
  }
}

function buildTicTacToeReplay(match: ReplayableMatch): MatchReplay {
  let state = createInitialTicTacToeState();
  const frames: MatchReplayFrame[] = [
    createReplayFrame({
      index: 0,
      board: renderTicTacToeBoard(state.board),
      headline: "Initial position",
      visual: createTicTacToeReplayVisual(state),
    }),
  ];

  for (const move of match.moves) {
    const payload = parseMovePayload(move.payloadJson);
    const row = getRequiredNumber(payload.row);
    const column = getRequiredNumber(payload.column);
    const mark = getTicTacToeMark(payload.mark, move.agentId === match.playerOneId);
    const notation = getOptionalString(payload.notation) ?? `${row},${column}`;

    state = applyTicTacToeMove(state, row, column, mark);
    frames.push(
      createReplayFrame({
        index: frames.length,
        actorName: getActorName(match, move.agentId),
        board: renderTicTacToeBoard(state.board),
        createdAt: move.createdAt.toISOString(),
        headline: `${getActorName(match, move.agentId) ?? "Unknown agent"} played ${notation}`,
        notation,
        visual: createTicTacToeReplayVisual(state),
      }),
    );
  }

  const finalState = parseTicTacToeState(match.stateJson);

  return {
    frames: appendTerminalFrameIfNeeded({
      frames,
      currentState: state,
      finalBoard: renderTicTacToeBoard(finalState.board),
      finalWinner: finalState.winner,
      finalWinnerReason: finalState.winnerReason,
      terminalHeadline: describeTerminalHeadline(match, finalState.winnerReason),
      finalVisual: createTicTacToeReplayVisual(finalState),
    }),
    unavailableReason: null,
  };
}

function buildCheckersReplay(match: ReplayableMatch): MatchReplay {
  let state = createInitialCheckersState();
  const frames: MatchReplayFrame[] = [
    createReplayFrame({
      index: 0,
      board: renderCheckersBoard(state.board),
      headline: "Initial position",
    }),
  ];

  for (const move of match.moves) {
    const payload = parseMovePayload(move.payloadJson);
    const from = getRequiredPosition(payload.from);
    const sequence = getRequiredSequence(payload.sequence);
    const notation = getOptionalString(payload.notation) ?? formatCheckersPath(from, sequence);

    state = applyCheckersMove(state, {
      fromRow: from.row,
      fromColumn: from.column,
      sequence,
    });
    frames.push(
      createReplayFrame({
        index: frames.length,
        actorName: getActorName(match, move.agentId),
        board: renderCheckersBoard(state.board),
        createdAt: move.createdAt.toISOString(),
        headline: `${getActorName(match, move.agentId) ?? "Unknown agent"} played ${notation}`,
        notation,
      }),
    );
  }

  const finalState = parseCheckersState(match.stateJson);

  return {
    frames: appendTerminalFrameIfNeeded({
      frames,
      currentState: state,
      finalBoard: renderCheckersBoard(finalState.board),
      finalWinner: finalState.winner,
      finalWinnerReason: finalState.winnerReason,
      terminalHeadline: describeTerminalHeadline(match, finalState.winnerReason),
    }),
    unavailableReason: null,
  };
}

function buildChessReplay(match: ReplayableMatch): MatchReplay {
  let state = createInitialChessState();
  const frames: MatchReplayFrame[] = [
    createReplayFrame({
      index: 0,
      board: renderChessBoard(state),
      headline: "Initial position",
    }),
  ];

  for (const move of match.moves) {
    const payload = parseMovePayload(move.payloadJson);
    const resolvedMove = resolveChessReplayMove(state, payload);
    const notation = resolvedMove.notation;

    state = applyChessMove(state, resolvedMove);
    frames.push(
      createReplayFrame({
        index: frames.length,
        actorName: getActorName(match, move.agentId),
        board: renderChessBoard(state),
        createdAt: move.createdAt.toISOString(),
        headline: `${getActorName(match, move.agentId) ?? "Unknown agent"} played ${notation}`,
        notation,
      }),
    );
  }

  const finalState = parseChessState(match.stateJson);

  return {
    frames: appendTerminalFrameIfNeeded({
      frames,
      currentState: state,
      finalBoard: renderChessBoard(finalState),
      finalWinner: finalState.winner,
      finalWinnerReason: finalState.winnerReason,
      terminalHeadline: describeTerminalHeadline(match, finalState.winnerReason),
    }),
    unavailableReason: null,
  };
}

function buildFrontierReplay(match: ReplayableMatch): MatchReplay {
  const initialState = createInitialFrontierState();
  const frames: MatchReplayFrame[] = [
    createReplayFrame({
      index: 0,
      board: renderFrontierBoard(initialState),
      headline: "Initial position",
      visual: createFrontierReplayVisual(initialState),
    }),
  ];

  for (const move of match.moves) {
    const payload = parseMovePayload(move.payloadJson);

    if (getOptionalString(payload.kind) !== "frontier-frame") {
      continue;
    }

    const board = getOptionalString(payload.board);
    const headline = getOptionalString(payload.headline);

    if (!board || !headline) {
      throw new Error("Missing Frontier replay frame fields.");
    }

    frames.push(
      createReplayFrame({
        index: frames.length,
        actorName: getOptionalString(payload.actorName) ?? getActorName(match, move.agentId),
        board,
        createdAt: getOptionalString(payload.createdAt),
        headline,
        notation: getOptionalString(payload.notation),
        isTerminal: payload.isTerminal === true,
        visual: parseFrontierReplayVisual(payload.visual),
      }),
    );
  }

  const finalState = parseFrontierState(match.stateJson);

  return {
    frames: appendTerminalFrameIfNeeded<FrontierState>({
      frames,
      currentState: finalState,
      finalBoard: renderFrontierBoard(finalState),
      finalWinner: finalState.winner,
      finalWinnerReason: finalState.winnerReason,
      terminalHeadline: describeTerminalHeadline(match, finalState.winnerReason),
      finalVisual: createFrontierReplayVisual(finalState),
    }),
    unavailableReason: null,
  };
}

function appendTerminalFrameIfNeeded<TState extends { winner: string | null; winnerReason: string | null }>(args: {
  frames: MatchReplayFrame[];
  currentState: TState;
  finalBoard: string;
  finalWinner: string | null;
  finalWinnerReason: string | null;
  terminalHeadline: string;
  finalVisual?: MatchReplayVisual | null;
}) {
  if (
    args.frames.length > 0 &&
    args.finalBoard === args.frames[args.frames.length - 1]?.board &&
    args.finalWinner === args.currentState.winner &&
    args.finalWinnerReason === args.currentState.winnerReason
  ) {
    return args.frames;
  }

  return args.frames.concat(
    createReplayFrame({
      index: args.frames.length,
      board: args.finalBoard,
      headline: args.terminalHeadline,
      isTerminal: true,
      visual: args.finalVisual ?? null,
    }),
  );
}

function createReplayFrame(args: {
  index: number;
  board: string;
  headline: string;
  notation?: string | null;
  actorName?: string | null;
  createdAt?: string | null;
  isTerminal?: boolean;
  visual?: MatchReplayVisual | null;
}): MatchReplayFrame {
  return {
    index: args.index,
    board: args.board,
    headline: args.headline,
    notation: args.notation ?? null,
    actorName: args.actorName ?? null,
    createdAt: args.createdAt ?? null,
    isTerminal: args.isTerminal ?? false,
    visual: args.visual ?? null,
  };
}

function createTicTacToeReplayVisual(state: TicTacToeState): TicTacToeReplayVisual {
  return {
    kind: "tic-tac-toe",
    board: state.board.map((row) => [...row]),
    nextMark: state.nextMark,
    winner: state.winner,
    winnerReason: state.winnerReason,
    winningLine: state.winningLine ? state.winningLine.map(([row, column]) => [row, column]) : null,
  };
}

function getActorName(match: ReplayableMatch, agentId: string) {
  if (agentId === match.playerOneId) {
    return match.playerOne.name;
  }

  if (agentId === match.playerTwoId) {
    return match.playerTwo?.name ?? null;
  }

  return null;
}

function parseMovePayload(payloadJson: string): ReplayPayload {
  const parsed = JSON.parse(payloadJson);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid replay payload.");
  }

  return parsed as ReplayPayload;
}

function getRequiredNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("Missing numeric replay payload field.");
  }

  return value;
}

function getOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getRequiredPosition(value: unknown): CheckersPosition {
  if (!value || typeof value !== "object") {
    throw new Error("Missing replay position.");
  }

  const position = value as Record<string, unknown>;

  return {
    row: getRequiredNumber(position.row),
    column: getRequiredNumber(position.column),
  };
}

function getRequiredSequence(value: unknown): CheckersPosition[] {
  if (!Array.isArray(value)) {
    throw new Error("Missing replay sequence.");
  }

  return value.map((entry) => getRequiredPosition(entry));
}

function getTicTacToeMark(value: unknown, isPlayerOne: boolean): TicTacToeMark {
  if (value === "X" || value === "O") {
    return value;
  }

  return isPlayerOne ? "X" : "O";
}

function formatCheckersPath(from: CheckersPosition, sequence: CheckersPosition[]) {
  const points = [from, ...sequence].map((position) => `${position.row},${position.column}`);
  return points.join(" -> ");
}

function resolveChessReplayMove(state: ChessState, payload: ReplayPayload): ChessMove {
  const legalMoves = getLegalChessMoves(state);
  const candidates = [
    getOptionalString(payload.notation),
    getOptionalString(payload.san),
    getOptionalString(payload.lan),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const directMatch = legalMoves.find((move) => {
      return move.notation === candidate || move.san === candidate || move.lan === candidate;
    });

    if (directMatch) {
      return directMatch;
    }
  }

  const from = getOptionalString(payload.from);
  const to = getOptionalString(payload.to);
  const promotion = getOptionalString(payload.promotion);

  if (from && to) {
    const coordinateMatch = legalMoves.find((move) => {
      return (
        move.from === from &&
        move.to === to &&
        (move.promotion ?? null) === (promotion ?? null)
      );
    });

    if (coordinateMatch) {
      return coordinateMatch;
    }
  }

  if (candidates.length > 0) {
    return parseChessMoveNotation(candidates[0], legalMoves, state);
  }

  throw new Error("Missing chess replay notation.");
}

function describeTerminalHeadline(match: ReplayableMatch, winnerReason: string | null) {
  if (match.winner) {
    return winnerReason
      ? `${match.winner.name} won by ${humanizeWinnerReason(winnerReason)}`
      : `${match.winner.name} won`;
  }

  if (match.result === "DRAW") {
    return winnerReason
      ? `Draw by ${humanizeWinnerReason(winnerReason)}`
      : "Draw";
  }

  return winnerReason
    ? `Game ended by ${humanizeWinnerReason(winnerReason)}`
    : "Final position";
}

function humanizeWinnerReason(reason: string) {
  switch (reason) {
    case "line":
      return "line";
    case "draw":
      return "full board";
    case "timeout":
      return "timeout";
    case "capture-all":
      return "capturing all pieces";
    case "no-legal-moves":
      return "no legal moves";
    case "stale-position":
      return "stale position";
    case "checkmate":
      return "checkmate";
    case "stalemate":
      return "stalemate";
    case "insufficient-material":
      return "insufficient material";
    case "threefold-repetition":
      return "threefold repetition";
    case "fifty-move-rule":
      return "the fifty-move rule";
    default:
      return reason.replaceAll("-", " ");
  }
}
