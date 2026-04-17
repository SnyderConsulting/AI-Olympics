import { db } from "@/lib/db";
import {
  ensureOfficialAgents,
  getVisibleAgentWhere,
  isReservedOfficialAgentName,
} from "@/lib/official-agents";
import {
  OAUTH_AGENT_GRANT_TYPE,
  getOAuthResourceUri,
  getOAuthTokenEndpointUrl,
  issueOAuthClientCredentials,
  OAUTH_SCOPE,
} from "@/lib/oauth";
import { getDefaultRatingsForAllGames } from "@/lib/rating";
import { toSlug } from "@/lib/slug";
import { z } from "zod";

const registerAgentSchema = z.object({
  agentName: z.string().trim().min(2).max(40),
  ownerName: z.string().trim().min(2).max(60),
  ownerEmail: z
    .string()
    .trim()
    .email()
    .max(120)
    .optional()
    .or(z.literal("")),
  description: z.string().trim().max(240).optional().or(z.literal("")),
});

export type RegisterAgentInput = z.infer<typeof registerAgentSchema>;

export async function registerAgent(input: RegisterAgentInput) {
  const parsed = registerAgentSchema.parse(input);

  if (isReservedOfficialAgentName(parsed.agentName)) {
    throw new Error("That agent name is reserved for an official platform agent.");
  }

  const slug = await createUniqueSlug(parsed.agentName);
  const oauthClient = issueOAuthClientCredentials();

  const agent = await db.agent.create({
    data: {
      slug,
      name: parsed.agentName,
      ownerName: parsed.ownerName,
      ownerEmail: parsed.ownerEmail || null,
      description: parsed.description || null,
      oauthClients: {
        create: {
          clientId: oauthClient.clientId,
          clientSecretHash: oauthClient.clientSecretHash,
          clientSecretLabel: oauthClient.clientSecretLabel,
          displayName: `${parsed.agentName} direct runtime client`,
          scope: OAUTH_SCOPE,
          grantTypes: [OAUTH_AGENT_GRANT_TYPE],
        },
      },
      ratings: {
        create: getDefaultRatingsForAllGames(),
      },
    },
    include: {
      ratings: true,
    },
  });

  return {
    agent,
    oauth: {
      clientId: oauthClient.clientId,
      clientSecret: oauthClient.clientSecret,
      grantType: OAUTH_AGENT_GRANT_TYPE,
      scope: OAUTH_SCOPE,
      tokenEndpoint: getOAuthTokenEndpointUrl(),
      resource: getOAuthResourceUri(),
    },
  };
}

export async function createUniqueSlug(name: string) {
  const baseSlug = toSlug(name) || "agent";

  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
    const existing = await db.agent.findUnique({ where: { slug: candidate } });

    if (!existing) {
      return candidate;
    }
  }

  throw new Error("Unable to create a unique slug for this agent.");
}

export async function getAgentBySlug(slug: string) {
  await ensureOfficialAgents();

  return db.agent.findFirst({
    where: {
      AND: [getVisibleAgentWhere(), { slug }],
    },
    include: {
      oauthClients: {
        orderBy: {
          createdAt: "desc",
        },
      },
      ratings: {
        orderBy: {
          gameKey: "asc",
        },
      },
    },
  });
}

export async function listAgents() {
  await ensureOfficialAgents();

  return db.agent.findMany({
    where: getVisibleAgentWhere(),
    include: {
      ratings: {
        orderBy: {
          gameKey: "asc",
        },
      },
    },
    orderBy: [{ aggregateRating: "desc" }, { name: "asc" }],
  });
}
