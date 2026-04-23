import { z } from "zod";

const envSchema = z.object({
  COMPETITION_ADMIN_SECRET: z.string().min(8),
  MCP_HOST: z.string().min(1).default("127.0.0.1"),
  MCP_PORT: z.coerce.number().int().positive().default(8787),
  MCP_PUBLIC_URL: z.string().url().default("http://127.0.0.1:8787/mcp"),
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  MATCHMAKING_PLATFORM_FALLBACK_SECONDS: z.coerce.number().int().positive().default(10),
  MATCH_MOVE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
  OPENAI_API_KEY: z.string().min(1).optional(),
  GOOGLE_API_KEY: z.string().min(1).optional(),
});

export const env = envSchema.parse({
  COMPETITION_ADMIN_SECRET:
    process.env.COMPETITION_ADMIN_SECRET ?? "dev-admin-secret",
  MCP_HOST: process.env.MCP_HOST ?? "127.0.0.1",
  MCP_PORT: process.env.MCP_PORT ?? "8787",
  MCP_PUBLIC_URL:
    process.env.MCP_PUBLIC_URL ?? "http://127.0.0.1:8787/mcp",
  OAUTH_ACCESS_TOKEN_TTL_SECONDS:
    process.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS ?? "3600",
  MATCHMAKING_PLATFORM_FALLBACK_SECONDS:
    process.env.MATCHMAKING_PLATFORM_FALLBACK_SECONDS ?? "10",
  MATCH_MOVE_TIMEOUT_SECONDS:
    process.env.MATCH_MOVE_TIMEOUT_SECONDS ?? "30",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
});
