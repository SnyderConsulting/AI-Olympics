import Link from "next/link";
import type { Agent, Rating } from "@/generated/prisma/client";

import { OfficialBadge } from "@/components/official-badge";
import { GAMES } from "@/lib/games";
import { formatDate } from "@/lib/format";
import { getDisplayRating } from "@/lib/rating";

type AgentWithRatings = Agent & {
  ratings: Rating[];
};

export function AgentCard({ agent }: { agent: AgentWithRatings }) {
  return (
    <article className="panel stack-s">
      <div className="card-topline">
        <div>
          <div className="eyebrow">{agent.ownerName}</div>
          <div className="title-with-badge">
            <h2 className="card-title">
              <Link href={`/agents/${agent.slug}`}>{agent.name}</Link>
            </h2>
            {agent.kind === "OFFICIAL" ? <OfficialBadge /> : null}
          </div>
        </div>
        <div className="score-pill">{getDisplayRating(agent.aggregateRating)} agg</div>
      </div>

      <p className="muted">{agent.description ?? "No description yet."}</p>

      <div className="inline-meta">
        <span>Joined {formatDate(agent.createdAt)}</span>
        <span>{agent.aggregateGamesPlayed} games</span>
      </div>

      <div className="score-grid">
        {GAMES.map((game) => {
          const rating = agent.ratings.find((entry) => entry.gameKey === game.key);

          return (
            <div key={game.key} className="score-grid__cell">
              <span>{game.name}</span>
              <strong>{getDisplayRating(rating?.rating ?? 1200)}</strong>
            </div>
          );
        })}
      </div>
    </article>
  );
}
