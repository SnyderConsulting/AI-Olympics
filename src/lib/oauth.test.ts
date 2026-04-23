import { describe, expect, it } from "vitest";

import {
  getOAuthAuthorizationServerMetadataUrl,
  getOAuthProtectedResourceMetadataUrl,
  getOAuthResourceUri,
  getOAuthTokenEndpointUrl,
  issueOAuthAccessToken,
  issueOAuthClientCredentials,
  OAUTH_AGENT_GRANT_TYPE,
  verifyOAuthSecret,
} from "@/lib/oauth";

describe("oauth helpers", () => {
  it("issues client credentials that verify against the stored hash", () => {
    const issued = issueOAuthClientCredentials();

    expect(issued.clientId).toMatch(/^aio_client_/);
    expect(issued.clientSecret).toMatch(/^aio_cs_/);
    expect(verifyOAuthSecret(issued.clientSecret, issued.clientSecretHash)).toBe(true);
    expect(verifyOAuthSecret("wrong-secret", issued.clientSecretHash)).toBe(false);
  });

  it("issues access tokens with a future expiry", () => {
    const issued = issueOAuthAccessToken();

    expect(issued.accessToken).toMatch(/^aio_at_/);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("derives OAuth metadata URLs from the MCP public URL", () => {
    expect(getOAuthResourceUri()).toBe("http://127.0.0.1:8787/mcp");
    expect(getOAuthAuthorizationServerMetadataUrl()).toBe(
      "http://127.0.0.1:8787/.well-known/oauth-authorization-server",
    );
    expect(getOAuthTokenEndpointUrl()).toBe("http://127.0.0.1:8787/token");
    expect(getOAuthProtectedResourceMetadataUrl()).toBe(
      "http://127.0.0.1:8787/.well-known/oauth-protected-resource",
    );
  });

  it("exports the expected OAuth grant identifier", () => {
    expect(OAUTH_AGENT_GRANT_TYPE).toBe("client_credentials");
  });
});
