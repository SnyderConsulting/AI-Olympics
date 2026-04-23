import { db } from "@/lib/db";
import {
  getOAuthResourceUri,
  hashOAuthValue,
  issueOAuthAccessToken,
  OAUTH_AGENT_GRANT_TYPE,
  OAUTH_SCOPE,
  verifyOAuthSecret,
} from "@/lib/oauth";

function normalizeRequestedScope(scope: string | null | undefined) {
  return scope?.trim() || OAUTH_SCOPE;
}

function normalizeRequestedResource(resource: string | null | undefined) {
  return resource?.trim() || getOAuthResourceUri();
}

function buildAccessTokenResponse(args: {
  accessToken: string;
  expiresAt: Date;
}) {
  return {
    accessToken: args.accessToken,
    expiresIn: Math.max(1, Math.floor((args.expiresAt.getTime() - Date.now()) / 1000)),
    scope: OAUTH_SCOPE,
    tokenType: "Bearer" as const,
  };
}

function createAccessTokenCreateInput(args: {
  tokenHash: string;
  expiresAt: Date;
  oauthClientId: string;
  agentId: string;
}) {
  return {
    tokenHash: args.tokenHash,
    scope: OAUTH_SCOPE,
    audience: getOAuthResourceUri(),
    expiresAt: args.expiresAt,
    oauthClientId: args.oauthClientId,
    agentId: args.agentId,
  };
}

export async function authenticateAgentOAuthClientCredentials(args: {
  clientId: string;
  clientSecret: string;
}) {
  const oauthClient = await db.oAuthClient.findFirst({
    where: {
      clientId: args.clientId,
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

  if (!oauthClient?.agent) {
    return null;
  }

  if (!verifyOAuthSecret(args.clientSecret, oauthClient.clientSecretHash)) {
    return null;
  }

  await db.oAuthClient.update({
    where: {
      id: oauthClient.id,
    },
    data: {
      lastUsedAt: new Date(),
    },
  });

  return oauthClient;
}

export async function exchangeOAuthClientCredentials(args: {
  clientId: string;
  clientSecret: string;
  scope?: string | null;
  resource?: string | null;
}) {
  const requestedScope = normalizeRequestedScope(args.scope);
  const requestedResource = normalizeRequestedResource(args.resource);

  if (requestedScope !== OAUTH_SCOPE) {
    throw new Error(`Unsupported scope. Use "${OAUTH_SCOPE}".`);
  }

  if (requestedResource !== getOAuthResourceUri()) {
    throw new Error("Unsupported resource indicator for this MCP server.");
  }

  const oauthClient = await authenticateAgentOAuthClientCredentials({
    clientId: args.clientId,
    clientSecret: args.clientSecret,
  });

  if (!oauthClient?.agent) {
    return null;
  }

  if (!oauthClient.grantTypes.includes(OAUTH_AGENT_GRANT_TYPE)) {
    throw new Error(`OAuth client is not allowed to use ${OAUTH_AGENT_GRANT_TYPE}.`);
  }

  const issued = issueOAuthAccessToken();
  await revokeExpiredOAuthArtifacts();

  await db.oAuthAccessToken.create({
    data: createAccessTokenCreateInput({
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
      oauthClientId: oauthClient.id,
      agentId: oauthClient.agent.id,
    }),
  });

  return {
    ...buildAccessTokenResponse({
      accessToken: issued.accessToken,
      expiresAt: issued.expiresAt,
    }),
    agent: oauthClient.agent,
  };
}

export async function authenticateOAuthAccessToken(rawToken: string) {
  const tokenHash = hashOAuthValue(rawToken);
  const now = new Date();

  const accessToken = await db.oAuthAccessToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: {
        gt: now,
      },
      audience: getOAuthResourceUri(),
      oauthClient: {
        revokedAt: null,
      },
    },
    include: {
      agent: {
        include: {
          ratings: true,
        },
      },
      oauthClient: true,
    },
  });

  if (!accessToken || accessToken.scope !== OAUTH_SCOPE) {
    return null;
  }

  await Promise.all([
    db.oAuthAccessToken.update({
      where: {
        id: accessToken.id,
      },
      data: {
        lastUsedAt: now,
      },
    }),
    db.oAuthClient.update({
      where: {
        id: accessToken.oauthClientId,
      },
      data: {
        lastUsedAt: now,
      },
    }),
  ]);

  return accessToken.agent;
}

export async function revokeExpiredOAuthArtifacts(referenceDate = new Date()) {
  await db.oAuthAccessToken.deleteMany({
    where: {
      OR: [
        {
          expiresAt: {
            lte: referenceDate,
          },
        },
        {
          revokedAt: {
            not: null,
          },
        },
      ],
    },
  });
}
