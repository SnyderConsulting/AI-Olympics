import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

export const OAUTH_SCOPE = "mcp";
export const OAUTH_AGENT_GRANT_TYPE = "client_credentials";
export const OAUTH_CONNECTOR_GRANT_TYPE = "authorization_code";
export const OAUTH_REFRESH_GRANT_TYPE = "refresh_token";
export const OAUTH_CODE_CHALLENGE_METHOD = "S256";

export type IssuedOAuthClientCredentials = {
  clientId: string;
  clientSecret: string;
  clientSecretHash: string;
  clientSecretLabel: string;
};

export type IssuedOAuthPublicClient = {
  clientId: string;
};

export type IssuedOAuthAccessToken = {
  accessToken: string;
  tokenHash: string;
  expiresAt: Date;
};

export type IssuedOAuthRefreshToken = {
  refreshToken: string;
  tokenHash: string;
  expiresAt: Date;
};

export type IssuedOAuthAuthorizationCode = {
  code: string;
  codeHash: string;
  expiresAt: Date;
};

export function hashOAuthValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function issueOAuthClientCredentials(): IssuedOAuthClientCredentials {
  const clientLabel = randomBytes(4).toString("hex");
  const secretLabel = randomBytes(4).toString("hex");
  const clientSecret = `aio_cs_${secretLabel}_${randomBytes(24).toString("base64url")}`;

  return {
    clientId: `aio_client_${clientLabel}`,
    clientSecret,
    clientSecretHash: hashOAuthValue(clientSecret),
    clientSecretLabel: `aio_cs_${secretLabel}`,
  };
}

export function issueOAuthPublicClient(): IssuedOAuthPublicClient {
  return {
    clientId: `aio_public_${randomBytes(6).toString("hex")}`,
  };
}

export function issueOAuthAccessToken(): IssuedOAuthAccessToken {
  const accessToken = `aio_at_${randomBytes(8).toString("hex")}_${randomBytes(24).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + env.OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000);

  return {
    accessToken,
    tokenHash: hashOAuthValue(accessToken),
    expiresAt,
  };
}

export function issueOAuthRefreshToken(): IssuedOAuthRefreshToken {
  const refreshToken =
    `aio_rt_${randomBytes(8).toString("hex")}_${randomBytes(24).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + env.OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000);

  return {
    refreshToken,
    tokenHash: hashOAuthValue(refreshToken),
    expiresAt,
  };
}

export function issueOAuthAuthorizationCode(): IssuedOAuthAuthorizationCode {
  const code = `aio_code_${randomBytes(8).toString("hex")}_${randomBytes(18).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + env.OAUTH_AUTHORIZATION_CODE_TTL_SECONDS * 1000);

  return {
    code,
    codeHash: hashOAuthValue(code),
    expiresAt,
  };
}

export function verifyOAuthSecret(rawValue: string, storedHash: string) {
  const rawHash = hashOAuthValue(rawValue);
  const rawBuffer = Buffer.from(rawHash, "utf8");
  const storedBuffer = Buffer.from(storedHash, "utf8");

  if (rawBuffer.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(rawBuffer, storedBuffer);
}

export function derivePkceCodeChallengeS256(codeVerifier: string) {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function verifyPkceCodeVerifier(args: {
  codeVerifier: string;
  expectedCodeChallenge: string;
}) {
  return derivePkceCodeChallengeS256(args.codeVerifier) === args.expectedCodeChallenge;
}

export function getOAuthAuthorizationServerBaseUrl() {
  const url = new URL(env.MCP_PUBLIC_URL);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function getOAuthProtectedResourceMetadataUrl() {
  return `${getOAuthAuthorizationServerBaseUrl()}/.well-known/oauth-protected-resource`;
}

export function getOAuthAuthorizationServerMetadataUrl() {
  return `${getOAuthAuthorizationServerBaseUrl()}/.well-known/oauth-authorization-server`;
}

export function getOAuthAuthorizationEndpointUrl() {
  return `${getOAuthAuthorizationServerBaseUrl()}/authorize`;
}

export function getOAuthTokenEndpointUrl() {
  return `${getOAuthAuthorizationServerBaseUrl()}/token`;
}

export function getOAuthRegistrationEndpointUrl() {
  return `${getOAuthAuthorizationServerBaseUrl()}/register`;
}

export function getOAuthResourceUri() {
  return new URL(env.MCP_PUBLIC_URL).toString();
}
