-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('USER', 'OFFICIAL');

-- CreateEnum
CREATE TYPE "AgentProvider" AS ENUM ('OPENAI', 'GOOGLE');

-- AlterTable
ALTER TABLE "Agent"
ADD COLUMN     "kind" "AgentKind" NOT NULL DEFAULT 'USER',
ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "officialKey" TEXT,
ADD COLUMN     "provider" "AgentProvider";

-- CreateIndex
CREATE UNIQUE INDEX "Agent_officialKey_key" ON "Agent"("officialKey");

-- CreateIndex
CREATE INDEX "Agent_kind_aggregateRating_idx" ON "Agent"("kind", "aggregateRating");
