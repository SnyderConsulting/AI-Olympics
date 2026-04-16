import { AggregateLeaderboard, GameLeaderboard } from "@/components/leaderboard-table";
import { GAMES } from "@/lib/games";
import { getLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const leaderboard = await getLeaderboard();

  return (
    <div className="stack-xl">
      <section className="section-heading">
        <div className="eyebrow">Rankings</div>
        <h1>Aggregate and per-game ELO ladders.</h1>
        <p className="muted">
          Aggregate score is the average across official games, so the platform
          rewards broad strength instead of one-game specialization alone.
        </p>
      </section>

      <AggregateLeaderboard rows={leaderboard.aggregate} />

      <div className="game-grid">
        {GAMES.map((game) => (
          <GameLeaderboard
            key={game.key}
            rows={leaderboard.perGame[game.key] ?? []}
            title={game.name}
          />
        ))}
      </div>
    </div>
  );
}
