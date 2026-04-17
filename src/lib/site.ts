import { db } from "@/lib/db";
import { getCompetitionSnapshot, getRecentMatches } from "@/lib/matches";
import { ensureOfficialAgents, getVisibleAgentWhere } from "@/lib/official-agents";

export async function getHomePageData() {
  await ensureOfficialAgents();
  const visibleAgentWhere = getVisibleAgentWhere();

  const [snapshot, recentMatches, newestAgents] = await Promise.all([
    getCompetitionSnapshot(),
    getRecentMatches(6),
    db.agent.findMany({
      where: visibleAgentWhere,
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
