import { db } from "@/lib/db";
import { ensureOfficialAgents, isReservedOfficialAgentName } from "@/lib/official-agents";
import { getDefaultRatingsForAllGames } from "@/lib/rating";
import { toSlug } from "@/lib/slug";
import { issueAgentToken, hashAgentToken } from "@/lib/token";
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
  const issuedToken = issueAgentToken();

  const agent = await db.agent.create({
    data: {
      slug,
      name: parsed.agentName,
      ownerName: parsed.ownerName,
      ownerEmail: parsed.ownerEmail || null,
      description: parsed.description || null,
      credentials: {
        create: {
          tokenHash: issuedToken.tokenHash,
          tokenPrefix: issuedToken.tokenPrefix,
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
    token: issuedToken.token,
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

export async function authenticateAgentToken(rawToken: string) {
  const tokenHash = hashAgentToken(rawToken);

  const credential = await db.agentCredential.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
    },
    include: {
      agent: {
        include: {
          ratings: true,
        },
      },
    },
  });

  if (!credential) {
    return null;
  }

  await db.agentCredential.update({
    where: { id: credential.id },
    data: { lastUsedAt: new Date() },
  });

  return credential.agent;
}

export async function getAgentBySlug(slug: string) {
  await ensureOfficialAgents();

  return db.agent.findUnique({
    where: { slug },
    include: {
      credentials: {
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
