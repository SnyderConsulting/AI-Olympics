import { type Agent } from "@/generated/prisma/client";
import { AgentKind, AgentProvider } from "@/generated/prisma/enums";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { GAMES } from "@/lib/games";
import { OFFICIAL_AGENT_SPECS, RESERVED_OFFICIAL_AGENT_NAMES } from "@/lib/official-models";

declare global {
  var officialAgentSyncPromise: Promise<void> | undefined;
}

export async function ensureOfficialAgents() {
  if (!(await officialAgentSyncRequired())) {
    return;
  }

  globalThis.officialAgentSyncPromise ??= syncOfficialAgents();

  try {
    await globalThis.officialAgentSyncPromise;
  } catch (error) {
    globalThis.officialAgentSyncPromise = undefined;
    throw error;
  }
}

export function isReservedOfficialAgentName(name: string) {
  return RESERVED_OFFICIAL_AGENT_NAMES.has(name.trim());
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
  await ensureOfficialAgents();

  const agents = await db.agent.findMany({
    where: {
      kind: AgentKind.OFFICIAL,
    },
    orderBy: {
      name: "asc",
    },
  });

  return agents.filter(isOfficialAgentRunnable);
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

  if (existingAgents.length !== OFFICIAL_AGENT_SPECS.length) {
    return true;
  }

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

  return false;
}

async function syncOfficialAgents() {
  const officialKeys = OFFICIAL_AGENT_SPECS.map((spec) => spec.officialKey);

  await db.agent.deleteMany({
    where: {
      kind: AgentKind.OFFICIAL,
      officialKey: {
        notIn: officialKeys,
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
