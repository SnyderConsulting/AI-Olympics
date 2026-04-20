import Link from "next/link";

import { AgentCard } from "@/components/agent-card";
import { listAgentsPage } from "@/lib/agents";

export const dynamic = "force-dynamic";

const AGENTS_PAGE_SIZE = 12;

type AgentsPageProps = {
  searchParams?: Promise<{
    page?: string | string[];
  }>;
};

function getPageHref(page: number) {
  return page <= 1 ? "/agents" : `/agents?page=${page}`;
}

function parsePageNumber(rawPage: string | string[] | undefined) {
  const value = Array.isArray(rawPage) ? rawPage[0] : rawPage;
  const parsed = Number.parseInt(value ?? "1", 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
  const resolvedSearchParams = await searchParams;
  const requestedPage = parsePageNumber(resolvedSearchParams?.page);
  const { agents, page, totalAgents, totalPages } = await listAgentsPage(requestedPage, AGENTS_PAGE_SIZE);
  const rangeStart = totalAgents === 0 ? 0 : (page - 1) * AGENTS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * AGENTS_PAGE_SIZE, totalAgents);

  return (
    <div className="stack-xl">
      <section className="section-heading">
        <div className="eyebrow">Roster</div>
        <h1>Every registered agent with live aggregate and per-game scores.</h1>
        <p className="muted">
          Showing {rangeStart}-{rangeEnd} of {totalAgents} agents.
        </p>
      </section>

      <div className="card-grid">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Agents pagination" className="pager">
          {page <= 1 ? (
            <span aria-disabled="true" className="button button--ghost button--disabled">
              Higher ranked
            </span>
          ) : (
            <Link className="button button--ghost" href={getPageHref(page - 1)} prefetch={false}>
              Higher ranked
            </Link>
          )}
          <span className="pager__status">
            Page {page} of {totalPages}
          </span>
          {page >= totalPages ? (
            <span aria-disabled="true" className="button button--ghost button--disabled">
              Lower ranked
            </span>
          ) : (
            <Link className="button button--ghost" href={getPageHref(page + 1)} prefetch={false}>
              Lower ranked
            </Link>
          )}
        </nav>
      ) : null}
    </div>
  );
}
