"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { Agent, Rating } from "@/generated/prisma/client";

import { AgentCard } from "@/components/agent-card";

type AgentWithRatings = Agent & {
  ratings: Rating[];
};

type AgentsPageResponse = {
  agents: AgentWithRatings[];
  page: number;
  pageSize: number;
  totalAgents: number;
  totalPages: number;
};

type AgentsRosterProps = {
  initialAgents: AgentWithRatings[];
  initialPage: number;
  initialPageSize: number;
  initialTotalAgents: number;
  initialTotalPages: number;
};

const PRELOAD_MARGIN = "640px 0px";

export function AgentsRoster({
  initialAgents,
  initialPage,
  initialPageSize,
  initialTotalAgents,
  initialTotalPages,
}: AgentsRosterProps) {
  const [agents, setAgents] = useState(initialAgents);
  const [knownTotalAgents, setKnownTotalAgents] = useState(initialTotalAgents);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const nextPageRef = useRef(initialPage + 1);
  const totalPagesRef = useRef(initialTotalPages);
  const loadingRef = useRef(false);

  const hasMore = nextPageRef.current <= totalPagesRef.current;

  const loadMoreAgents = useCallback(async () => {
    if (loadingRef.current || nextPageRef.current > totalPagesRef.current) {
      return;
    }

    loadingRef.current = true;
    setLoadError(null);

    try {
      const response = await fetch(
        `/api/agents?page=${nextPageRef.current}&pageSize=${initialPageSize}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("Unable to load more agents.");
      }

      const payload = (await response.json()) as AgentsPageResponse;
      nextPageRef.current = payload.page + 1;
      totalPagesRef.current = payload.totalPages;

      startTransition(() => {
        setKnownTotalAgents(payload.totalAgents);
        setAgents((currentAgents) => {
          const seenIds = new Set(currentAgents.map((agent) => agent.id));
          const newAgents = payload.agents.filter((agent) => !seenIds.has(agent.id));
          return currentAgents.concat(newAgents);
        });
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load more agents.");
    } finally {
      loadingRef.current = false;
    }
  }, [initialPageSize, startTransition]);

  useEffect(() => {
    const target = sentinelRef.current;

    if (!target || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreAgents();
        }
      },
      { rootMargin: PRELOAD_MARGIN },
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [hasMore, loadMoreAgents]);

  return (
    <div className="stack-m">
      <div className="agent-roster">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} variant="compact" />
        ))}
      </div>

      {hasMore ? <div aria-hidden="true" className="infinite-list-sentinel" ref={sentinelRef} /> : null}

      <div aria-live="polite" className="infinite-list-status" role="status">
        {loadError ? (
          <button className="button button--ghost" onClick={() => void loadMoreAgents()} type="button">
            Retry loading more agents
          </button>
        ) : null}

        {!loadError && isPending ? <span>Loading more agents…</span> : null}

        {!loadError && !isPending && !hasMore ? (
          <span>Showing all {knownTotalAgents} agents.</span>
        ) : null}
      </div>
    </div>
  );
}
