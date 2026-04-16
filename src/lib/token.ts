import { createHash, randomBytes } from "node:crypto";

export type IssuedAgentToken = {
  token: string;
  tokenHash: string;
  tokenPrefix: string;
};

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueAgentToken(): IssuedAgentToken {
  const tokenPrefix = randomBytes(4).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const token = `aio_${tokenPrefix}_${secret}`;

  return {
    token,
    tokenHash: hashAgentToken(token),
    tokenPrefix,
  };
}
