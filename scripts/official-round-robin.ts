import { Prisma } from "../src/generated/prisma/client";
import { AgentKind, MatchResult, MatchStatus } from "../src/generated/prisma/enums";
import {
  applyCheckersForfeit,
  getCheckersPlayerColor,
  getLegalCheckersMoves,
  parseCheckersState,
  renderCheckersBoard,
  serializeCheckersState,
} from "../src/lib/checkers";
import {
  applyChessForfeit,
  getChessPlayerColor,
  getLegalChessMoves,
  parseChessState,
  renderChessBoard,
  serializeChessState,
} from "../src/lib/chess";
import { db } from "../src/lib/db";
import { createInitialMatchState } from "../src/lib/game-state";
import {
  chooseOfficialCheckersMove,
  chooseOfficialChessMove,
  chooseOfficialTicTacToeMove,
} from "../src/lib/official-player";
import { ensureOfficialAgents, listRunnableOfficialAgents } from "../src/lib/official-agents";
import { playCheckersTurn, playChessTurn, playTicTacToeTurn } from "../src/lib/matches";
import { applyEloResult, computeAggregateRating } from "../src/lib/rating";
import {
  applyTicTacToeForfeit,
  boardToAscii,
  getLegalTicTacToeMoves,
  getPlayerMark,
  parseTicTacToeState,
  serializeTicTacToeState,
} from "../src/lib/tic-tac-toe";

const GAME_KEYS = ["tic-tac-toe", "checkers", "chess"] as const;
const concurrency = Number.parseInt(process.env.TOURNAMENT_CONCURRENCY ?? "8", 10);
const startedAt = Date.now();

type GameKey = (typeof GAME_KEYS)[number];
type MatchOutcome = "playerOne" | "playerTwo" | "draw";

type OfficialAgent = Awaited<ReturnType<typeof listRunnableOfficialAgents>>[number];

type Job = {
  gameKey: GameKey;
  left: OfficialAgent;
  right: OfficialAgent;
};

function log(message: string, details: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      message,
      ...details,
    }),
  );
}

async function wipeLeaderboard() {
  await db.$transaction([
    db.queueEntry.deleteMany(),
    db.matchMove.deleteMany(),
    db.match.deleteMany(),
    db.agent.deleteMany(),
  ]);
}

async function getMatch(matchId: string) {
  return db.match.findUniqueOrThrow({
    where: {
      id: matchId,
    },
    include: {
      playerOne: true,
      playerTwo: true,
      winner: true,
    },
  });
}

async function applyRatingsForCompletedMatch(
  tx: Prisma.TransactionClient,
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

  const next = applyEloResult(
    playerOneRating.rating,
    playerTwoRating.rating,
    args.outcome,
  );

  await Promise.all([
    tx.rating.update({
      where: {
        id: playerOneRating.id,
      },
      data: {
        rating: next.ratingOne,
        gamesPlayed: {
          increment: 1,
        },
        wins: {
          increment: args.outcome === "playerOne" ? 1 : 0,
        },
        losses: {
          increment: args.outcome === "playerTwo" ? 1 : 0,
        },
        draws: {
          increment: args.outcome === "draw" ? 1 : 0,
        },
      },
    }),
    tx.rating.update({
      where: {
        id: playerTwoRating.id,
      },
      data: {
        rating: next.ratingTwo,
        gamesPlayed: {
          increment: 1,
        },
        wins: {
          increment: args.outcome === "playerTwo" ? 1 : 0,
        },
        losses: {
          increment: args.outcome === "playerOne" ? 1 : 0,
        },
        draws: {
          increment: args.outcome === "draw" ? 1 : 0,
        },
      },
    }),
  ]);

  const [playerOneRatings, playerTwoRatings] = await Promise.all([
    tx.rating.findMany({
      where: {
        agentId: args.playerOneId,
      },
      select: {
        gameKey: true,
        rating: true,
      },
    }),
    tx.rating.findMany({
      where: {
        agentId: args.playerTwoId,
      },
      select: {
        gameKey: true,
        rating: true,
      },
    }),
  ]);

  await Promise.all([
    tx.agent.update({
      where: {
        id: args.playerOneId,
      },
      data: {
        aggregateGamesPlayed: {
          increment: 1,
        },
        aggregateRating: computeAggregateRating(playerOneRatings),
      },
    }),
    tx.agent.update({
      where: {
        id: args.playerTwoId,
      },
      data: {
        aggregateGamesPlayed: {
          increment: 1,
        },
        aggregateRating: computeAggregateRating(playerTwoRatings),
      },
    }),
  ]);
}

function toMatchResult(outcome: MatchOutcome) {
  switch (outcome) {
    case "playerOne":
      return MatchResult.PLAYER_ONE;
    case "playerTwo":
      return MatchResult.PLAYER_TWO;
    case "draw":
      return MatchResult.DRAW;
  }
}

function createForfeitStateJson(
  match: Awaited<ReturnType<typeof getMatch>>,
  outcome: Exclude<MatchOutcome, "draw">,
) {
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

async function forfeitCurrentTurnMatch(matchId: string, forfeitingAgentId: string) {
  return db.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: {
        id: matchId,
      },
      include: {
        playerOne: true,
        playerTwo: true,
        winner: true,
      },
    });

    if (!match) {
      throw new Error("Match not found.");
    }

    if (
      match.status !== MatchStatus.ACTIVE ||
      !match.currentTurnAgentId ||
      match.currentTurnAgentId !== forfeitingAgentId ||
      !match.playerTwoId
    ) {
      return tx.match.findUniqueOrThrow({
        where: {
          id: matchId,
        },
        include: {
          playerOne: true,
          playerTwo: true,
          winner: true,
        },
      });
    }

    const outcome: Exclude<MatchOutcome, "draw"> =
      forfeitingAgentId === match.playerOneId ? "playerTwo" : "playerOne";
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
        result: toMatchResult(outcome),
        stateJson: nextStateJson,
        status: MatchStatus.FINISHED,
        winnerAgentId,
      },
    });

    if (update.count === 1) {
      await applyRatingsForCompletedMatch(tx, {
        gameKey: match.gameKey as GameKey,
        playerOneId: match.playerOneId,
        playerTwoId: match.playerTwoId,
        outcome,
      });
    }

    return tx.match.findUniqueOrThrow({
      where: {
        id: match.id,
      },
      include: {
        playerOne: true,
        playerTwo: true,
        winner: true,
      },
    });
  });
}

async function createOfficialMatch(job: Job) {
  const [playerOneId, playerTwoId] =
    Math.random() < 0.5
      ? [job.left.id, job.right.id]
      : [job.right.id, job.left.id];
  const initialState = createInitialMatchState(job.gameKey);

  return db.match.create({
    data: {
      gameKey: job.gameKey,
      status: MatchStatus.ACTIVE,
      playerOneId,
      playerTwoId,
      currentTurnAgentId: playerOneId,
      startedAt: new Date(),
      stateJson: initialState.stateJson,
    },
  });
}

async function runOfficialMatch(job: Job) {
  const created = await createOfficialMatch(job);

  while (true) {
    const match = await getMatch(created.id);

    if (
      match.status !== MatchStatus.ACTIVE ||
      !match.currentTurnAgentId ||
      !match.playerTwoId ||
      !match.playerTwo
    ) {
      return match;
    }

    const currentAgent =
      match.currentTurnAgentId === match.playerOneId
        ? match.playerOne
        : match.playerTwo;

    if (currentAgent.kind !== AgentKind.OFFICIAL || !currentAgent.provider) {
      throw new Error(
        `Current turn agent is not a runnable official agent for match ${match.id}.`,
      );
    }

    try {
      if (match.gameKey === "tic-tac-toe") {
        const state = parseTicTacToeState(match.stateJson);
        const legalMoves = getLegalTicTacToeMoves(state);

        if (legalMoves.length === 0) {
          return match;
        }

        const move = await chooseOfficialTicTacToeMove({
          provider: currentAgent.provider,
          modelId: currentAgent.modelId ?? currentAgent.name,
          board: boardToAscii(state.board),
          legalMoves,
          mark: getPlayerMark(currentAgent.id === match.playerOneId),
        });

        await playTicTacToeTurn(
          {
            agentId: currentAgent.id,
            matchId: match.id,
            notation: move.notation,
          },
          {
            autoPlayOfficialFollowUp: false,
          },
        );
      } else if (match.gameKey === "checkers") {
        const state = parseCheckersState(match.stateJson);
        const legalMoves = getLegalCheckersMoves(state);

        if (legalMoves.length === 0) {
          return match;
        }

        const move = await chooseOfficialCheckersMove({
          provider: currentAgent.provider,
          modelId: currentAgent.modelId ?? currentAgent.name,
          board: renderCheckersBoard(state.board),
          legalMoves,
          color: getCheckersPlayerColor(currentAgent.id === match.playerOneId),
        });

        await playCheckersTurn(
          {
            agentId: currentAgent.id,
            matchId: match.id,
            notation: move.notation,
          },
          {
            autoPlayOfficialFollowUp: false,
          },
        );
      } else {
        const state = parseChessState(match.stateJson);
        const legalMoves = getLegalChessMoves(state);

        if (legalMoves.length === 0) {
          return match;
        }

        const move = await chooseOfficialChessMove({
          provider: currentAgent.provider,
          modelId: currentAgent.modelId ?? currentAgent.name,
          board: renderChessBoard(state),
          legalMoves,
          color: getChessPlayerColor(currentAgent.id === match.playerOneId),
          state,
        });

        await playChessTurn(
          {
            agentId: currentAgent.id,
            matchId: match.id,
            notation: move.notation,
          },
          {
            autoPlayOfficialFollowUp: false,
          },
        );
      }
    } catch (error) {
      log("official-forfeit", {
        matchId: match.id,
        gameKey: match.gameKey,
        forfeitingAgent: currentAgent.name,
        reason: error instanceof Error ? error.message : String(error),
      });

      return forfeitCurrentTurnMatch(match.id, currentAgent.id);
    }
  }
}

function shuffle<T>(items: T[]) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}

function buildJobs(agents: OfficialAgent[]) {
  const jobs: Job[] = [];

  for (let leftIndex = 0; leftIndex < agents.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < agents.length; rightIndex += 1) {
      for (const gameKey of GAME_KEYS) {
        jobs.push({
          gameKey,
          left: agents[leftIndex],
          right: agents[rightIndex],
        });
      }
    }
  }

  return shuffle(jobs);
}

async function main() {
  await ensureOfficialAgents();
  await wipeLeaderboard();
  await ensureOfficialAgents();

  const agents = await listRunnableOfficialAgents();
  const jobs = buildJobs(agents);
  const totalsByGame = Object.fromEntries(
    GAME_KEYS.map((gameKey) => [gameKey, 0]),
  ) as Record<GameKey, number>;
  const doneByGame = Object.fromEntries(
    GAME_KEYS.map((gameKey) => [gameKey, 0]),
  ) as Record<GameKey, number>;
  const failures: {
    gameKey: GameKey;
    left: string;
    right: string;
    error: string;
  }[] = [];
  let cursor = 0;
  let completed = 0;

  for (const job of jobs) {
    totalsByGame[job.gameKey] += 1;
  }

  log("tournament-start", {
    officialAgents: agents.length,
    totalMatches: jobs.length,
    totalsByGame,
    concurrency,
  });

  async function worker(workerId: number) {
    while (true) {
      const job = jobs[cursor];
      cursor += 1;

      if (!job) {
        return;
      }

      const jobStartedAt = Date.now();

      try {
        const match = await runOfficialMatch(job);
        doneByGame[job.gameKey] += 1;
        completed += 1;

        if (completed === 1 || completed % 10 === 0 || completed === jobs.length) {
          const moveCount = await db.matchMove.count({
            where: {
              matchId: match.id,
            },
          });

          log("match-complete", {
            workerId,
            completed,
            totalMatches: jobs.length,
            gameKey: job.gameKey,
            matchId: match.id,
            playerOne: match.playerOne.name,
            playerTwo: match.playerTwo?.name ?? null,
            winner: match.winner?.name ?? null,
            result: match.result,
            moveCount,
            durationSeconds: Number(
              ((Date.now() - jobStartedAt) / 1000).toFixed(1),
            ),
            doneByGame,
          });
        }
      } catch (error) {
        completed += 1;
        failures.push({
          gameKey: job.gameKey,
          left: job.left.name,
          right: job.right.name,
          error: error instanceof Error ? error.message : String(error),
        });

        log("match-failed", {
          workerId,
          completed,
          totalMatches: jobs.length,
          gameKey: job.gameKey,
          left: job.left.name,
          right: job.right.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, (_, index) => worker(index + 1)),
  );

  const [matchCount, moveCount] = await Promise.all([
    db.match.count(),
    db.matchMove.count(),
  ]);

  log("tournament-finished", {
    totalSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    matchCount,
    moveCount,
    failures: failures.length,
    sampleFailure: failures[0] ?? null,
  });
}

try {
  await main();
} finally {
  await db.$disconnect();
}
