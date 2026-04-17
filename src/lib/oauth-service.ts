import { OAuthClientType, OAuthTokenEndpointAuthMethod } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  getOAuthResourceUri,
  hashOAuthValue,
  issueOAuthAccessToken,
  issueOAuthAuthorizationCode,
  issueOAuthPublicClient,
  OAUTH_AGENT_GRANT_TYPE,
  OAUTH_CODE_CHALLENGE_METHOD,
  OAUTH_CONNECTOR_GRANT_TYPE,
  OAUTH_SCOPE,
  verifyOAuthSecret,
  verifyPkceCodeVerifier,
} from "@/lib/oauth";

function normalizeRequestedScope(scope: string | null | undefined) {
  return scope?.trim() || OAUTH_SCOPE;
}

function normalizeRequestedResource(resource: string | null | undefined) {
  return resource?.trim() || getOAuthResourceUri();
}

export async function authenticateAgentOAuthClientCredentials(args: {
  clientId: string;
  clientSecret: string;
}) {
  const oauthClient = await db.oAuthClient.findFirst({
    where: {
      clientId: args.clientId,
      clientType: OAuthClientType.CONFIDENTIAL,
      revokedAt: null,
      agentId: {
        not: null,
      },
    },
    include: {
      agent: {
        include: {
          ratings: true,
        },
      },
    },
  });

  if (!oauthClient?.clientSecretHash || !oauthClient.agent) {
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

export async function getOAuthClientByClientId(clientId: string) {
  return db.oAuthClient.findFirst({
    where: {
      clientId,
      revokedAt: null,
    },
  });
}

export async function registerOAuthDynamicClient(args: {
  clientName?: string | null;
  redirectUris: string[];
  scope?: string | null;
}) {
  const requestedScope = normalizeRequestedScope(args.scope);

  if (requestedScope !== OAUTH_SCOPE) {
    throw new Error(`Unsupported scope. Use "${OAUTH_SCOPE}".`);
  }

  const issued = issueOAuthPublicClient();
  const client = await db.oAuthClient.create({
    data: {
      clientId: issued.clientId,
      clientType: OAuthClientType.PUBLIC,
      tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod.NONE,
      displayName: args.clientName?.trim() || "ChatGPT connector client",
      scope: OAUTH_SCOPE,
      redirectUris: args.redirectUris,
      grantTypes: [OAUTH_CONNECTOR_GRANT_TYPE],
      responseTypes: ["code"],
    },
  });

  return client;
}

export async function issueOAuthAuthorizationCodeForAgent(args: {
  clientId: string;
  agentId: string;
  redirectUri: string;
  scope?: string | null;
  resource?: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
}) {
  const requestedScope = normalizeRequestedScope(args.scope);
  const requestedResource = normalizeRequestedResource(args.resource);

  if (requestedScope !== OAUTH_SCOPE) {
    throw new Error(`Unsupported scope. Use "${OAUTH_SCOPE}".`);
  }

  if (requestedResource !== getOAuthResourceUri()) {
    throw new Error("Unsupported resource indicator for this MCP server.");
  }

  if (args.codeChallengeMethod !== OAUTH_CODE_CHALLENGE_METHOD) {
    throw new Error(`Only ${OAUTH_CODE_CHALLENGE_METHOD} PKCE challenges are supported.`);
  }

  const oauthClient = await db.oAuthClient.findFirst({
    where: {
      clientId: args.clientId,
      clientType: OAuthClientType.PUBLIC,
      revokedAt: null,
      grantTypes: {
        has: OAUTH_CONNECTOR_GRANT_TYPE,
      },
    },
  });

  if (!oauthClient) {
    return null;
  }

  if (!oauthClient.redirectUris.includes(args.redirectUri)) {
    throw new Error("Redirect URI is not registered for this OAuth client.");
  }

  const issued = issueOAuthAuthorizationCode();
  await revokeExpiredOAuthArtifacts();

  await db.oAuthAuthorizationCode.create({
    data: {
      codeHash: issued.codeHash,
      redirectUri: args.redirectUri,
      scope: OAUTH_SCOPE,
      audience: getOAuthResourceUri(),
      codeChallenge: args.codeChallenge,
      codeChallengeMethod: args.codeChallengeMethod,
      expiresAt: issued.expiresAt,
      oauthClientId: oauthClient.id,
      agentId: args.agentId,
    },
  });

  return {
    authorizationCode: issued.code,
    oauthClient,
  };
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
    data: {
      tokenHash: issued.tokenHash,
      scope: OAUTH_SCOPE,
      audience: getOAuthResourceUri(),
      expiresAt: issued.expiresAt,
      oauthClientId: oauthClient.id,
      agentId: oauthClient.agent.id,
    },
  });

  return {
    accessToken: issued.accessToken,
    expiresIn: Math.max(1, Math.floor((issued.expiresAt.getTime() - Date.now()) / 1000)),
    scope: OAUTH_SCOPE,
    tokenType: "Bearer" as const,
    agent: oauthClient.agent,
  };
}

export async function exchangeOAuthAuthorizationCode(args: {
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  resource?: string | null;
}) {
  const requestedResource = normalizeRequestedResource(args.resource);

  if (requestedResource !== getOAuthResourceUri()) {
    throw new Error("Unsupported resource indicator for this MCP server.");
  }

  const oauthClient = await db.oAuthClient.findFirst({
    where: {
      clientId: args.clientId,
      clientType: OAuthClientType.PUBLIC,
      revokedAt: null,
      grantTypes: {
        has: OAUTH_CONNECTOR_GRANT_TYPE,
      },
    },
  });

  if (!oauthClient) {
    return null;
  }

  if (!oauthClient.redirectUris.includes(args.redirectUri)) {
    throw new Error("Redirect URI is not registered for this OAuth client.");
  }

  const codeHash = hashOAuthValue(args.code);
  const now = new Date();
  const authorizationCode = await db.oAuthAuthorizationCode.findFirst({
    where: {
      codeHash,
      oauthClientId: oauthClient.id,
      redirectUri: args.redirectUri,
      revokedAt: null,
      usedAt: null,
      expiresAt: {
        gt: now,
      },
      audience: getOAuthResourceUri(),
      scope: OAUTH_SCOPE,
    },
    include: {
      agent: {
        include: {
          ratings: true,
        },
      },
    },
  });

  if (!authorizationCode) {
    throw new Error("Invalid or expired authorization code.");
  }

  if (
    !verifyPkceCodeVerifier({
      codeVerifier: args.codeVerifier,
      expectedCodeChallenge: authorizationCode.codeChallenge,
    })
  ) {
    throw new Error("Invalid PKCE code verifier.");
  }

  const issued = issueOAuthAccessToken();
  await revokeExpiredOAuthArtifacts(now);

  await db.$transaction([
    db.oAuthAuthorizationCode.update({
      where: {
        id: authorizationCode.id,
      },
      data: {
        usedAt: now,
      },
    }),
    db.oAuthClient.update({
      where: {
        id: oauthClient.id,
      },
      data: {
        lastUsedAt: now,
      },
    }),
    db.oAuthAccessToken.create({
      data: {
        tokenHash: issued.tokenHash,
        scope: OAUTH_SCOPE,
        audience: getOAuthResourceUri(),
        expiresAt: issued.expiresAt,
        oauthClientId: oauthClient.id,
        agentId: authorizationCode.agent.id,
      },
    }),
  ]);

  return {
    accessToken: issued.accessToken,
    expiresIn: Math.max(1, Math.floor((issued.expiresAt.getTime() - Date.now()) / 1000)),
    scope: OAUTH_SCOPE,
    tokenType: "Bearer" as const,
    agent: authorizationCode.agent,
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
  await Promise.all([
    db.oAuthAuthorizationCode.deleteMany({
      where: {
        OR: [
          {
            expiresAt: {
              lte: referenceDate,
            },
          },
          {
            usedAt: {
              not: null,
            },
          },
          {
            revokedAt: {
              not: null,
            },
          },
        ],
      },
    }),
    db.oAuthAccessToken.deleteMany({
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
    }),
  ]);
}
