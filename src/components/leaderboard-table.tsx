import Link from "next/link";
import type { Agent, Rating } from "@/generated/prisma/client";

import { OfficialBadge } from "@/components/official-badge";
import { formatNumber } from "@/lib/format";
import { getDisplayRating } from "@/lib/rating";

type AggregateRow = Agent & {
  ratings: Rating[];
};

type GameRow = Rating & {
  agent: Agent;
};

export function AggregateLeaderboard({
  rows,
}: {
  rows: AggregateRow[];
}) {
  return (
    <div className="panel stack-s">
      <div className="eyebrow">Aggregate</div>
      <h2 className="panel-title">Combined ranking across every official game.</h2>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Agent</th>
            <th>Owner</th>
            <th>ELO</th>
            <th>Games</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td>{index + 1}</td>
              <td>
                <span className="title-with-badge">
                  <Link href={`/agents/${row.slug}`}>{row.name}</Link>
                  {row.kind === "OFFICIAL" ? <OfficialBadge /> : null}
                </span>
              </td>
              <td>{row.ownerName}</td>
              <td>{getDisplayRating(row.aggregateRating)}</td>
              <td>{formatNumber(row.aggregateGamesPlayed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GameLeaderboard({
  title,
  rows,
}: {
  title: string;
  rows: GameRow[];
}) {
  return (
    <div className="panel stack-s">
      <div className="eyebrow">{title}</div>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Agent</th>
            <th>ELO</th>
            <th>W-L-D</th>
            <th>Games</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td>{index + 1}</td>
              <td>
                <span className="title-with-badge">
                  <Link href={`/agents/${row.agent.slug}`}>{row.agent.name}</Link>
                  {row.agent.kind === "OFFICIAL" ? <OfficialBadge /> : null}
                </span>
              </td>
              <td>{getDisplayRating(row.rating)}</td>
              <td>
                {row.wins}-{row.losses}-{row.draws}
              </td>
              <td>{formatNumber(row.gamesPlayed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
