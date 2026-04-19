import { OAuthClientType, OAuthTokenEndpointAuthMethod } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  getOAuthResourceUri,
  hashOAuthValue,
  issueOAuthAccessToken,
  issueOAuthAuthorizationCode,
  issueOAuthPublicClient,
  issueOAuthRefreshToken,
  OAUTH_AGENT_GRANT_TYPE,
  OAUTH_CODE_CHALLENGE_METHOD,
  OAUTH_CONNECTOR_GRANT_TYPE,
  OAUTH_REFRESH_GRANT_TYPE,
  OAUTH_SCOPE,
  verifyOAuthSecret,
  verifyPkceCodeVerifier,
} from "@/lib/oauth";

type DynamicClientMetadata = Record<string, unknown>;

function normalizeRequestedScope(scope: string | null | undefined) {
  return scope?.trim() || OAUTH_SCOPE;
}

function normalizeRequestedResource(resource: string | null | undefined) {
  return resource?.trim() || getOAuthResourceUri();
}

function normalizeGrantTypes(grantTypes: string[] | null | undefined) {
  const normalized = grantTypes?.length ? [...new Set(grantTypes)] : [OAUTH_CONNECTOR_GRANT_TYPE];

  for (const grantType of normalized) {
    if (![OAUTH_CONNECTOR_GRANT_TYPE, OAUTH_REFRESH_GRANT_TYPE].includes(grantType)) {
      throw new Error(`Unsupported grant type "${grantType}".`);
    }
  }

  if (!normalized.includes(OAUTH_CONNECTOR_GRANT_TYPE)) {
    throw new Error(`Dynamic clients must include ${OAUTH_CONNECTOR_GRANT_TYPE}.`);
  }

  return normalized;
}

function normalizeResponseTypes(responseTypes: string[] | null | undefined) {
  const normalized = responseTypes?.length ? [...new Set(responseTypes)] : ["code"];

  for (const responseType of normalized) {
    if (responseType !== "code") {
      throw new Error(`Unsupported response type "${responseType}".`);
    }
  }

  return normalized;
}

function normalizeDynamicClientMetadata(
  metadata: DynamicClientMetadata | null | undefined,
  args: {
    clientName?: string | null;
    redirectUris: string[];
    scope: string;
    grantTypes: string[];
    responseTypes: string[];
    tokenEndpointAuthMethod: "none";
  },
) {
  return {
    ...(metadata ?? {}),
    client_name: args.clientName?.trim() || "ChatGPT connector client",
    redirect_uris: args.redirectUris,
    scope: args.scope,
    grant_types: args.grantTypes,
    response_types: args.responseTypes,
    token_endpoint_auth_method: args.tokenEndpointAuthMethod,
  };
}

function parseOAuthClientMetadataJson(metadataJson: string | null) {
  if (!metadataJson) {
    return {} as DynamicClientMetadata;
  }

  try {
    const parsed = JSON.parse(metadataJson) as DynamicClientMetadata;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function buildAccessTokenResponse(args: {
  accessToken: string;
  expiresAt: Date;
  refreshToken?: string;
  refreshTokenExpiresAt?: Date;
}) {
  return {
    accessToken: args.accessToken,
    expiresIn: Math.max(1, Math.floor((args.expiresAt.getTime() - Date.now()) / 1000)),
    refreshToken: args.refreshToken,
    refreshTokenExpiresIn: args.refreshTokenExpiresAt
      ? Math.max(1, Math.floor((args.refreshTokenExpiresAt.getTime() - Date.now()) / 1000))
      : undefined,
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

function createRefreshTokenCreateInput(args: {
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
  grantTypes?: string[] | null;
  responseTypes?: string[] | null;
  scope?: string | null;
  metadata?: DynamicClientMetadata;
}) {
  const requestedScope = normalizeRequestedScope(args.scope);
  const requestedGrantTypes = normalizeGrantTypes(args.grantTypes);
  const requestedResponseTypes = normalizeResponseTypes(args.responseTypes);

  if (requestedScope !== OAUTH_SCOPE) {
    throw new Error(`Unsupported scope. Use "${OAUTH_SCOPE}".`);
  }

  const metadata = normalizeDynamicClientMetadata(args.metadata, {
    clientName: args.clientName,
    redirectUris: args.redirectUris,
    scope: requestedScope,
    grantTypes: requestedGrantTypes,
    responseTypes: requestedResponseTypes,
    tokenEndpointAuthMethod: "none",
  });

  const issued = issueOAuthPublicClient();
  const client = await db.oAuthClient.create({
    data: {
      clientId: issued.clientId,
      clientType: OAuthClientType.PUBLIC,
      tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod.NONE,
      displayName: args.clientName?.trim() || "ChatGPT connector client",
      scope: requestedScope,
      redirectUris: args.redirectUris,
      grantTypes: requestedGrantTypes,
      responseTypes: requestedResponseTypes,
      metadataJson: JSON.stringify(metadata),
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

  const issuedAccessToken = issueOAuthAccessToken();
  const issuedRefreshToken = oauthClient.grantTypes.includes(OAUTH_REFRESH_GRANT_TYPE)
    ? issueOAuthRefreshToken()
    : null;
  await revokeExpiredOAuthArtifacts(now);

  const operations = [
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
      data: createAccessTokenCreateInput({
        tokenHash: issuedAccessToken.tokenHash,
        expiresAt: issuedAccessToken.expiresAt,
        oauthClientId: oauthClient.id,
        agentId: authorizationCode.agent.id,
      }),
    }),
  ];

  if (issuedRefreshToken) {
    operations.push(
      db.oAuthRefreshToken.create({
        data: createRefreshTokenCreateInput({
          tokenHash: issuedRefreshToken.tokenHash,
          expiresAt: issuedRefreshToken.expiresAt,
          oauthClientId: oauthClient.id,
          agentId: authorizationCode.agent.id,
        }),
      }),
    );
  }

  await db.$transaction(operations);

  return {
    ...buildAccessTokenResponse({
      accessToken: issuedAccessToken.accessToken,
      expiresAt: issuedAccessToken.expiresAt,
      refreshToken: issuedRefreshToken?.refreshToken,
      refreshTokenExpiresAt: issuedRefreshToken?.expiresAt,
    }),
    agent: authorizationCode.agent,
  };
}

export async function exchangeOAuthRefreshToken(args: {
  clientId: string;
  refreshToken: string;
  resource?: string | null;
}) {
  const requestedResource = normalizeRequestedResource(args.resource);

  if (requestedResource !== getOAuthResourceUri()) {
    throw new Error("Unsupported resource indicator for this MCP server.");
  }

  const tokenHash = hashOAuthValue(args.refreshToken);
  const now = new Date();
  const storedRefreshToken = await db.oAuthRefreshToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: {
        gt: now,
      },
      audience: getOAuthResourceUri(),
      oauthClient: {
        clientId: args.clientId,
        clientType: OAuthClientType.PUBLIC,
        revokedAt: null,
        grantTypes: {
          has: OAUTH_REFRESH_GRANT_TYPE,
        },
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

  if (!storedRefreshToken) {
    throw new Error("Invalid or expired refresh token.");
  }

  const issuedAccessToken = issueOAuthAccessToken();
  const rotatedRefreshToken = issueOAuthRefreshToken();

  await revokeExpiredOAuthArtifacts(now);
  await db.$transaction([
    db.oAuthRefreshToken.update({
      where: {
        id: storedRefreshToken.id,
      },
      data: {
        revokedAt: now,
        lastUsedAt: now,
      },
    }),
    db.oAuthClient.update({
      where: {
        id: storedRefreshToken.oauthClientId,
      },
      data: {
        lastUsedAt: now,
      },
    }),
    db.oAuthAccessToken.create({
      data: createAccessTokenCreateInput({
        tokenHash: issuedAccessToken.tokenHash,
        expiresAt: issuedAccessToken.expiresAt,
        oauthClientId: storedRefreshToken.oauthClientId,
        agentId: storedRefreshToken.agent.id,
      }),
    }),
    db.oAuthRefreshToken.create({
      data: createRefreshTokenCreateInput({
        tokenHash: rotatedRefreshToken.tokenHash,
        expiresAt: rotatedRefreshToken.expiresAt,
        oauthClientId: storedRefreshToken.oauthClientId,
        agentId: storedRefreshToken.agent.id,
      }),
    }),
  ]);

  return {
    ...buildAccessTokenResponse({
      accessToken: issuedAccessToken.accessToken,
      expiresAt: issuedAccessToken.expiresAt,
      refreshToken: rotatedRefreshToken.refreshToken,
      refreshTokenExpiresAt: rotatedRefreshToken.expiresAt,
    }),
    agent: storedRefreshToken.agent,
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
    db.oAuthRefreshToken.deleteMany({
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

export function getOAuthClientRegistrationMetadata(oauthClient: {
  clientId: string;
  createdAt: Date;
  metadataJson: string | null;
}) {
  return {
    client_id: oauthClient.clientId,
    client_id_issued_at: Math.floor(oauthClient.createdAt.getTime() / 1000),
    ...parseOAuthClientMetadataJson(oauthClient.metadataJson),
  };
}
