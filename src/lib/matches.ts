import { Prisma } from "@/generated/prisma/client";
import { AgentKind, MatchResult, MatchStatus } from "@/generated/prisma/enums";

import {
  applyCheckersForfeit,
  applyCheckersMove,
  getCheckersPlayerColor,
  getLegalCheckersMoves,
  parseCheckersState,
  renderCheckersBoard,
  serializeCheckersState,
  type CheckersPosition,
  type CheckersWinner,
} from "@/lib/checkers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createInitialMatchState, renderSerializedGameBoard } from "@/lib/game-state";
import { getGameDefinition, type GameKey } from "@/lib/games";
import { chooseOfficialCheckersMove, chooseOfficialTicTacToeMove } from "@/lib/official-player";
import { ensureOfficialAgents, isOfficialAgentRunnable, listRunnableOfficialAgents } from "@/lib/official-agents";
import {
  applyEloResult,
  assertGameKey,
  computeAggregateRating,
  type MatchOutcome,
} from "@/lib/rating";
import {
  applyTicTacToeForfeit,
  applyTicTacToeMove,
  boardToAscii,
  getLegalTicTacToeMoves,
  getPlayerMark,
  parseTicTacToeState,
  serializeTicTacToeState,
} from "@/lib/tic-tac-toe";

type TransactionClient = Prisma.TransactionClient;

const MATCHMAKING_POLL_INTERVAL_MS = 500;
const MATCH_TIMEOUT_SWEEP_INTERVAL_MS = 5_000;

declare global {
  var matchTimeoutWorkerStarted: boolean | undefined;
}

const matchInclude = {
  playerOne: true,
  playerTwo: true,
  winner: true,
  moves: {
    orderBy: {
      moveIndex: "asc",
    },
  },
} as const satisfies Prisma.MatchInclude;

type MatchWithDetails = Prisma.MatchGetPayload<{
  include: typeof matchInclude;
}>;

export function ensureMatchTimeoutWorker() {
  if (globalThis.matchTimeoutWorkerStarted || process.env.NODE_ENV === "test") {
    return;
  }

  globalThis.matchTimeoutWorkerStarted = true;

  const sweep = () => {
    void sweepTimedOutMatches().catch((error) => {
      console.error("Failed to sweep timed out matches", error);
    });
  };

  sweep();

  const timer = setInterval(sweep, MATCH_TIMEOUT_SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export async function getRecentMatches(limit = 12) {
  await sweepTimedOutMatches();

  return db.match.findMany({
    include: {
      playerOne: true,
      playerTwo: true,
      winner: true,
      moves: {
        orderBy: {
          moveIndex: "asc",
        },
      },
    },
    orderBy: [{ finishedAt: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });
}

export async function getAgentRecentMatches(agentId: string, limit = 10) {
  await sweepTimedOutMatchesForAgent(agentId);

  return db.match.findMany({
    where: {
      OR: [{ playerOneId: agentId }, { playerTwoId: agentId }],
    },
    include: {
      playerOne: true,
      playerTwo: true,
      winner: true,
      moves: {
        orderBy: {
          moveIndex: "asc",
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
  });
}

export async function getCompetitionSnapshot() {
  await ensureOfficialAgents();

  const [agentCount, matchCount, queueCount] = await Promise.all([
    db.agent.count(),
    db.match.count(),
    db.queueEntry.count(),
  ]);

  return {
    agentCount,
    matchCount,
    queueCount,
  };
}

export async function queueAgentForGame(agentId: string, requestedGameKey: string) {
  const gameKey = assertGameKey(requestedGameKey);
  const game = getGameDefinition(gameKey);

  if (!game?.supportedViaMcp) {
    throw new Error(`${game?.name ?? requestedGameKey} is not live in the MCP server yet.`);
  }

  await ensureOfficialAgents();
  await sweepTimedOutMatchesForAgent(agentId);

  const existingMatch = await findActiveMatchForAgentGame(agentId, gameKey);

  if (existingMatch) {
    const hydratedMatch = await playOfficialTurnsUntilHumanOrFinished(existingMatch.id);
    return toMatchedQueueResult(hydratedMatch);
  }

  const initialAttempt = await enqueueOrMatchAgainstQueuedUser(agentId, gameKey);

  if (initialAttempt.status === "matched") {
    const hydratedMatch = await playOfficialTurnsUntilHumanOrFinished(initialAttempt.match.id);
    return toMatchedQueueResult(hydratedMatch);
  }

  const waitDeadline =
    Date.now() + env.MATCHMAKING_PLATFORM_FALLBACK_SECONDS * 1000;

  while (Date.now() < waitDeadline) {
    await sleep(MATCHMAKING_POLL_INTERVAL_MS);

    const queuedMatch = await findActiveMatchForAgentGame(agentId, gameKey);

    if (queuedMatch) {
      const hydratedMatch = await playOfficialTurnsUntilHumanOrFinished(queuedMatch.id);
      return toMatchedQueueResult(hydratedMatch);
    }

    const claimedMatch = await claimQueuedHumanOpponent(agentId, gameKey);

    if (claimedMatch) {
      const hydratedMatch = await playOfficialTurnsUntilHumanOrFinished(claimedMatch.id);
      return toMatchedQueueResult(hydratedMatch);
    }
  }

  const fallbackAttempt = await createFallbackMatchForAgent(agentId, gameKey);

  if (fallbackAttempt.status === "matched") {
    const hydratedMatch = await playOfficialTurnsUntilHumanOrFinished(fallbackAttempt.match.id);
    return toMatchedQueueResult(hydratedMatch);
  }

  return initialAttempt;
}

async function enqueueOrMatchAgainstQueuedUser(agentId: string, gameKey: GameKey) {
  return db.$transaction(async (tx) => {
    const existingQueue = await tx.queueEntry.findUnique({
      where: {
        gameKey_agentId: {
          gameKey,
          agentId,
        },
      },
    });

    if (existingQueue) {
      return {
        status: "waiting" as const,
        queueEntry: existingQueue,
      };
    }

    const opponentQueue = await tx.queueEntry.findFirst({
      where: {
        gameKey,
        NOT: {
          agentId,
        },
        agent: {
          kind: AgentKind.USER,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    if (!opponentQueue) {
      const queueEntry = await tx.queueEntry.create({
        data: {
          agentId,
          gameKey,
        },
      });

      return {
        status: "waiting" as const,
        queueEntry,
      };
    }

    await tx.queueEntry.delete({
      where: {
        id: opponentQueue.id,
      },
    });

    const order =
      Math.random() > 0.5
        ? [agentId, opponentQueue.agentId]
        : [opponentQueue.agentId, agentId];

    const match = await createActiveMatch(tx, {
      gameKey,
      playerOneId: order[0],
      playerTwoId: order[1],
    });

    return {
      status: "matched" as const,
      match,
    };
  });
}

async function createFallbackMatchForAgent(agentId: string, gameKey: GameKey) {
  const officialAgents = await listRunnableOfficialAgents();

  return db.$transaction(async (tx) => {
    const existingMatch = await findActiveMatchForAgentGameInTransaction(tx, agentId, gameKey);

    if (existingMatch) {
      return {
        status: "matched" as const,
        match: existingMatch,
      };
    }

    const queueEntry = await tx.queueEntry.findUnique({
      where: {
        gameKey_agentId: {
          gameKey,
          agentId,
        },
      },
    });

    if (!queueEntry) {
      return {
        status: "waiting" as const,
        queueEntry: null,
      };
    }

    const humanOpponent = await tx.queueEntry.findFirst({
      where: {
        gameKey,
        NOT: {
          agentId,
        },
        agent: {
          kind: AgentKind.USER,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    if (humanOpponent) {
      await tx.queueEntry.delete({
        where: {
          id: humanOpponent.id,
        },
      });
      await tx.queueEntry.delete({
        where: {
          id: queueEntry.id,
        },
      });

      const order =
        Math.random() > 0.5
          ? [agentId, humanOpponent.agentId]
          : [humanOpponent.agentId, agentId];

      const match = await createActiveMatch(tx, {
        gameKey,
        playerOneId: order[0],
        playerTwoId: order[1],
      });

      return {
        status: "matched" as const,
        match,
      };
    }

    if (officialAgents.length === 0) {
      return {
        status: "waiting" as const,
        queueEntry,
      };
    }

    const officialAgent =
      officialAgents[Math.floor(Math.random() * officialAgents.length)];

    await tx.queueEntry.delete({
      where: {
        id: queueEntry.id,
      },
    });

    const order =
      Math.random() > 0.5
        ? [agentId, officialAgent.id]
        : [officialAgent.id, agentId];

    const match = await createActiveMatch(tx, {
      gameKey,
      playerOneId: order[0],
      playerTwoId: order[1],
    });

    return {
      status: "matched" as const,
      match,
    };
  });
}

async function claimQueuedHumanOpponent(agentId: string, gameKey: GameKey) {
  return db.$transaction(async (tx) => {
    const existingMatch = await findActiveMatchForAgentGameInTransaction(tx, agentId, gameKey);

    if (existingMatch) {
      return existingMatch;
    }

    const queueEntry = await tx.queueEntry.findUnique({
      where: {
        gameKey_agentId: {
          gameKey,
          agentId,
        },
      },
    });

    if (!queueEntry) {
      return null;
    }

    const humanOpponent = await tx.queueEntry.findFirst({
      where: {
        gameKey,
        NOT: {
          agentId,
        },
        agent: {
          kind: AgentKind.USER,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    if (!humanOpponent) {
      return null;
    }

    await tx.queueEntry.delete({
      where: {
        id: humanOpponent.id,
      },
    });
    await tx.queueEntry.delete({
      where: {
        id: queueEntry.id,
      },
    });

    const order =
      Math.random() > 0.5
        ? [agentId, humanOpponent.agentId]
        : [humanOpponent.agentId, agentId];

    return createActiveMatch(tx, {
      gameKey,
      playerOneId: order[0],
      playerTwoId: order[1],
    });
  });
}

async function createActiveMatch(
  tx: TransactionClient,
  args: {
    gameKey: GameKey;
    playerOneId: string;
    playerTwoId: string;
  },
) {
  const initialState = createInitialMatchState(args.gameKey);

  return tx.match.create({
    data: {
      gameKey: args.gameKey,
      status: MatchStatus.ACTIVE,
      playerOneId: args.playerOneId,
      playerTwoId: args.playerTwoId,
      currentTurnAgentId: args.playerOneId,
      startedAt: new Date(),
      stateJson: initialState.stateJson,
    },
    include: matchInclude,
  });
}

async function findActiveMatchForAgentGame(agentId: string, gameKey: GameKey) {
  return db.match.findFirst({
    where: {
      gameKey,
      status: MatchStatus.ACTIVE,
      OR: [{ playerOneId: agentId }, { playerTwoId: agentId }],
    },
    include: matchInclude,
    orderBy: {
      updatedAt: "desc",
    },
  });
}

async function findActiveMatchForAgentGameInTransaction(
  tx: TransactionClient,
  agentId: string,
  gameKey: GameKey,
) {
  return tx.match.findFirst({
    where: {
      gameKey,
      status: MatchStatus.ACTIVE,
      OR: [{ playerOneId: agentId }, { playerTwoId: agentId }],
    },
    include: matchInclude,
    orderBy: {
      updatedAt: "desc",
    },
  });
}

function toMatchedQueueResult(match: MatchWithDetails) {
  return {
    status: "matched" as const,
    match,
    board: renderSerializedGameBoard(match.gameKey, match.stateJson) ?? "Board state unavailable",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMatchTimeoutCutoff(referenceDate = new Date()) {
  return new Date(referenceDate.getTime() - env.MATCH_MOVE_TIMEOUT_SECONDS * 1000);
}

function isMatchTimedOut(
  match: Pick<MatchWithDetails, "status" | "currentTurnAgentId" | "updatedAt">,
  referenceDate = new Date(),
) {
  return (
    match.status === MatchStatus.ACTIVE &&
    Boolean(match.currentTurnAgentId) &&
    match.updatedAt <= getMatchTimeoutCutoff(referenceDate)
  );
}

async function sweepTimedOutMatches(limit = 25) {
  const matches = await db.match.findMany({
    where: {
      status: MatchStatus.ACTIVE,
      currentTurnAgentId: {
        not: null,
      },
      updatedAt: {
        lte: getMatchTimeoutCutoff(),
      },
    },
    select: {
      id: true,
    },
    orderBy: {
      updatedAt: "asc",
    },
    take: limit,
  });

  for (const match of matches) {
    await resolveTimedOutMatch(match.id);
  }
}

async function sweepTimedOutMatchesForAgent(agentId: string) {
  const matches = await db.match.findMany({
    where: {
      status: MatchStatus.ACTIVE,
      currentTurnAgentId: {
        not: null,
      },
      updatedAt: {
        lte: getMatchTimeoutCutoff(),
      },
      OR: [{ playerOneId: agentId }, { playerTwoId: agentId }],
    },
    select: {
      id: true,
    },
    orderBy: {
      updatedAt: "asc",
    },
  });

  for (const match of matches) {
    await resolveTimedOutMatch(match.id);
  }
}

async function resolveTimedOutMatch(matchId: string) {
  const match = await getMatchWithDetails(matchId);

  if (!isMatchTimedOut(match) || !match.currentTurnAgentId) {
    return match;
  }

  return forfeitMatch(matchId, match.currentTurnAgentId);
}

async function forfeitMatch(matchId: string, forfeitingAgentId: string) {
  return db.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: matchId },
      include: matchInclude,
    });

    if (!match) {
      throw new Error("Match not found.");
    }

    if (
      match.status !== MatchStatus.ACTIVE ||
      !match.currentTurnAgentId ||
      match.currentTurnAgentId !== forfeitingAgentId ||
      !match.playerTwoId ||
      !match.playerTwo
    ) {
      return match;
    }

    const outcome =
      forfeitingAgentId === match.playerOneId ? "playerTwo" : "playerOne";
    const result = fromOutcome(outcome);
    const winnerAgentId =
      outcome === "playerOne" ? match.playerOneId : match.playerTwoId;
    const nextStateJson = createForfeitStateJson(match, outcome);

    const update = await tx.match.updateMany({
      where: {
        id: match.id,
        status: MatchStatus.ACTIVE,
        currentTurnAgentId: forfeitingAgentId,
        updatedAt: match.updatedAt,
      },
      data: {
        currentTurnAgentId: null,
        finishedAt: new Date(),
        result,
        stateJson: nextStateJson,
        status: MatchStatus.FINISHED,
        winnerAgentId,
      },
    });

    if (update.count === 1) {
      await applyRatingsForCompletedMatch(tx, {
        gameKey: assertGameKey(match.gameKey),
        playerOneId: match.playerOneId,
        playerTwoId: match.playerTwoId,
        outcome,
      });
    }

    return tx.match.findUniqueOrThrow({
      where: { id: match.id },
      include: matchInclude,
    });
  });
}

function createForfeitStateJson(match: MatchWithDetails, outcome: MatchOutcome) {
  if (match.gameKey === "tic-tac-toe") {
    const state = parseTicTacToeState(match.stateJson);
    return serializeTicTacToeState(
      applyTicTacToeForfeit(state, outcome === "playerOne" ? "X" : "O"),
    );
  }

  const state = parseCheckersState(match.stateJson);
  return serializeCheckersState(
    applyCheckersForfeit(state, outcome === "playerOne" ? "RED" : "BLACK"),
  );
}

export async function listMatchesForAgent(agentId: string) {
  await sweepTimedOutMatchesForAgent(agentId);

  return db.match.findMany({
    where: {
      OR: [{ playerOneId: agentId }, { playerTwoId: agentId }],
    },
    include: {
      playerOne: true,
      playerTwo: true,
      winner: true,
      moves: {
        orderBy: {
          moveIndex: "asc",
        },
      },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 20,
  });
}

export async function getCheckersMatchStateForAgent(args: {
  agentId: string;
  matchId: string;
}) {
  const match = await playOfficialTurnsUntilHumanOrFinished(args.matchId);

  if (!match || match.gameKey !== "checkers") {
    throw new Error("Match not found.");
  }

  if (match.playerOneId !== args.agentId && match.playerTwoId !== args.agentId) {
    throw new Error("You are not a participant in this match.");
  }

  const state = parseCheckersState(match.stateJson);
  const pieceColor = getCheckersPlayerColor(match.playerOneId === args.agentId);
  const isYourTurn =
    match.status === MatchStatus.ACTIVE && match.currentTurnAgentId === args.agentId;

  return {
    match,
    board: renderCheckersBoard(state.board),
    pieceColor,
    isYourTurn,
    legalMoves: isYourTurn ? getLegalCheckersMoves(state) : [],
    winner: state.winner,
    winnerReason: state.winnerReason,
    turnCount: state.turnCount,
    staleHalfmoveCount: state.staleHalfmoveCount,
  };
}

export async function playTicTacToeTurn(args: {
  agentId: string;
  matchId: string;
  row: number;
  column: number;
}, options?: { autoPlayOfficialFollowUp?: boolean }) {
  await resolveTimedOutMatch(args.matchId);

  const result = await db.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: args.matchId },
      include: matchInclude,
    });

    if (!match || match.gameKey !== "tic-tac-toe") {
      throw new Error("Match not found.");
    }

    if (match.status !== MatchStatus.ACTIVE) {
      throw new Error("This match is not active.");
    }

    if (!match.playerTwoId || !match.playerTwo) {
      throw new Error("This match is missing an opponent.");
    }

    if (match.currentTurnAgentId !== args.agentId) {
      throw new Error("It is not your turn.");
    }

    const state = parseTicTacToeState(match.stateJson);
    const mark = getPlayerMark(match.playerOneId === args.agentId);
    const nextState = applyTicTacToeMove(state, args.row, args.column, mark);
    const isFinished = nextState.winner !== null;
    const nextTurnAgentId = isFinished
      ? null
      : args.agentId === match.playerOneId
        ? match.playerTwoId
        : match.playerOneId;

    const matchResult =
      nextState.winner === "X"
        ? MatchResult.PLAYER_ONE
        : nextState.winner === "O"
          ? MatchResult.PLAYER_TWO
          : nextState.winner === "DRAW"
            ? MatchResult.DRAW
            : null;

    const winnerAgentId =
      nextState.winner === "X"
        ? match.playerOneId
        : nextState.winner === "O"
          ? match.playerTwoId
          : null;

    const updatedMatch = await tx.match.update({
      where: { id: match.id },
      data: {
        currentTurnAgentId: nextTurnAgentId,
        finishedAt: isFinished ? new Date() : null,
        result: matchResult,
        stateJson: serializeTicTacToeState(nextState),
        status: isFinished ? MatchStatus.FINISHED : MatchStatus.ACTIVE,
        winnerAgentId,
        moves: {
          create: {
            agentId: args.agentId,
            moveIndex: match.moves.length,
            payloadJson: JSON.stringify({
              row: args.row,
              column: args.column,
              mark,
            }),
          },
        },
      },
      include: matchInclude,
    });

    if (isFinished && matchResult) {
      await applyRatingsForCompletedMatch(tx, {
        gameKey: "tic-tac-toe",
        playerOneId: match.playerOneId,
        playerTwoId: match.playerTwoId,
        outcome: toOutcome(matchResult),
      });
    }

    return {
      match: updatedMatch,
      board: boardToAscii(nextState.board),
      winner: nextState.winner,
    };
  });

  if (options?.autoPlayOfficialFollowUp === false) {
    return result;
  }

  const hydratedMatch = await playOfficialTurnsUntilHumanOrFinished(result.match.id);
  const state = parseTicTacToeState(hydratedMatch.stateJson);

  return {
    match: hydratedMatch,
    board: boardToAscii(state.board),
    winner: state.winner,
  };
}

export async function playCheckersTurn(args: {
  agentId: string;
  matchId: string;
  fromRow: number;
  fromColumn: number;
  sequence: CheckersPosition[];
}, options?: { autoPlayOfficialFollowUp?: boolean }) {
  await resolveTimedOutMatch(args.matchId);

  const result = await db.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: args.matchId },
      include: matchInclude,
    });

    if (!match || match.gameKey !== "checkers") {
      throw new Error("Match not found.");
    }

    if (match.status !== MatchStatus.ACTIVE) {
      throw new Error("This match is not active.");
    }

    if (!match.playerTwoId || !match.playerTwo) {
      throw new Error("This match is missing an opponent.");
    }

    if (match.currentTurnAgentId !== args.agentId) {
      throw new Error("It is not your turn.");
    }

    const state = parseCheckersState(match.stateJson);
    const nextState = applyCheckersMove(state, {
      fromRow: args.fromRow,
      fromColumn: args.fromColumn,
      sequence: args.sequence,
    });
    const isFinished = nextState.winner !== null;
    const nextTurnAgentId = isFinished
      ? null
      : args.agentId === match.playerOneId
        ? match.playerTwoId
        : match.playerOneId;
    const matchResult = nextState.winner
      ? fromCheckersWinner(nextState.winner)
      : null;
    const winnerAgentId =
      nextState.winner === "RED"
        ? match.playerOneId
        : nextState.winner === "BLACK"
          ? match.playerTwoId
          : null;
    const moveRecord = nextState.lastMove;

    const updatedMatch = await tx.match.update({
      where: { id: match.id },
      data: {
        currentTurnAgentId: nextTurnAgentId,
        finishedAt: isFinished ? new Date() : null,
        result: matchResult,
        stateJson: serializeCheckersState(nextState),
        status: isFinished ? MatchStatus.FINISHED : MatchStatus.ACTIVE,
        winnerAgentId,
        moves: {
          create: {
            agentId: args.agentId,
            moveIndex: match.moves.length,
            payloadJson: JSON.stringify({
              from: { row: args.fromRow, column: args.fromColumn },
              sequence: args.sequence,
              notation: moveRecord?.notation ?? null,
              captures: moveRecord?.captures ?? [],
            }),
          },
        },
      },
      include: matchInclude,
    });

    if (isFinished && matchResult) {
      await applyRatingsForCompletedMatch(tx, {
        gameKey: "checkers",
        playerOneId: match.playerOneId,
        playerTwoId: match.playerTwoId,
        outcome: toOutcome(matchResult),
      });
    }

    return {
      match: updatedMatch,
      board: renderCheckersBoard(nextState.board),
      winner: nextState.winner,
      winnerReason: nextState.winnerReason,
      lastMove: moveRecord,
    };
  });

  if (options?.autoPlayOfficialFollowUp === false) {
    return result;
  }

  const hydratedMatch = await playOfficialTurnsUntilHumanOrFinished(result.match.id);
  const state = parseCheckersState(hydratedMatch.stateJson);

  return {
    match: hydratedMatch,
    board: renderCheckersBoard(state.board),
    winner: state.winner,
    winnerReason: state.winnerReason,
    lastMove: state.lastMove,
  };
}

async function playOfficialTurnsUntilHumanOrFinished(matchId: string) {
  let match = await getMatchWithDetails(matchId);

  while (match.status === MatchStatus.ACTIVE && match.currentTurnAgentId) {
    match = await resolveTimedOutMatch(match.id);

    if (match.status !== MatchStatus.ACTIVE || !match.currentTurnAgentId) {
      return match;
    }

    const officialAgent = getCurrentTurnOfficialAgent(match);

    if (!officialAgent || !isOfficialAgentRunnable(officialAgent)) {
      return match;
    }

    if (!officialAgent.provider) {
      return match;
    }

    if (match.gameKey === "tic-tac-toe") {
      const state = parseTicTacToeState(match.stateJson);
      const legalMoves = getLegalTicTacToeMoves(state);

      if (legalMoves.length === 0) {
        return match;
      }

      try {
        const move = await chooseOfficialTicTacToeMove({
          provider: officialAgent.provider,
          modelId: officialAgent.modelId ?? officialAgent.name,
          board: boardToAscii(state.board),
          legalMoves,
          mark: getPlayerMark(match.playerOneId === officialAgent.id),
        });

        await playTicTacToeTurn(
          {
            agentId: officialAgent.id,
            matchId: match.id,
            row: move.row,
            column: move.column,
          },
          {
            autoPlayOfficialFollowUp: false,
          },
        );
      } catch (error) {
        console.warn(`Official move failed for ${officialAgent.name}; forfeiting match ${match.id}.`, error);
        return forfeitMatch(match.id, officialAgent.id);
      }
    } else if (match.gameKey === "checkers") {
      const state = parseCheckersState(match.stateJson);
      const legalMoves = getLegalCheckersMoves(state);

      if (legalMoves.length === 0) {
        return match;
      }

      try {
        const move = await chooseOfficialCheckersMove({
          provider: officialAgent.provider,
          modelId: officialAgent.modelId ?? officialAgent.name,
          board: renderCheckersBoard(state.board),
          legalMoves,
          color: getCheckersPlayerColor(match.playerOneId === officialAgent.id),
        });

        await playCheckersTurn(
          {
            agentId: officialAgent.id,
            matchId: match.id,
            fromRow: move.from.row,
            fromColumn: move.from.column,
            sequence: move.sequence,
          },
          {
            autoPlayOfficialFollowUp: false,
          },
        );
      } catch (error) {
        console.warn(`Official move failed for ${officialAgent.name}; forfeiting match ${match.id}.`, error);
        return forfeitMatch(match.id, officialAgent.id);
      }
    }

    match = await getMatchWithDetails(match.id);
  }

  return match;
}

function getCurrentTurnOfficialAgent(match: MatchWithDetails) {
  if (!match.currentTurnAgentId) {
    return null;
  }

  if (match.playerOneId === match.currentTurnAgentId && match.playerOne.kind === AgentKind.OFFICIAL) {
    return match.playerOne;
  }

  if (match.playerTwoId === match.currentTurnAgentId && match.playerTwo?.kind === AgentKind.OFFICIAL) {
    return match.playerTwo;
  }

  return null;
}

async function getMatchWithDetails(matchId: string) {
  const match = await db.match.findUnique({
    where: { id: matchId },
    include: matchInclude,
  });

  if (!match) {
    throw new Error("Match not found.");
  }

  return match;
}

export async function reportCompletedMatch(args: {
  gameKey: string;
  playerOneId: string;
  playerTwoId: string;
  outcome: MatchOutcome;
  source?: string;
}) {
  const gameKey = assertGameKey(args.gameKey);

  return db.$transaction(async (tx) => {
    const [playerOne, playerTwo] = await Promise.all([
      tx.agent.findUnique({ where: { id: args.playerOneId } }),
      tx.agent.findUnique({ where: { id: args.playerTwoId } }),
    ]);

    if (!playerOne || !playerTwo) {
      throw new Error("Both agents must exist before a result can be recorded.");
    }

    const match = await tx.match.create({
      data: {
        gameKey,
        status: MatchStatus.FINISHED,
        result: fromOutcome(args.outcome),
        playerOneId: args.playerOneId,
        playerTwoId: args.playerTwoId,
        winnerAgentId:
          args.outcome === "playerOne"
            ? args.playerOneId
            : args.outcome === "playerTwo"
              ? args.playerTwoId
              : null,
        startedAt: new Date(),
        finishedAt: new Date(),
        stateJson: JSON.stringify({
          source: args.source ?? "manual-report",
          outcome: args.outcome,
        }),
      },
      include: {
        playerOne: true,
        playerTwo: true,
        winner: true,
      },
    });

    await applyRatingsForCompletedMatch(tx, {
      gameKey,
      playerOneId: args.playerOneId,
      playerTwoId: args.playerTwoId,
      outcome: args.outcome,
    });

    return match;
  });
}

async function applyRatingsForCompletedMatch(
  tx: TransactionClient,
  args: {
    gameKey: GameKey;
    playerOneId: string;
    playerTwoId: string;
    outcome: MatchOutcome;
  },
) {
  const [playerOneRating, playerTwoRating] = await Promise.all([
    tx.rating.findUniqueOrThrow({
      where: {
        agentId_gameKey: {
          agentId: args.playerOneId,
          gameKey: args.gameKey,
        },
      },
    }),
    tx.rating.findUniqueOrThrow({
      where: {
        agentId_gameKey: {
          agentId: args.playerTwoId,
          gameKey: args.gameKey,
        },
      },
    }),
  ]);

  const nextRatings = applyEloResult(
    playerOneRating.rating,
    playerTwoRating.rating,
    args.outcome,
  );

  await Promise.all([
    tx.rating.update({
      where: { id: playerOneRating.id },
      data: {
        rating: nextRatings.ratingOne,
        gamesPlayed: { increment: 1 },
        wins: args.outcome === "playerOne" ? { increment: 1 } : undefined,
        losses: args.outcome === "playerTwo" ? { increment: 1 } : undefined,
        draws: args.outcome === "draw" ? { increment: 1 } : undefined,
      },
    }),
    tx.rating.update({
      where: { id: playerTwoRating.id },
      data: {
        rating: nextRatings.ratingTwo,
        gamesPlayed: { increment: 1 },
        wins: args.outcome === "playerTwo" ? { increment: 1 } : undefined,
        losses: args.outcome === "playerOne" ? { increment: 1 } : undefined,
        draws: args.outcome === "draw" ? { increment: 1 } : undefined,
      },
    }),
  ]);

  await Promise.all([
    refreshAgentAggregate(tx, args.playerOneId),
    refreshAgentAggregate(tx, args.playerTwoId),
  ]);
}

async function refreshAgentAggregate(tx: TransactionClient, agentId: string) {
  const ratings = await tx.rating.findMany({
    where: { agentId },
  });

  await tx.agent.update({
    where: { id: agentId },
    data: {
      aggregateRating: computeAggregateRating(ratings),
      aggregateGamesPlayed: ratings.reduce((sum, rating) => sum + rating.gamesPlayed, 0),
    },
  });
}

function fromOutcome(outcome: MatchOutcome): MatchResult {
  switch (outcome) {
    case "playerOne":
      return MatchResult.PLAYER_ONE;
    case "playerTwo":
      return MatchResult.PLAYER_TWO;
    case "draw":
      return MatchResult.DRAW;
  }
}

function fromCheckersWinner(winner: CheckersWinner): MatchResult {
  switch (winner) {
    case "RED":
      return MatchResult.PLAYER_ONE;
    case "BLACK":
      return MatchResult.PLAYER_TWO;
    case "DRAW":
      return MatchResult.DRAW;
  }
}

function toOutcome(result: MatchResult): MatchOutcome {
  switch (result) {
    case MatchResult.PLAYER_ONE:
      return "playerOne";
    case MatchResult.PLAYER_TWO:
      return "playerTwo";
    case MatchResult.DRAW:
      return "draw";
  }
}

export function serializeMatchForMcp(match: Prisma.MatchGetPayload<{
  include: {
    playerOne: true;
    playerTwo: true;
    winner: true;
    moves: true;
  };
}>) {
  const board = renderSerializedGameBoard(match.gameKey, match.stateJson);

  return {
    id: match.id,
    gameKey: match.gameKey,
    status: match.status,
    result: match.result,
    currentTurnAgentId: match.currentTurnAgentId,
    playerOne: match.playerOne.name,
    playerTwo: match.playerTwo?.name ?? null,
    winner: match.winner?.name ?? null,
    board: board ?? "Board state unavailable",
    moveCount: match.moves.length,
    updatedAt: match.updatedAt.toISOString(),
  };
}
