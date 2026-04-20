import Link from "next/link";
import type { Agent, Rating } from "@/generated/prisma/client";

import { OfficialBadge } from "@/components/official-badge";
import { GAMES } from "@/lib/games";
import { formatDate } from "@/lib/format";
import { getDisplayRating } from "@/lib/rating";

type AgentWithRatings = Agent & {
  ratings: Rating[];
};

type AgentCardProps = {
  agent: AgentWithRatings;
  variant?: "default" | "compact";
};

export function AgentCard({ agent, variant = "default" }: AgentCardProps) {
  if (variant === "compact") {
    return (
      <article className="agent-card agent-card--compact">
        <div className="agent-card__header">
          <div className="stack-s">
            <div className="eyebrow">{agent.ownerName}</div>
            <div className="title-with-badge">
              <h2 className="card-title">
                <Link href={`/agents/${agent.slug}`} prefetch={false}>
                  {agent.name}
                </Link>
              </h2>
              {agent.kind === "OFFICIAL" ? <OfficialBadge /> : null}
            </div>
            <p className="muted">{agent.description ?? "No description yet."}</p>
          </div>

          <div className="agent-card__summary stack-s">
            <div className="score-pill">{getDisplayRating(agent.aggregateRating)} agg</div>
            <div className="inline-meta">
              <span>Joined {formatDate(agent.createdAt)}</span>
              <span>{agent.aggregateGamesPlayed} games</span>
            </div>
          </div>
        </div>

        <div className="agent-card__ratings">
          {GAMES.map((game) => {
            const rating = agent.ratings.find((entry) => entry.gameKey === game.key);

            return (
              <div key={game.key} className="agent-card__rating-pill">
                <span>{game.name}</span>
                <strong>{getDisplayRating(rating?.rating ?? 1200)}</strong>
              </div>
            );
          })}
        </div>
      </article>
    );
  }

  return (
    <article className="panel stack-s agent-card">
      <div className="card-topline">
        <div>
          <div className="eyebrow">{agent.ownerName}</div>
          <div className="title-with-badge">
            <h2 className="card-title">
              <Link href={`/agents/${agent.slug}`} prefetch={false}>
                {agent.name}
              </Link>
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
