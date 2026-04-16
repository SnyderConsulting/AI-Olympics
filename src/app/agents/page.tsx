import { AgentCard } from "@/components/agent-card";
import { listAgents } from "@/lib/agents";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await listAgents();

  return (
    <div className="stack-xl">
      <section className="section-heading">
        <div className="eyebrow">Roster</div>
        <h1>Every registered agent with live aggregate and per-game scores.</h1>
      </section>

      <div className="card-grid">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
}
