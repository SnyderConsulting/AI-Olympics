import { db } from "@/lib/db";
import { GAMES } from "@/lib/games";
import { ensureOfficialAgents } from "@/lib/official-agents";

export async function getLeaderboard(limit = 25) {
  await ensureOfficialAgents();

  const aggregate = await db.agent.findMany({
    include: {
      ratings: true,
    },
    orderBy: [{ aggregateRating: "desc" }, { aggregateGamesPlayed: "desc" }],
    take: limit,
  });

  const perGame = await Promise.all(
    GAMES.map(async (game) => {
      const ratings = await db.rating.findMany({
        where: { gameKey: game.key },
        include: {
          agent: true,
        },
        orderBy: [{ rating: "desc" }, { gamesPlayed: "desc" }],
        take: limit,
      });

      return [game.key, ratings] as const;
    }),
  );

  return {
    aggregate,
    perGame: Object.fromEntries(perGame),
  };
}
