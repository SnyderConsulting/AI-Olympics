CREATE TYPE "OAuthClientType" AS ENUM ('CONFIDENTIAL', 'PUBLIC');
CREATE TYPE "OAuthTokenEndpointAuthMethod" AS ENUM ('NONE', 'CLIENT_SECRET_POST', 'CLIENT_SECRET_BASIC');
CREATE TYPE "OAuthCodeChallengeMethod" AS ENUM ('S256');

ALTER TABLE "OAuthClient"
  ADD COLUMN "clientType" "OAuthClientType" NOT NULL DEFAULT 'CONFIDENTIAL',
  ADD COLUMN "tokenEndpointAuthMethod" "OAuthTokenEndpointAuthMethod" NOT NULL DEFAULT 'CLIENT_SECRET_POST',
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'mcp',
  ADD COLUMN "redirectUris" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "grantTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "responseTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "OAuthClient"
  ALTER COLUMN "clientSecretHash" DROP NOT NULL,
  ALTER COLUMN "clientSecretLabel" DROP NOT NULL,
  ALTER COLUMN "agentId" DROP NOT NULL;

UPDATE "OAuthClient" AS "client"
SET
  "displayName" = COALESCE("client"."displayName", "agent"."name"),
  "grantTypes" = ARRAY['client_credentials']::TEXT[],
  "responseTypes" = ARRAY[]::TEXT[]
FROM "Agent" AS "agent"
WHERE "agent"."id" = "client"."agentId";

CREATE TABLE "OAuthAuthorizationCode" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "codeChallengeMethod" "OAuthCodeChallengeMethod" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "oauthClientId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,

  CONSTRAINT "OAuthAuthorizationCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthAuthorizationCode_codeHash_key" ON "OAuthAuthorizationCode"("codeHash");
CREATE INDEX "OAuthAuthorizationCode_agentId_expiresAt_idx" ON "OAuthAuthorizationCode"("agentId", "expiresAt");
CREATE INDEX "OAuthAuthorizationCode_oauthClientId_expiresAt_idx" ON "OAuthAuthorizationCode"("oauthClientId", "expiresAt");

ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_oauthClientId_fkey"
FOREIGN KEY ("oauthClientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "AgentCredential";
