import { describe, expect, it } from "vitest";

import {
  derivePkceCodeChallengeS256,
  getOAuthAuthorizationEndpointUrl,
  getOAuthProtectedResourceMetadataUrl,
  getOAuthRegistrationEndpointUrl,
  getOAuthResourceUri,
  getOAuthTokenEndpointUrl,
  issueOAuthAccessToken,
  issueOAuthAuthorizationCode,
  issueOAuthClientCredentials,
  issueOAuthPublicClient,
  OAUTH_AGENT_GRANT_TYPE,
  OAUTH_CONNECTOR_GRANT_TYPE,
  verifyOAuthSecret,
  verifyPkceCodeVerifier,
} from "@/lib/oauth";

describe("oauth helpers", () => {
  it("issues client credentials that verify against the stored hash", () => {
    const issued = issueOAuthClientCredentials();

    expect(issued.clientId).toMatch(/^aio_client_/);
    expect(issued.clientSecret).toMatch(/^aio_cs_/);
    expect(verifyOAuthSecret(issued.clientSecret, issued.clientSecretHash)).toBe(true);
    expect(verifyOAuthSecret("wrong-secret", issued.clientSecretHash)).toBe(false);
  });

  it("issues public connector clients and authorization codes", () => {
    const publicClient = issueOAuthPublicClient();
    const authorizationCode = issueOAuthAuthorizationCode();

    expect(publicClient.clientId).toMatch(/^aio_public_/);
    expect(authorizationCode.code).toMatch(/^aio_code_/);
    expect(authorizationCode.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("issues access tokens with a future expiry", () => {
    const issued = issueOAuthAccessToken();

    expect(issued.accessToken).toMatch(/^aio_at_/);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("derives and verifies PKCE challenges", () => {
    const verifier = "sample-verifier-123";
    const challenge = derivePkceCodeChallengeS256(verifier);

    expect(verifyPkceCodeVerifier({
      codeVerifier: verifier,
      expectedCodeChallenge: challenge,
    })).toBe(true);
    expect(verifyPkceCodeVerifier({
      codeVerifier: "wrong-verifier",
      expectedCodeChallenge: challenge,
    })).toBe(false);
  });

  it("derives OAuth metadata URLs from the MCP public URL", () => {
    expect(getOAuthResourceUri()).toBe("http://127.0.0.1:8787/mcp");
    expect(getOAuthAuthorizationEndpointUrl()).toBe("http://127.0.0.1:8787/authorize");
    expect(getOAuthTokenEndpointUrl()).toBe("http://127.0.0.1:8787/token");
    expect(getOAuthRegistrationEndpointUrl()).toBe("http://127.0.0.1:8787/register");
    expect(getOAuthProtectedResourceMetadataUrl()).toBe(
      "http://127.0.0.1:8787/.well-known/oauth-protected-resource",
    );
  });

  it("exports the expected OAuth grant identifiers", () => {
    expect(OAUTH_AGENT_GRANT_TYPE).toBe("client_credentials");
    expect(OAUTH_CONNECTOR_GRANT_TYPE).toBe("authorization_code");
  });
});
