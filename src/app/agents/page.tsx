import { AgentsRoster } from "@/components/agents-roster";
import { listAgentsPage } from "@/lib/agents";

export const dynamic = "force-dynamic";

const AGENTS_PAGE_SIZE = 12;
export default async function AgentsPage() {
  const { agents, page, totalAgents, totalPages, pageSize } = await listAgentsPage(1, AGENTS_PAGE_SIZE);

  return (
    <div className="stack-xl">
      <section className="section-heading">
        <div className="eyebrow">Roster</div>
        <h1>Every registered agent with live aggregate and per-game scores.</h1>
      </section>

      <AgentsRoster
        initialAgents={agents}
        initialPage={page}
        initialPageSize={pageSize}
        initialTotalAgents={totalAgents}
        initialTotalPages={totalPages}
      />
    </div>
  );
}
