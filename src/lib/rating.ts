import { Prisma, type Rating } from "@/generated/prisma/client";

import { db } from "@/lib/db";
import { DEFAULT_ELO, GAMES, K_FACTOR, type GameKey } from "@/lib/games";

export type MatchOutcome = "playerOne" | "playerTwo" | "draw";

type RatingCoverageClient = typeof db | Prisma.TransactionClient;

declare global {
  var ratingCoveragePromise: Promise<void> | undefined;
}

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export function applyEloResult(
  ratingOne: number,
  ratingTwo: number,
  outcome: MatchOutcome,
  kFactor = K_FACTOR,
) {
  const expectedOne = expectedScore(ratingOne, ratingTwo);
  const expectedTwo = expectedScore(ratingTwo, ratingOne);

  const scoreOne =
    outcome === "playerOne" ? 1 : outcome === "draw" ? 0.5 : 0;
  const scoreTwo =
    outcome === "playerTwo" ? 1 : outcome === "draw" ? 0.5 : 0;

  return {
    ratingOne: ratingOne + kFactor * (scoreOne - expectedOne),
    ratingTwo: ratingTwo + kFactor * (scoreTwo - expectedTwo),
  };
}

export function computeAggregateRating(ratings: Pick<Rating, "gameKey" | "rating">[]) {
  const ratingByGame = new Map(ratings.map((rating) => [rating.gameKey, rating.rating]));
  const total = GAMES.reduce((sum, game) => {
    return sum + (ratingByGame.get(game.key) ?? DEFAULT_ELO);
  }, 0);

  return total / GAMES.length;
}

export function getDefaultRatingsForAllGames() {
  return GAMES.map((game) => ({
    gameKey: game.key,
    rating: DEFAULT_ELO,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
  }));
}

export function getDisplayRating(value: number): number {
  return Math.round(value);
}

export async function ensureAllAgentsHaveCurrentRatings(
  client: RatingCoverageClient = db,
) {
  if (client === db) {
    const syncPromise = globalThis.ratingCoveragePromise ??= ensureAllAgentsHaveCurrentRatingsInClient(db);

    try {
      await syncPromise;
    } finally {
      if (globalThis.ratingCoveragePromise === syncPromise) {
        globalThis.ratingCoveragePromise = undefined;
      }
    }

    return;
  }

  await ensureAllAgentsHaveCurrentRatingsInClient(client);
}

export function assertGameKey(gameKey: string): GameKey {
  const game = GAMES.find((candidate) => candidate.key === gameKey);

  if (!game) {
    throw new Error(`Unsupported game key: ${gameKey}`);
  }

  return game.key;
}

async function ensureAllAgentsHaveCurrentRatingsInClient(client: RatingCoverageClient) {
  const currentGameKeys = GAMES.map((game) => game.key);
  const [agentCount, ratingCount] = await Promise.all([
    client.agent.count(),
    client.rating.count({
      where: {
        gameKey: {
          in: currentGameKeys,
        },
      },
    }),
  ]);

  if (agentCount === 0 || ratingCount >= agentCount * GAMES.length) {
    return;
  }

  const [agents, ratings] = await Promise.all([
    client.agent.findMany({
      select: {
        id: true,
      },
    }),
    client.rating.findMany({
      select: {
        agentId: true,
        gameKey: true,
        rating: true,
        gamesPlayed: true,
      },
    }),
  ]);

  const ratingsByAgent = new Map<string, Array<Pick<Rating, "gameKey" | "rating" | "gamesPlayed">>>();
  const existingKeys = new Set<string>();

  for (const rating of ratings) {
    existingKeys.add(`${rating.agentId}:${rating.gameKey}`);

    const bucket = ratingsByAgent.get(rating.agentId) ?? [];
    bucket.push({
      gameKey: rating.gameKey,
      rating: rating.rating,
      gamesPlayed: rating.gamesPlayed,
    });
    ratingsByAgent.set(rating.agentId, bucket);
  }

  const missingRatings: Prisma.RatingCreateManyInput[] = [];

  for (const agent of agents) {
    const bucket = ratingsByAgent.get(agent.id) ?? [];

    for (const game of GAMES) {
      const key = `${agent.id}:${game.key}`;

      if (existingKeys.has(key)) {
        continue;
      }

      missingRatings.push({
        agentId: agent.id,
        gameKey: game.key,
        rating: DEFAULT_ELO,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      });
      bucket.push({
        gameKey: game.key,
        rating: DEFAULT_ELO,
        gamesPlayed: 0,
      });
      existingKeys.add(key);
      ratingsByAgent.set(agent.id, bucket);
    }
  }

  if (missingRatings.length === 0) {
    return;
  }

  await client.rating.createMany({
    data: missingRatings,
    skipDuplicates: true,
  });

  await Promise.all(
    agents.map((agent) => {
      const ratingsForAgent = ratingsByAgent.get(agent.id) ?? [];

      return client.agent.update({
        where: {
          id: agent.id,
        },
        data: {
          aggregateRating: computeAggregateRating(ratingsForAgent),
          aggregateGamesPlayed: ratingsForAgent.reduce(
            (sum, rating) => sum + rating.gamesPlayed,
            0,
          ),
        },
      });
    }),
  );
}
