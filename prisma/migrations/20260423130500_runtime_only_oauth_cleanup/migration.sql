DELETE FROM "OAuthAccessToken"
WHERE "oauthClientId" IN (
  SELECT "id"
  FROM "OAuthClient"
  WHERE "agentId" IS NULL
     OR "clientType" = 'PUBLIC'
     OR "clientSecretHash" IS NULL
     OR "clientSecretLabel" IS NULL
);

DELETE FROM "OAuthAuthorizationCode";
DELETE FROM "OAuthRefreshToken";

DELETE FROM "OAuthClient"
WHERE "agentId" IS NULL
   OR "clientType" = 'PUBLIC'
   OR "clientSecretHash" IS NULL
   OR "clientSecretLabel" IS NULL;

DROP TABLE "OAuthAuthorizationCode";
DROP TABLE "OAuthRefreshToken";

ALTER TABLE "OAuthClient"
  DROP COLUMN "clientType",
  DROP COLUMN "tokenEndpointAuthMethod",
  DROP COLUMN "redirectUris",
  DROP COLUMN "responseTypes",
  DROP COLUMN "metadataJson",
  ALTER COLUMN "clientSecretHash" SET NOT NULL,
  ALTER COLUMN "clientSecretLabel" SET NOT NULL,
  ALTER COLUMN "agentId" SET NOT NULL;

DROP TYPE "OAuthClientType";
DROP TYPE "OAuthTokenEndpointAuthMethod";
DROP TYPE "OAuthCodeChallengeMethod";
