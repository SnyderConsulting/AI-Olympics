import { type Agent, Prisma } from "@/generated/prisma/client";
import { AgentKind, AgentProvider } from "@/generated/prisma/enums";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { GAMES, type GameKey } from "@/lib/games";
import { OFFICIAL_AGENT_SPECS, RESERVED_OFFICIAL_AGENT_NAMES } from "@/lib/official-models";
import { ensureAllAgentsHaveCurrentRatings } from "@/lib/rating";

declare global {
  var officialAgentSyncPromise: Promise<void> | undefined;
}

const CURRENT_OFFICIAL_KEYS = new Set(
  OFFICIAL_AGENT_SPECS.map((spec) => spec.officialKey),
);
const CURRENT_OFFICIAL_KEYS_LIST = OFFICIAL_AGENT_SPECS.map((spec) => spec.officialKey);
const visibleAgentWhere = {
  OR: [
    {
      kind: AgentKind.USER,
    },
    {
      kind: AgentKind.OFFICIAL,
      officialKey: {
        in: CURRENT_OFFICIAL_KEYS_LIST,
      },
    },
  ],
} as const satisfies Prisma.AgentWhereInput;

export async function ensureOfficialAgents() {
  if (await officialAgentSyncRequired()) {
    const syncPromise = globalThis.officialAgentSyncPromise ??= syncOfficialAgents();

    try {
      await syncPromise;
    } catch (error) {
      throw error;
    } finally {
      if (globalThis.officialAgentSyncPromise === syncPromise) {
        globalThis.officialAgentSyncPromise = undefined;
      }
    }
  }

  await ensureAllAgentsHaveCurrentRatings();
}

export function isReservedOfficialAgentName(name: string) {
  return RESERVED_OFFICIAL_AGENT_NAMES.has(name.trim());
}

export function getVisibleAgentWhere(): Prisma.AgentWhereInput {
  return visibleAgentWhere;
}

export function isOfficialAgentRunnable(agent: Pick<Agent, "kind" | "provider">) {
  if (agent.kind !== AgentKind.OFFICIAL) {
    return false;
  }

  switch (agent.provider) {
    case AgentProvider.OPENAI:
      return Boolean(env.OPENAI_API_KEY);
    case AgentProvider.GOOGLE:
      return Boolean(env.GOOGLE_API_KEY);
    default:
      return false;
  }
}

export async function listRunnableOfficialAgents() {
  const agents = await listEligibleOfficialAgentsForGame("tic-tac-toe");

  return agents.filter((agent) => isOfficialAgentRunnable(agent));
}

export async function listEligibleOfficialAgentsForGame(gameKey: GameKey) {
  await ensureOfficialAgents();

  const agents = await db.agent.findMany({
    where: {
      kind: AgentKind.OFFICIAL,
    },
    orderBy: {
      name: "asc",
    },
  });

  return agents.filter((agent) => {
    if (!agent.officialKey) {
      return false;
    }

    if (!CURRENT_OFFICIAL_KEYS.has(agent.officialKey)) {
      return false;
    }

    if (gameKey === "frontier") {
      return true;
    }

    return isOfficialAgentRunnable(agent);
  });
}

async function officialAgentSyncRequired() {
  const existingAgents = await db.agent.findMany({
    where: {
      kind: AgentKind.OFFICIAL,
    },
    select: {
      officialKey: true,
      provider: true,
      modelId: true,
      name: true,
      slug: true,
      ownerName: true,
      description: true,
    },
  });

  const agentsByOfficialKey = new Map(
    existingAgents.map((agent) => [agent.officialKey, agent]),
  );

  for (const spec of OFFICIAL_AGENT_SPECS) {
    const existingAgent = agentsByOfficialKey.get(spec.officialKey);

    if (
      !existingAgent ||
      existingAgent.provider !== spec.provider ||
      existingAgent.modelId !== spec.modelId ||
      existingAgent.name !== spec.name ||
      existingAgent.slug !== spec.slug ||
      existingAgent.ownerName !== spec.ownerName ||
      existingAgent.description !== spec.description
    ) {
      return true;
    }
  }

  const staleDeletableAgent = await db.agent.findFirst({
    where: {
      kind: AgentKind.OFFICIAL,
      officialKey: {
        notIn: CURRENT_OFFICIAL_KEYS_LIST,
      },
      matchesAsPlayerOne: {
        none: {},
      },
      matchesAsPlayerTwo: {
        none: {},
      },
      wins: {
        none: {},
      },
    },
    select: {
      id: true,
    },
  });

  if (staleDeletableAgent) {
    return true;
  }

  return false;
}

async function syncOfficialAgents() {
  await db.agent.deleteMany({
    where: {
      kind: AgentKind.OFFICIAL,
      officialKey: {
        notIn: CURRENT_OFFICIAL_KEYS_LIST,
      },
      matchesAsPlayerOne: {
        none: {},
      },
      matchesAsPlayerTwo: {
        none: {},
      },
      wins: {
        none: {},
      },
    },
  });

  for (const spec of OFFICIAL_AGENT_SPECS) {
    const agent = await db.agent.upsert({
      where: {
        officialKey: spec.officialKey,
      },
      update: {
        kind: AgentKind.OFFICIAL,
        provider: spec.provider,
        modelId: spec.modelId,
        slug: spec.slug,
        name: spec.name,
        ownerName: spec.ownerName,
        description: spec.description,
      },
      create: {
        kind: AgentKind.OFFICIAL,
        provider: spec.provider,
        modelId: spec.modelId,
        officialKey: spec.officialKey,
        slug: spec.slug,
        name: spec.name,
        ownerName: spec.ownerName,
        description: spec.description,
      },
    });

    for (const game of GAMES) {
      await db.rating.upsert({
        where: {
          agentId_gameKey: {
            agentId: agent.id,
            gameKey: game.key,
          },
        },
        update: {},
        create: {
          agentId: agent.id,
          gameKey: game.key,
        },
      });
    }
  }
}
