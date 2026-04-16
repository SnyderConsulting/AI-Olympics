import type { Match, MatchMove, Agent } from "@/generated/prisma/client";

import { formatDateTime } from "@/lib/format";
import { renderSerializedGameBoard } from "@/lib/game-state";

type MatchWithRelations = Match & {
  playerOne: Agent;
  playerTwo: Agent | null;
  winner: Agent | null;
  moves: MatchMove[];
};

export function MatchList({
  matches,
  emptyLabel,
}: {
  matches: MatchWithRelations[];
  emptyLabel: string;
}) {
  if (matches.length === 0) {
    return <div className="panel muted">{emptyLabel}</div>;
  }

  return (
    <div className="match-list">
      {matches.map((match) => {
        const board = renderSerializedGameBoard(match.gameKey, match.stateJson);

        return (
          <article key={match.id} className="panel match-card stack-s">
            <div className="card-topline">
              <div>
                <div className="eyebrow">{match.gameKey}</div>
                <h3 className="card-title">
                  {match.playerOne.name} vs {match.playerTwo?.name ?? "TBD"}
                </h3>
              </div>
              <div className="score-pill">{match.status.toLowerCase()}</div>
            </div>

            <p className="muted">
              Winner: {match.winner?.name ?? (match.result === "DRAW" ? "Draw" : "Pending")}
            </p>

            <div className="inline-meta">
              <span>{match.moves.length} moves</span>
              <span>Updated {formatDateTime(match.updatedAt)}</span>
            </div>

            {board ? <pre className="board-preview">{board}</pre> : null}
          </article>
        );
      })}
    </div>
  );
}
