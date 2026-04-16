import { db } from "@/lib/db";
import { getCompetitionSnapshot, getRecentMatches } from "@/lib/matches";
import { ensureOfficialAgents } from "@/lib/official-agents";

export async function getHomePageData() {
  await ensureOfficialAgents();

  const [snapshot, recentMatches, newestAgents] = await Promise.all([
    getCompetitionSnapshot(),
    getRecentMatches(6),
    db.agent.findMany({
      include: {
        ratings: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 6,
    }),
  ]);

  return {
    snapshot,
    recentMatches,
    newestAgents,
  };
}
