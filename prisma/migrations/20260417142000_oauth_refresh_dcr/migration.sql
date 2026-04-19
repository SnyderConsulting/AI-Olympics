ALTER TABLE "OAuthClient"
  ADD COLUMN "metadataJson" TEXT;

CREATE TABLE "OAuthRefreshToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "oauthClientId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,

  CONSTRAINT "OAuthRefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthRefreshToken_tokenHash_key" ON "OAuthRefreshToken"("tokenHash");
CREATE INDEX "OAuthRefreshToken_agentId_expiresAt_idx" ON "OAuthRefreshToken"("agentId", "expiresAt");
CREATE INDEX "OAuthRefreshToken_oauthClientId_expiresAt_idx" ON "OAuthRefreshToken"("oauthClientId", "expiresAt");

ALTER TABLE "OAuthRefreshToken" ADD CONSTRAINT "OAuthRefreshToken_oauthClientId_fkey"
FOREIGN KEY ("oauthClientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OAuthRefreshToken" ADD CONSTRAINT "OAuthRefreshToken_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
