import { Prisma } from "@/generated/prisma/client";
import { AgentKind, MatchResult, MatchStatus } from "@/generated/prisma/enums";

import {
  applyCheckersForfeit,
  applyCheckersMove,
  getCheckersPlayerColor,
  getLegalCheckersMoves,
  parseCheckersMoveNotation,
  parseCheckersState,
  renderCheckersBoard,
  serializeCheckersState,
  type CheckersWinner,
} from "@/lib/checkers";
import {
  applyChessForfeit,
  applyChessMove,
  getChessPlayerColor,
  getLegalChessMoves,
  hydrateChess,
  parseChessMoveNotation,
  parseChessState,
  renderChessBoard,
  serializeChessState,
  type ChessWinner,
} from "@/lib/chess";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  applyFrontierCommandActions,
  createFrontierReplayVisual,
  FRONTIER_COMMAND_WINDOW_MS,
  FRONTIER_MATCH_DURATION_MS,
  FRONTIER_RULES_TEXT,
  FRONTIER_TICK_MS,
  getFrontierOpponent,
  getFrontierOwner,
  getFrontierOwnerLabel,
  getFrontierSecondsRemaining,
  getFrontierSecondsUntilNextWindow,
  getFrontierWindowIndex,
  parseFrontierState,
  renderFrontierBoard,
  serializeFrontierState,
  tickFrontierState,
  type FrontierAction,
  type FrontierOwner,
  type FrontierSimulationEvent,
  type FrontierState,
} from "@/lib/frontier";
import { createInitialMatchState, renderSerializedGameBoard } from "@/lib/game-state";
import { getGameDefinition, type GameKey } from "@/lib/games";
import {
  chooseOfficialFrontierActions,
  chooseOfficialCheckersMove,
  chooseOfficialChessMove,
  chooseOfficialTicTacToeMove,
} from "@/lib/official-player";
import {
  ensureOfficialAgents,
  getVisibleAgentWhere,
  isOfficialAgentRunnable,
  listEligibleOfficialAgentsForGame,
  listRunnableOfficialAgents,
} from "@/lib/official-agents";
import {
  applyEloResult,
  assertGameKey,
  computeAggregateRating,
  ensureAllAgentsHaveCurrentRatings,
  type MatchOutcome,
} from "@/lib/rating";
import {
  applyTicTacToeForfeit,
  applyTicTacToeMove,
  boardToAscii,
  getLegalTicTacToeMoves,
  getPlayerMark,
  parseTicTacToeMoveNotation,
  parseTicTacToeState,
  renderTicTacToeBoard,
  serializeTicTacToeState,
} from "@/lib/tic-tac-toe";

type TransactionClient = Prisma.TransactionClient;

const MATCHMAKING_POLL_INTERVAL_MS = 500;
const MATCH_TIMEOUT_SWEEP_INTERVAL_MS = 5_000;
const FRONTIER_MATCH_SWEEP_INTERVAL_MS = 1_000;

declare global {
  var matchTimeoutWorkerStarted: boolean | undefined;
  var frontierMatchWorkerStarted: boolean | undefined;
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
  ensureFrontierMatchWorker();

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

function ensureFrontierMatchWorker() {
  if (globalThis.frontierMatchWorkerStarted || process.env.NODE_ENV === "test") {
    return;
  }

  globalThis.frontierMatchWorkerStarted = true;

  const sweep = () => {
    void sweepActiveFrontierMatches().catch((error) => {
      console.error("Failed to advance active Frontier matches", error);
    });
  };

  sweep();

  const timer = setInterval(sweep, FRONTIER_MATCH_SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export async function getRecentMatches(limit = 12) {
  await Promise.all([sweepTimedOutMatches(), sweepActiveFrontierMatches()]);
  const visibleAgentWhere = getVisibleAgentWhere();

  return db.match.findMany({
    where: {
      playerOne: {
        is: visibleAgentWhere,
      },
      playerTwo: {
        is: visibleAgentWhere,
      },
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
    orderBy: [{ finishedAt: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });
}

export async function getAgentRecentMatches(agentId: string, limit = 10) {
  await Promise.all([
    sweepTimedOutMatchesForAgent(agentId),
    sweepActiveFrontierMatchesForAgent(agentId),
  ]);
  const visibleAgentWhere = getVisibleAgentWhere();

  return db.match.findMany({
    where: {
      playerOne: {
        is: visibleAgentWhere,
      },
      playerTwo: {
        is: visibleAgentWhere,
      },
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
  const visibleAgentWhere = getVisibleAgentWhere();
  const onlineCutoff = new Date(Date.now() - 30 * 60 * 1000);

  const [agentCount, matchCount, onlineAgentCount] = await Promise.all([
    db.agent.count({
      where: visibleAgentWhere,
    }),
    db.match.count({
      where: {
        playerOne: {
          is: visibleAgentWhere,
        },
        playerTwo: {
          is: visibleAgentWhere,
        },
      },
    }),
    db.agent.count({
      where: {
        AND: [
          visibleAgentWhere,
          {
            OR: [
              {
                oauthClients: {
                  some: {
                    revokedAt: null,
                    lastUsedAt: {
                      gte: onlineCutoff,
                    },
                  },
                },
              },
              {
                oauthAccessTokens: {
                  some: {
                    revokedAt: null,
                    lastUsedAt: {
                      gte: onlineCutoff,
                    },
                  },
                },
              },
              {
                queueEntries: {
                  some: {
                    createdAt: {
                      gte: onlineCutoff,
                    },
                  },
                },
              },
              {
                matchesAsPlayerOne: {
                  some: {
                    updatedAt: {
                      gte: onlineCutoff,
                    },
                  },
                },
              },
              {
                matchesAsPlayerTwo: {
                  some: {
                    updatedAt: {
                      gte: onlineCutoff,
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    }),
  ]);

  return {
    agentCount,
    matchCount,
    onlineAgentCount,
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
  const officialAgents =
    gameKey === "frontier"
      ? await listEligibleOfficialAgentsForGame(gameKey)
      : await listRunnableOfficialAgents();

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
      currentTurnAgentId: args.gameKey === "frontier" ? null : args.playerOneId,
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

async function sweepActiveFrontierMatches(limit = 25) {
  const matches = await db.match.findMany({
    where: {
      gameKey: "frontier",
      status: MatchStatus.ACTIVE,
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
    await advanceFrontierMatchToNow(match.id);
  }
}

async function sweepActiveFrontierMatchesForAgent(agentId: string) {
  const matches = await db.match.findMany({
    where: {
      gameKey: "frontier",
      status: MatchStatus.ACTIVE,
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
    await advanceFrontierMatchToNow(match.id);
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

  if (match.gameKey === "chess") {
    const state = parseChessState(match.stateJson);
    return serializeChessState(
      applyChessForfeit(state, outcome === "playerOne" ? "WHITE" : "BLACK"),
    );
  }

  const state = parseCheckersState(match.stateJson);
  return serializeCheckersState(
    applyCheckersForfeit(state, outcome === "playerOne" ? "RED" : "BLACK"),
  );
}

export async function listMatchesForAgent(agentId: string) {
  await Promise.all([
    sweepTimedOutMatchesForAgent(agentId),
    sweepActiveFrontierMatchesForAgent(agentId),
  ]);

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

export async function getTicTacToeMatchStateForAgent(args: {
  agentId: string;
  matchId: string;
}) {
  const match = await playOfficialTurnsUntilHumanOrFinished(args.matchId);

  if (!match || match.gameKey !== "tic-tac-toe") {
    throw new Error("Match not found.");
  }

  assertAgentIsMatchParticipant(match, args.agentId);

  const state = parseTicTacToeState(match.stateJson);
  const mark = getPlayerMark(match.playerOneId === args.agentId);
  const isYourTurn =
    match.status === MatchStatus.ACTIVE && match.currentTurnAgentId === args.agentId;
  const timing = getMatchTurnTiming(match);

  return {
    match,
    board: renderTicTacToeBoard(state.board),
    mark,
    isYourTurn,
    legalMoves: isYourTurn ? getLegalTicTacToeMoves(state) : [],
    winner: state.winner,
    winnerReason: state.winnerReason,
    turnCount: state.turnCount,
    winningLine: state.winningLine,
    currentTurnAgentName: getCurrentTurnAgentName(match),
    turnDeadlineAt: timing.turnDeadlineAt,
    secondsRemaining: timing.secondsRemaining,
    moveTimeoutSeconds: env.MATCH_MOVE_TIMEOUT_SECONDS,
  };
}

export async function waitForTurnOrMatchEndForAgent(args: {
  agentId: string;
  matchId: string;
  maxWaitSeconds?: number;
}) {
  const maxWaitMs = Math.max(0, (args.maxWaitSeconds ?? 25) * 1000);
  const waitDeadline = Date.now() + maxWaitMs;
  let match = await playOfficialTurnsUntilHumanOrFinished(args.matchId);
  const initialUpdatedAt = match.updatedAt.getTime();

  assertAgentIsMatchParticipant(match, args.agentId);

  while (
    match.status === MatchStatus.ACTIVE &&
    !(
      match.currentTurnAgentId
        ? match.currentTurnAgentId === args.agentId
        : match.updatedAt.getTime() > initialUpdatedAt
    ) &&
    Date.now() < waitDeadline
  ) {
    await sleep(Math.min(MATCHMAKING_POLL_INTERVAL_MS, waitDeadline - Date.now()));
    match = await playOfficialTurnsUntilHumanOrFinished(args.matchId);
  }

  return {
    match,
    timedOutWaiting:
      match.status === MatchStatus.ACTIVE &&
      !(
        match.currentTurnAgentId
          ? match.currentTurnAgentId === args.agentId
          : match.updatedAt.getTime() > initialUpdatedAt
      ) &&
      Date.now() >= waitDeadline,
  };
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

export async function getChessMatchStateForAgent(args: {
  agentId: string;
  matchId: string;
}) {
  const match = await playOfficialTurnsUntilHumanOrFinished(args.matchId);

  if (!match || match.gameKey !== "chess") {
    throw new Error("Match not found.");
  }

  if (match.playerOneId !== args.agentId && match.playerTwoId !== args.agentId) {
    throw new Error("You are not a participant in this match.");
  }

  const state = parseChessState(match.stateJson);
  const pieceColor = getChessPlayerColor(match.playerOneId === args.agentId);
  const isYourTurn =
    match.status === MatchStatus.ACTIVE && match.currentTurnAgentId === args.agentId;
  const chess = hydrateChess(state);

  return {
    match,
    board: renderChessBoard(state),
    fen: state.fen,
    pieceColor,
    isYourTurn,
    isCheck: chess.isCheck(),
    legalMoves: isYourTurn ? getLegalChessMoves(state) : [],
    winner: state.winner,
    winnerReason: state.winnerReason,
    turnCount: state.turnCount,
  };
}

export async function getFrontierMatchStateForAgent(args: {
  agentId: string;
  matchId: string;
}) {
  const match = await advanceFrontierMatchToNow(args.matchId);

  if (!match || match.gameKey !== "frontier") {
    throw new Error("Match not found.");
  }

  assertAgentIsMatchParticipant(match, args.agentId);

  if (!match.startedAt) {
    throw new Error("Frontier match has not started.");
  }

  const state = parseFrontierState(match.stateJson);
  const owner = getFrontierOwner(match.playerOneId === args.agentId);
  const opponentOwner = getFrontierOpponent(owner);
  const currentWindowIndex = getFrontierWindowIndex(state.elapsedMs);
  const pendingCommands = state.pendingCommands[owner];
  const nextWindowClosesAt = new Date(
    match.startedAt.getTime() + (currentWindowIndex + 1) * FRONTIER_COMMAND_WINDOW_MS,
  ).toISOString();

  return {
    match,
    board: renderFrontierBoard(state),
    youAre: owner,
    yourLabel: getFrontierOwnerLabel(owner),
    opponentLabel: getFrontierOwnerLabel(opponentOwner),
    currentWindowIndex,
    secondsUntilNextWindow: getFrontierSecondsUntilNextWindow(state),
    matchSecondsRemaining: getFrontierSecondsRemaining(state),
    nextWindowClosesAt,
    income: state.income,
    incomePerSecond: {
      [owner]: getFrontierIncomePerSecondForMatch(state, owner),
      [opponentOwner]: getFrontierIncomePerSecondForMatch(state, opponentOwner),
    },
    ownedArmies: state.armies
      .filter((army) => army.owner === owner)
      .map((army) => serializeFrontierArmyForAgent(army)),
    enemyArmies: state.armies
      .filter((army) => army.owner === opponentOwner)
      .map((army) => serializeFrontierArmyForAgent(army)),
    sites: state.sites.map((site) => ({
      id: site.id,
      x: site.x,
      y: site.y,
      controller: site.controller,
      captureOwner: site.captureOwner,
      captureProgressMs: site.captureProgressMs,
    })),
    bases: state.bases.map((base) => ({
      id: base.id,
      owner: base.owner,
      label: getFrontierOwnerLabel(base.owner),
      x: base.x,
      y: base.y,
      alive: base.alive,
    })),
    pendingSubmission:
      pendingCommands && pendingCommands.windowIndex === currentWindowIndex
        ? {
            windowIndex: pendingCommands.windowIndex,
            actions: pendingCommands.actions,
          }
        : null,
    winner: state.winner,
    winnerReason: state.winnerReason,
    rules: FRONTIER_RULES_TEXT,
  };
}

export async function submitFrontierOrdersForAgent(args: {
  agentId: string;
  matchId: string;
  actions: FrontierAction[];
}) {
  await advanceFrontierMatchToNow(args.matchId);

  const result = await db.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: args.matchId },
      include: matchInclude,
    });

    if (!match || match.gameKey !== "frontier") {
      throw new Error("Match not found.");
    }

    assertAgentIsMatchParticipant(match, args.agentId);

    if (match.status !== MatchStatus.ACTIVE) {
      throw new Error("This match is not active.");
    }

    const state = parseFrontierState(match.stateJson);
    const owner = getFrontierOwner(match.playerOneId === args.agentId);
    const currentWindowIndex = getFrontierWindowIndex(state.elapsedMs);
    const { appliedActions } = applyFrontierCommandActions(state, owner, args.actions);

    if (appliedActions.length === 0) {
      throw new Error("No valid Frontier actions were provided.");
    }

    state.pendingCommands[owner] = {
      windowIndex: currentWindowIndex,
      actions: appliedActions,
    };

    const update = await tx.match.updateMany({
      where: {
        id: match.id,
        updatedAt: match.updatedAt,
        status: MatchStatus.ACTIVE,
      },
      data: {
        stateJson: serializeFrontierState(state),
      },
    });

    if (update.count !== 1) {
      return {
        match: await tx.match.findUniqueOrThrow({
          where: { id: match.id },
          include: matchInclude,
        }),
        acceptedActions: appliedActions,
        currentWindowIndex,
      };
    }

    return {
      match: await tx.match.findUniqueOrThrow({
        where: { id: match.id },
        include: matchInclude,
      }),
      acceptedActions: appliedActions,
      currentWindowIndex,
    };
  });

  const state = await getFrontierMatchStateForAgent({
    agentId: args.agentId,
    matchId: result.match.id,
  });

  return {
    ...state,
    acceptedActions: result.acceptedActions,
    submissionWindowIndex: result.currentWindowIndex,
  };
}

export async function playTicTacToeTurn(args: {
  agentId: string;
  matchId: string;
  notation: string;
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
    const move = parseTicTacToeMoveNotation(args.notation, getLegalTicTacToeMoves(state));
    const mark = getPlayerMark(match.playerOneId === args.agentId);
    const nextState = applyTicTacToeMove(state, move.row, move.column, mark);
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
              notation: move.notation,
              row: move.row,
              column: move.column,
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
      board: renderTicTacToeBoard(nextState.board),
      winner: nextState.winner,
      winnerReason: nextState.winnerReason,
    };
  });

  if (options?.autoPlayOfficialFollowUp === false) {
    return result;
  }

  const hydratedMatch = await playOfficialTurnsUntilHumanOrFinished(result.match.id);
  const state = parseTicTacToeState(hydratedMatch.stateJson);

  return {
    match: hydratedMatch,
    board: renderTicTacToeBoard(state.board),
    winner: state.winner,
    winnerReason: state.winnerReason,
  };
}

export async function playCheckersTurn(args: {
  agentId: string;
  matchId: string;
  notation: string;
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
    const move = parseCheckersMoveNotation(args.notation, getLegalCheckersMoves(state));
    const nextState = applyCheckersMove(state, {
      fromRow: move.from.row,
      fromColumn: move.from.column,
      sequence: move.sequence,
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
              from: move.from,
              sequence: move.sequence,
              notation: move.notation,
              captures: move.captures,
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

export async function playChessTurn(args: {
  agentId: string;
  matchId: string;
  notation: string;
}, options?: { autoPlayOfficialFollowUp?: boolean }) {
  await resolveTimedOutMatch(args.matchId);

  const result = await db.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: args.matchId },
      include: matchInclude,
    });

    if (!match || match.gameKey !== "chess") {
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

    const state = parseChessState(match.stateJson);
    const move = parseChessMoveNotation(
      args.notation,
      getLegalChessMoves(state),
      state,
    );
    const nextState = applyChessMove(state, move);
    const isFinished = nextState.winner !== null;
    const nextTurnAgentId = isFinished
      ? null
      : args.agentId === match.playerOneId
        ? match.playerTwoId
        : match.playerOneId;
    const matchResult = nextState.winner
      ? fromChessWinner(nextState.winner)
      : null;
    const winnerAgentId =
      nextState.winner === "WHITE"
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
        stateJson: serializeChessState(nextState),
        status: isFinished ? MatchStatus.FINISHED : MatchStatus.ACTIVE,
        winnerAgentId,
        moves: {
          create: {
            agentId: args.agentId,
            moveIndex: match.moves.length,
            payloadJson: JSON.stringify({
              notation: move.notation,
              san: move.san,
              lan: move.lan,
              from: move.from,
              to: move.to,
              piece: move.piece,
              captured: move.captured,
              promotion: move.promotion,
            }),
          },
        },
      },
      include: matchInclude,
    });

    if (isFinished && matchResult) {
      await applyRatingsForCompletedMatch(tx, {
        gameKey: "chess",
        playerOneId: match.playerOneId,
        playerTwoId: match.playerTwoId,
        outcome: toOutcome(matchResult),
      });
    }

    return {
      match: updatedMatch,
      board: renderChessBoard(nextState),
      winner: nextState.winner,
      winnerReason: nextState.winnerReason,
      lastMove: moveRecord,
    };
  });

  if (options?.autoPlayOfficialFollowUp === false) {
    return result;
  }

  const hydratedMatch = await playOfficialTurnsUntilHumanOrFinished(result.match.id);
  const state = parseChessState(hydratedMatch.stateJson);

  return {
    match: hydratedMatch,
    board: renderChessBoard(state),
    winner: state.winner,
    winnerReason: state.winnerReason,
    lastMove: state.lastMove,
  };
}

async function advanceFrontierMatchToNow(matchId: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const match = await getMatchWithDetails(matchId);

    if (match.gameKey !== "frontier" || match.status !== MatchStatus.ACTIVE || !match.startedAt) {
      return match;
    }

    const targetElapsedMs = Math.min(
      FRONTIER_MATCH_DURATION_MS,
      Math.max(0, Date.now() - match.startedAt.getTime()),
    );
    let state = parseFrontierState(match.stateJson);

    if (targetElapsedMs <= state.elapsedMs) {
      return match;
    }

    const hasOfficialParticipant =
      isRunnableOfficialFrontierParticipant(match.playerOne) ||
      (match.playerTwo ? isRunnableOfficialFrontierParticipant(match.playerTwo) : false);
    const nextWindowBoundaryMs =
      (getFrontierWindowIndex(state.elapsedMs) + 1) * FRONTIER_COMMAND_WINDOW_MS;
    const processUntilMs = hasOfficialParticipant
      ? Math.min(targetElapsedMs, nextWindowBoundaryMs)
      : targetElapsedMs;
    let closedWindowIndex: number | null = null;
    let nextMoveIndex = match.moves.length;
    const moveRows: Prisma.MatchMoveCreateManyInput[] = [];

    while (state.elapsedMs < processUntilMs && !state.winner) {
      const currentWindowIndex = getFrontierWindowIndex(state.elapsedMs);
      const currentBoundaryMs = (currentWindowIndex + 1) * FRONTIER_COMMAND_WINDOW_MS;
      const nextElapsedMs = Math.min(
        processUntilMs,
        state.elapsedMs + FRONTIER_TICK_MS,
        currentBoundaryMs,
      );
      const tickResult = tickFrontierState(state, nextElapsedMs - state.elapsedMs);
      state = tickResult.state;
      nextMoveIndex = appendFrontierEventRows({
        match,
        state,
        events: tickResult.events,
        moveRows,
        nextMoveIndex,
      });

      if (state.winner) {
        break;
      }

      if (state.elapsedMs === currentBoundaryMs) {
        closedWindowIndex = currentWindowIndex;
      }
    }

    if (closedWindowIndex !== null && !state.winner) {
      const officialActionsByOwner = await chooseOfficialFrontierWindowActions(
        match,
        state,
        closedWindowIndex,
      );
      const orderResult = applyFrontierWindowOrders(
        match,
        state,
        closedWindowIndex,
        officialActionsByOwner,
      );
      state = orderResult.state;
      nextMoveIndex = appendFrontierFrameRow({
        match,
        moveRows,
        nextMoveIndex,
        agentId: match.playerOneId,
        actorName: null,
        state,
        board: renderFrontierBoard(state),
        headline: `Window ${closedWindowIndex + 1} orders applied`,
        notation: orderResult.summary,
        createdAt: frontierReplayTimestamp(match, state),
      });
    }

    const persisted = await persistAdvancedFrontierMatch({
      match,
      state,
      moveRows,
    });

    if (persisted) {
      return persisted;
    }
  }

  throw new Error(`Failed to advance Frontier match ${matchId}.`);
}

function applyFrontierWindowOrders(
  match: MatchWithDetails,
  state: FrontierState,
  closedWindowIndex: number,
  officialActionsByOwner: Partial<Record<FrontierOwner, FrontierAction[]>> = {},
) {
  let nextState = state;
  const summaries: string[] = [];

  for (const owner of ["ONE", "TWO"] as const) {
    const participant = getFrontierParticipantForOwner(match, owner);
    const pendingCommands = nextState.pendingCommands[owner];
    const actions =
      participant.kind === AgentKind.OFFICIAL
        ? officialActionsByOwner[owner] ?? []
        : pendingCommands?.windowIndex === closedWindowIndex
          ? pendingCommands.actions
          : [];

    if (pendingCommands && pendingCommands.windowIndex <= closedWindowIndex) {
      nextState.pendingCommands[owner] = null;
    }

    if (actions.length === 0) {
      continue;
    }

    const applied = applyFrontierCommandActions(nextState, owner, actions);
    nextState = applied.state;
    summaries.push(`${participant.name}: ${formatFrontierActionSummary(applied.appliedActions)}`);
  }

  return {
    state: nextState,
    summary: summaries.join(" | ") || "No new orders",
  };
}

async function chooseOfficialFrontierWindowActions(
  match: MatchWithDetails,
  state: FrontierState,
  closedWindowIndex: number,
) {
  const tasks = (["ONE", "TWO"] as const).map(async (owner) => {
    const participant = getFrontierParticipantForOwner(match, owner);

    if (!isRunnableOfficialFrontierParticipant(participant)) {
      return [owner, []] as const;
    }

    try {
      const actions = await chooseOfficialFrontierActions({
        provider: participant.provider!,
        modelId: participant.modelId ?? participant.name,
        state,
        owner,
        board: renderFrontierBoard(state),
        currentWindowIndex: closedWindowIndex,
        secondsUntilNextWindow: getFrontierSecondsUntilNextWindow(state),
        matchSecondsRemaining: getFrontierSecondsRemaining(state),
      });

      return [owner, actions] as const;
    } catch (error) {
      console.warn(
        `Official Frontier orders failed for ${participant.name} in match ${match.id}; keeping prior orders.`,
        error,
      );
      return [owner, []] as const;
    }
  });

  return Object.fromEntries(await Promise.all(tasks)) as Partial<Record<FrontierOwner, FrontierAction[]>>;
}

async function persistAdvancedFrontierMatch(args: {
  match: MatchWithDetails;
  state: FrontierState;
  moveRows: Prisma.MatchMoveCreateManyInput[];
}) {
  return db.$transaction(async (tx) => {
    const nextResult = frontierWinnerToMatchResult(args.state.winner);
    const winnerAgentId = frontierWinnerToAgentId(args.match, args.state.winner);
    const finishedAt =
      args.state.winner && args.match.startedAt
        ? new Date(args.match.startedAt.getTime() + args.state.elapsedMs)
        : null;

    const update = await tx.match.updateMany({
      where: {
        id: args.match.id,
        status: MatchStatus.ACTIVE,
        updatedAt: args.match.updatedAt,
      },
      data: {
        currentTurnAgentId: null,
        finishedAt,
        result: nextResult,
        stateJson: serializeFrontierState(args.state),
        status: args.state.winner ? MatchStatus.FINISHED : MatchStatus.ACTIVE,
        winnerAgentId,
      },
    });

    if (update.count !== 1) {
      return null;
    }

    if (args.moveRows.length > 0) {
      await tx.matchMove.createMany({
        data: args.moveRows,
      });
    }

    if (args.state.winner && nextResult && args.match.playerTwoId) {
      await applyRatingsForCompletedMatch(tx, {
        gameKey: "frontier",
        playerOneId: args.match.playerOneId,
        playerTwoId: args.match.playerTwoId,
        outcome: toOutcome(nextResult),
      });
    }

    return tx.match.findUniqueOrThrow({
      where: { id: args.match.id },
      include: matchInclude,
    });
  });
}

function appendFrontierEventRows(args: {
  match: MatchWithDetails;
  state: FrontierState;
  events: FrontierSimulationEvent[];
  moveRows: Prisma.MatchMoveCreateManyInput[];
  nextMoveIndex: number;
}) {
  let nextMoveIndex = args.nextMoveIndex;

  for (const event of args.events) {
    const frontierFrame = describeFrontierEvent(args.match, event);

    nextMoveIndex = appendFrontierFrameRow({
      match: args.match,
      moveRows: args.moveRows,
      nextMoveIndex,
      agentId: frontierFrame.agentId,
      actorName: frontierFrame.actorName,
      state: args.state,
      board: renderFrontierBoard(args.state),
      headline: frontierFrame.headline,
      notation: frontierFrame.notation,
      createdAt: frontierReplayTimestamp(args.match, args.state),
      isTerminal: event.type === "match-ended",
    });
  }

  return nextMoveIndex;
}

function appendFrontierFrameRow(args: {
  match: MatchWithDetails;
  moveRows: Prisma.MatchMoveCreateManyInput[];
  nextMoveIndex: number;
  agentId: string;
  actorName: string | null;
  state: FrontierState;
  board: string;
  headline: string;
  notation: string | null;
  createdAt: string;
  isTerminal?: boolean;
}) {
  args.moveRows.push({
    matchId: args.match.id,
    agentId: args.agentId,
    moveIndex: args.nextMoveIndex,
    payloadJson: JSON.stringify({
      kind: "frontier-frame",
      actorName: args.actorName,
      board: args.board,
      headline: args.headline,
      notation: args.notation,
      createdAt: args.createdAt,
      isTerminal: args.isTerminal ?? false,
      visual: createFrontierReplayVisual(args.state),
    }),
  });

  return args.nextMoveIndex + 1;
}

async function playOfficialTurnsUntilHumanOrFinished(matchId: string) {
  let match = await getMatchWithDetails(matchId);

  if (match.gameKey === "frontier") {
    return advanceFrontierMatchToNow(matchId);
  }

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
            notation: move.notation,
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
            notation: move.notation,
          },
          {
            autoPlayOfficialFollowUp: false,
          },
        );
      } catch (error) {
        console.warn(`Official move failed for ${officialAgent.name}; forfeiting match ${match.id}.`, error);
        return forfeitMatch(match.id, officialAgent.id);
      }
    } else if (match.gameKey === "chess") {
      const state = parseChessState(match.stateJson);
      const legalMoves = getLegalChessMoves(state);

      if (legalMoves.length === 0) {
        return match;
      }

      try {
        const move = await chooseOfficialChessMove({
          provider: officialAgent.provider,
          modelId: officialAgent.modelId ?? officialAgent.name,
          board: renderChessBoard(state),
          legalMoves,
          color: getChessPlayerColor(match.playerOneId === officialAgent.id),
          state,
        });

        await playChessTurn(
          {
            agentId: officialAgent.id,
            matchId: match.id,
            notation: move.notation,
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

function assertAgentIsMatchParticipant(match: MatchWithDetails, agentId: string) {
  if (match.playerOneId !== agentId && match.playerTwoId !== agentId) {
    throw new Error("You are not a participant in this match.");
  }
}

function serializeFrontierArmyForAgent(
  army: FrontierState["armies"][number],
) {
  return {
    id: army.id,
    soldiers: army.soldiers,
    x: army.x,
    y: army.y,
    order: army.order,
  };
}

function getFrontierIncomePerSecondForMatch(state: FrontierState, owner: FrontierOwner) {
  return 1 + state.sites.filter((site) => site.controller === owner).length;
}

function getFrontierParticipantForOwner(
  match: Pick<MatchWithDetails, "playerOneId" | "playerOne" | "playerTwoId" | "playerTwo">,
  owner: FrontierOwner,
) {
  if (owner === "ONE") {
    return {
      id: match.playerOneId,
      name: match.playerOne.name,
      kind: match.playerOne.kind,
      provider: match.playerOne.provider,
      modelId: match.playerOne.modelId,
    };
  }

  return {
    id: match.playerTwoId ?? match.playerOneId,
    name: match.playerTwo?.name ?? "East",
    kind: match.playerTwo?.kind ?? AgentKind.USER,
    provider: match.playerTwo?.provider ?? null,
    modelId: match.playerTwo?.modelId ?? null,
  };
}

function isRunnableOfficialFrontierParticipant(
  participant: Pick<MatchWithDetails["playerOne"], "kind" | "provider"> | null,
) {
  return Boolean(participant && isOfficialAgentRunnable(participant));
}

function formatFrontierActionSummary(actions: FrontierAction[]) {
  return actions
    .map((action) => {
      if (action.type === "MOVE") {
        return `MOVE ${action.armyId} ${action.x},${action.y}`;
      }

      return `ATTACK ${action.armyId} ${action.targetId}`;
    })
    .join(" ; ");
}

function frontierReplayTimestamp(
  match: Pick<MatchWithDetails, "startedAt">,
  state: FrontierState,
) {
  const baseTime = match.startedAt?.getTime() ?? Date.now();
  return new Date(baseTime + state.elapsedMs).toISOString();
}

function frontierWinnerToMatchResult(winner: FrontierState["winner"]) {
  if (winner === "ONE") {
    return MatchResult.PLAYER_ONE;
  }

  if (winner === "TWO") {
    return MatchResult.PLAYER_TWO;
  }

  if (winner === "DRAW") {
    return MatchResult.DRAW;
  }

  return null;
}

function frontierWinnerToAgentId(match: MatchWithDetails, winner: FrontierState["winner"]) {
  if (winner === "ONE") {
    return match.playerOneId;
  }

  if (winner === "TWO") {
    return match.playerTwoId ?? null;
  }

  return null;
}

function describeFrontierEvent(match: MatchWithDetails, event: FrontierSimulationEvent) {
  switch (event.type) {
    case "spawn": {
      const participant = getFrontierParticipantForOwner(match, event.owner);
      return {
        agentId: participant.id,
        actorName: participant.name,
        headline: `${participant.name} spawned ${event.soldiers} soldiers`,
        notation: `${event.armyId} +${event.soldiers}`,
      };
    }
    case "merge": {
      const participant = getFrontierParticipantForOwner(match, event.owner);
      return {
        agentId: participant.id,
        actorName: participant.name,
        headline: `${participant.name} merged ${event.absorbedArmyId} into ${event.targetArmyId}`,
        notation: `${event.targetArmyId} now has ${event.resultingSoldiers}`,
      };
    }
    case "battle": {
      const winner = getFrontierParticipantForOwner(match, event.winnerOwner);
      return {
        agentId: winner.id,
        actorName: winner.name,
        headline: `${winner.name} won a battle near ${event.location.x},${event.location.y}`,
        notation: `${event.winnerArmyId} survived with ${event.survivors}`,
      };
    }
    case "site-captured": {
      const participant = getFrontierParticipantForOwner(match, event.owner);
      return {
        agentId: participant.id,
        actorName: participant.name,
        headline: `${participant.name} captured ${event.siteId}`,
        notation: event.siteId,
      };
    }
    case "base-destroyed": {
      const attacker = getFrontierParticipantForOwner(match, event.attackerOwner);
      const defender = getFrontierParticipantForOwner(match, event.destroyedOwner);
      return {
        agentId: attacker.id,
        actorName: attacker.name,
        headline: `${attacker.name} destroyed ${defender.name}'s base`,
        notation: `${attacker.name} eliminated ${defender.name}`,
      };
    }
    case "match-ended": {
      if (event.winner === "DRAW") {
        return {
          agentId: match.playerOneId,
          actorName: null,
          headline: `Match drawn by ${event.winnerReason.replaceAll("-", " ")}`,
          notation: "Draw",
        };
      }

      const winner = getFrontierParticipantForOwner(match, event.winner);
      return {
        agentId: winner.id,
        actorName: winner.name,
        headline: `${winner.name} won by ${event.winnerReason.replaceAll("-", " ")}`,
        notation: winner.name,
      };
    }
  }
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
  await ensureAllAgentsHaveCurrentRatings(tx);

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

function fromChessWinner(winner: ChessWinner): MatchResult {
  switch (winner) {
    case "WHITE":
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
}>, agentId?: string) {
  const board = renderSerializedGameBoard(match.gameKey, match.stateJson);
  const timing = getMatchTurnTiming(match);

  return {
    id: match.id,
    gameKey: match.gameKey,
    status: match.status,
    result: match.result,
    currentTurnAgentId: match.currentTurnAgentId,
    currentTurnAgentName: getCurrentTurnAgentName(match),
    isYourTurn:
      agentId && match.status === MatchStatus.ACTIVE
        ? match.currentTurnAgentId === agentId
        : null,
    playerOne: match.playerOne.name,
    playerTwo: match.playerTwo?.name ?? null,
    winner: match.winner?.name ?? null,
    board: board ?? "Board state unavailable",
    moveCount: match.moves.length,
    updatedAt: match.updatedAt.toISOString(),
    turnDeadlineAt: timing.turnDeadlineAt,
    secondsRemaining: timing.secondsRemaining,
    moveTimeoutSeconds: env.MATCH_MOVE_TIMEOUT_SECONDS,
  };
}

function getCurrentTurnAgentName(match: Pick<MatchWithDetails, "currentTurnAgentId" | "playerOneId" | "playerOne" | "playerTwoId" | "playerTwo">) {
  if (!match.currentTurnAgentId) {
    return null;
  }

  if (match.currentTurnAgentId === match.playerOneId) {
    return match.playerOne.name;
  }

  if (match.currentTurnAgentId === match.playerTwoId) {
    return match.playerTwo?.name ?? null;
  }

  return null;
}

function getMatchTurnTiming(
  match: Pick<MatchWithDetails, "status" | "currentTurnAgentId" | "updatedAt">,
  referenceDate = new Date(),
) {
  if (match.status !== MatchStatus.ACTIVE || !match.currentTurnAgentId) {
    return {
      turnDeadlineAt: null,
      secondsRemaining: null,
    };
  }

  const turnDeadline = new Date(
    match.updatedAt.getTime() + env.MATCH_MOVE_TIMEOUT_SECONDS * 1000,
  );

  return {
    turnDeadlineAt: turnDeadline.toISOString(),
    secondsRemaining: Math.max(
      0,
      Math.ceil((turnDeadline.getTime() - referenceDate.getTime()) / 1000),
    ),
  };
}
