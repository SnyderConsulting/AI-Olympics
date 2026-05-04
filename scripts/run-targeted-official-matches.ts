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
import { type GameKey } from "../src/lib/games";
import {
  ensureOfficialAgents,
  isOfficialAgentRunnable,
} from "../src/lib/official-agents";
import {
  chooseOfficialCheckersMove,
  chooseOfficialChessMove,
  chooseOfficialTicTacToeMove,
} from "../src/lib/official-player";
import {
  playCheckersTurn,
  playChessTurn,
  playTicTacToeTurn,
} from "../src/lib/matches";
import {
  applyEloResult,
  computeAggregateRating,
  ensureAllAgentsHaveCurrentRatings,
  type MatchOutcome,
} from "../src/lib/rating";
import {
  applyTicTacToeForfeit,
  boardToAscii,
  getLegalTicTacToeMoves,
  getPlayerMark,
  parseTicTacToeState,
  serializeTicTacToeState,
} from "../src/lib/tic-tac-toe";

type SupportedGameKey = Extract<GameKey, "tic-tac-toe" | "checkers" | "chess">;
type Seat = "one" | "two";

type Job = {
  gameKey: SupportedGameKey;
  opponentName: string;
  targetSeat: Seat;
};

const targetOfficialKey =
  process.env.TARGET_OFFICIAL_AGENT_KEY?.trim() || "OPENAI:gpt-5.5";
const jobs = readJobs();
const matchInclude = {
  playerOne: true,
  playerTwo: true,
  winner: true,
  moves: {
    orderBy: {
      moveIndex: "asc",
    },
  },
} as const;

type MatchWithDetails = Awaited<ReturnType<typeof getMatch>>;

function readJobs(): Job[] {
  if (process.env.TARGET_OFFICIAL_MATCH_JOBS) {
    const parsed = JSON.parse(process.env.TARGET_OFFICIAL_MATCH_JOBS) as Job[];

    return parsed.map((job) => ({
      gameKey: assertSupportedGameKey(job.gameKey),
      opponentName: String(job.opponentName),
      targetSeat: job.targetSeat === "two" ? "two" : "one",
    }));
  }

  return [
    { gameKey: "tic-tac-toe", opponentName: "gpt-5", targetSeat: "one" },
    { gameKey: "tic-tac-toe", opponentName: "gpt-4o", targetSeat: "two" },
    { gameKey: "checkers", opponentName: "gpt-5.4-mini", targetSeat: "one" },
    { gameKey: "chess", opponentName: "gpt-5-mini", targetSeat: "one" },
  ];
}

function assertSupportedGameKey(gameKey: string): SupportedGameKey {
  if (gameKey === "tic-tac-toe" || gameKey === "checkers" || gameKey === "chess") {
    return gameKey;
  }

  throw new Error(`Unsupported targeted official match game: ${gameKey}`);
}

function log(message: string, details: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      message,
      ...details,
    }),
  );
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

async function applyRatingsForCompletedMatch(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  args: {
    gameKey: SupportedGameKey;
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

async function refreshAgentAggregate(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  agentId: string,
) {
  const ratings = await tx.rating.findMany({
    where: { agentId },
  });

  await tx.agent.update({
    where: { id: agentId },
    data: {
      aggregateRating: computeAggregateRating(ratings),
      aggregateGamesPlayed: ratings.reduce(
        (sum, rating) => sum + rating.gamesPlayed,
        0,
      ),
    },
  });
}

async function forfeitCurrentTurnMatch(
  matchId: string,
  forfeitingAgentId: string,
  reason: string,
) {
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
      match.currentTurnAgentId !== forfeitingAgentId ||
      !match.playerTwoId
    ) {
      return tx.match.findUniqueOrThrow({
        where: { id: matchId },
        include: matchInclude,
      });
    }

    const outcome =
      forfeitingAgentId === match.playerOneId ? "playerTwo" : "playerOne";
    const result = toMatchResult(outcome);
    const winnerAgentId =
      outcome === "playerOne" ? match.playerOneId : match.playerTwoId;

    await tx.match.update({
      where: { id: match.id },
      data: {
        currentTurnAgentId: null,
        finishedAt: new Date(),
        result,
        stateJson: createForfeitStateJson(match, outcome),
        status: MatchStatus.FINISHED,
        winnerAgentId,
        moves: {
          create: {
            agentId: forfeitingAgentId,
            moveIndex: match.moves.length,
            payloadJson: JSON.stringify({ notation: "forfeit", reason }),
          },
        },
      },
    });

    await applyRatingsForCompletedMatch(tx, {
      gameKey: assertSupportedGameKey(match.gameKey),
      playerOneId: match.playerOneId,
      playerTwoId: match.playerTwoId,
      outcome,
    });

    return tx.match.findUniqueOrThrow({
      where: { id: match.id },
      include: matchInclude,
    });
  });
}

async function createMatch(
  gameKey: SupportedGameKey,
  playerOneId: string,
  playerTwoId: string,
) {
  const initialState = createInitialMatchState(gameKey);

  return db.match.create({
    data: {
      gameKey,
      status: MatchStatus.ACTIVE,
      playerOneId,
      playerTwoId,
      currentTurnAgentId: playerOneId,
      startedAt: new Date(),
      stateJson: initialState.stateJson,
    },
    include: matchInclude,
  });
}

async function getMatch(matchId: string) {
  return db.match.findUniqueOrThrow({
    where: { id: matchId },
    include: matchInclude,
  });
}

async function runMatch(job: Job, target: Agent, opponent: Agent) {
  const playerOneId = job.targetSeat === "one" ? target.id : opponent.id;
  const playerTwoId = job.targetSeat === "two" ? target.id : opponent.id;
  const created = await createMatch(job.gameKey, playerOneId, playerTwoId);
  const maxMoves =
    job.gameKey === "tic-tac-toe" ? 9 : job.gameKey === "checkers" ? 140 : 160;

  log("match-start", {
    gameKey: job.gameKey,
    matchId: created.id,
    playerOne: created.playerOne.name,
    playerTwo: created.playerTwo?.name ?? null,
  });

  while (true) {
    const match = await getMatch(created.id);

    if (
      match.status !== MatchStatus.ACTIVE ||
      !match.currentTurnAgentId ||
      !match.playerTwo
    ) {
      return match;
    }

    if (match.moves.length >= maxMoves) {
      log("match-max-moves-forfeit", {
        gameKey: match.gameKey,
        matchId: match.id,
        moves: match.moves.length,
        currentTurnAgentId: match.currentTurnAgentId,
      });

      return forfeitCurrentTurnMatch(
        match.id,
        match.currentTurnAgentId,
        `Exceeded targeted official runner maxMoves=${maxMoves}`,
      );
    }

    const currentAgent =
      match.currentTurnAgentId === match.playerOneId
        ? match.playerOne
        : match.playerTwo;

    if (
      currentAgent.kind !== AgentKind.OFFICIAL ||
      !currentAgent.provider ||
      !isOfficialAgentRunnable(currentAgent)
    ) {
      throw new Error(`Current turn is not a runnable official agent: ${currentAgent.name}`);
    }

    try {
      if (match.gameKey === "tic-tac-toe") {
        const state = parseTicTacToeState(match.stateJson);
        const legalMoves = getLegalTicTacToeMoves(state);
        const move = await chooseOfficialTicTacToeMove({
          provider: currentAgent.provider,
          modelId: currentAgent.modelId ?? currentAgent.name,
          board: boardToAscii(state.board),
          legalMoves,
          mark: getPlayerMark(currentAgent.id === match.playerOneId),
        });

        await playTicTacToeTurn(
          { agentId: currentAgent.id, matchId: match.id, notation: move.notation },
          { autoPlayOfficialFollowUp: false },
        );
      } else if (match.gameKey === "checkers") {
        const state = parseCheckersState(match.stateJson);
        const legalMoves = getLegalCheckersMoves(state);
        const move = await chooseOfficialCheckersMove({
          provider: currentAgent.provider,
          modelId: currentAgent.modelId ?? currentAgent.name,
          board: renderCheckersBoard(state.board),
          legalMoves,
          color: getCheckersPlayerColor(currentAgent.id === match.playerOneId),
        });

        await playCheckersTurn(
          { agentId: currentAgent.id, matchId: match.id, notation: move.notation },
          { autoPlayOfficialFollowUp: false },
        );
      } else {
        const state = parseChessState(match.stateJson);
        const legalMoves = getLegalChessMoves(state);
        const move = await chooseOfficialChessMove({
          provider: currentAgent.provider,
          modelId: currentAgent.modelId ?? currentAgent.name,
          board: renderChessBoard(state),
          legalMoves,
          color: getChessPlayerColor(currentAgent.id === match.playerOneId),
          state,
        });

        await playChessTurn(
          { agentId: currentAgent.id, matchId: match.id, notation: move.notation },
          { autoPlayOfficialFollowUp: false },
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log("official-forfeit", {
        gameKey: match.gameKey,
        matchId: match.id,
        forfeitingAgent: currentAgent.name,
        reason,
      });

      return forfeitCurrentTurnMatch(match.id, currentAgent.id, reason);
    }
  }
}

type Agent = Awaited<ReturnType<typeof getTargetAgent>>;

async function getTargetAgent() {
  return db.agent.findUniqueOrThrow({
    where: { officialKey: targetOfficialKey },
  });
}

async function main() {
  await ensureOfficialAgents();

  const target = await getTargetAgent();
  const summaries = [];

  for (const job of jobs) {
    const opponent = await db.agent.findFirstOrThrow({
      where: {
        kind: AgentKind.OFFICIAL,
        name: job.opponentName,
      },
    });
    const match = await runMatch(job, target, opponent);
    const moveCount = await db.matchMove.count({ where: { matchId: match.id } });
    const summary = {
      matchId: match.id,
      gameKey: match.gameKey,
      playerOne: match.playerOne.name,
      playerTwo: match.playerTwo?.name ?? null,
      result: match.result,
      winner: match.winner?.name ?? null,
      moveCount,
      status: match.status,
    };

    summaries.push(summary);
    log("match-complete", summary);
  }

  console.log(
    JSON.stringify(
      {
        message: "targeted-official-matches-complete",
        target: target.name,
        summaries,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
