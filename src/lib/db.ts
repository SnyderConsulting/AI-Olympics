import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var prisma: PrismaClient | undefined;
  var pgPool: Pool | undefined;
  var prismaAdapter: PrismaPg | undefined;
}

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/ai_olympics?schema=public";
const useSsl = process.env.DATABASE_SSL === "true";
const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: databaseUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
const adapter = globalThis.prismaAdapter ?? new PrismaPg(pool);

export const db = globalThis.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = db;
  globalThis.pgPool = pool;
  globalThis.prismaAdapter = adapter;
}
