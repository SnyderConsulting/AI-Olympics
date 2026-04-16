import { notFound } from "next/navigation";

import { MatchList } from "@/components/match-list";
import { OfficialBadge } from "@/components/official-badge";
import { formatDateTime } from "@/lib/format";
import { GAMES } from "@/lib/games";
import { getAgentBySlug } from "@/lib/agents";
import { getAgentRecentMatches } from "@/lib/matches";
import { getDisplayRating } from "@/lib/rating";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);

  if (!agent) {
    notFound();
  }

  const matches = await getAgentRecentMatches(agent.id);

  return (
    <div className="stack-xl">
      <section className="hero hero--compact">
        <div className="hero__content stack-m">
          <div className="eyebrow">{agent.ownerName}</div>
          <div className="title-with-badge">
            <h1>{agent.name}</h1>
            {agent.kind === "OFFICIAL" ? <OfficialBadge /> : null}
          </div>
          <p className="hero__lede">{agent.description ?? "No description provided."}</p>

          <div className="inline-meta">
            <span>{getDisplayRating(agent.aggregateRating)} aggregate ELO</span>
            <span>{agent.aggregateGamesPlayed} total games</span>
            <span>
              {agent.kind === "OFFICIAL"
                ? "Platform-managed official agent"
                : agent.ownerEmail ?? "No owner email listed"}
            </span>
          </div>
        </div>

        <div className="hero__panel panel stack-s">
          <div className="eyebrow">{agent.kind === "OFFICIAL" ? "Platform" : "Credentials"}</div>
          {agent.kind === "OFFICIAL" ? (
            <>
              <p>Provider: <code>{agent.provider ?? "unknown"}</code></p>
              <p className="muted">
                Model identifier <code>{agent.modelId ?? agent.name}</code>
              </p>
            </>
          ) : agent.credentials.length === 0 ? (
            <p className="muted">No active credential metadata.</p>
          ) : (
            <>
              <p>
                Latest token prefix:
                {" "}
                <code>{agent.credentials[0].tokenPrefix}</code>
              </p>
              <p className="muted">
                Last used {formatDateTime(agent.credentials[0].lastUsedAt)}
              </p>
            </>
          )}
        </div>
      </section>

      <section className="grid-two">
        <div className="panel stack-s">
          <div className="eyebrow">Ratings</div>
          <h2 className="panel-title">Per-game performance</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Game</th>
                <th>ELO</th>
                <th>W-L-D</th>
                <th>Games</th>
              </tr>
            </thead>
            <tbody>
              {GAMES.map((game) => {
                const rating = agent.ratings.find((entry) => entry.gameKey === game.key);
                return (
                  <tr key={game.key}>
                    <td>{game.name}</td>
                    <td>{getDisplayRating(rating?.rating ?? 1200)}</td>
                    <td>
                      {rating?.wins ?? 0}-{rating?.losses ?? 0}-{rating?.draws ?? 0}
                    </td>
                    <td>{rating?.gamesPlayed ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="stack-m">
          <div className="section-heading">
            <div className="eyebrow">Recent Matches</div>
            <h2>Most recent competition history.</h2>
          </div>
          <MatchList emptyLabel="This agent has not played any matches yet." matches={matches} />
        </div>
      </section>
    </div>
  );
}
