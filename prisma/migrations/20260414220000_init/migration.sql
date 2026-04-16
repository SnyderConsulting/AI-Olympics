-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('QUEUED', 'ACTIVE', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchResult" AS ENUM ('PLAYER_ONE', 'PLAYER_TWO', 'DRAW');

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerEmail" TEXT,
    "description" TEXT,
    "aggregateRating" DOUBLE PRECISION NOT NULL DEFAULT 1200,
    "aggregateGamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCredential" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT NOT NULL,

    CONSTRAINT "AgentCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "gameKey" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 1200,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "agentId" TEXT NOT NULL,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
    "gameKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT NOT NULL,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "gameKey" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'QUEUED',
    "result" "MatchResult",
    "rated" BOOLEAN NOT NULL DEFAULT true,
    "currentTurnAgentId" TEXT,
    "stateJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "playerOneId" TEXT NOT NULL,
    "playerTwoId" TEXT,
    "winnerAgentId" TEXT,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchMove" (
    "id" TEXT NOT NULL,
    "moveIndex" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,

    CONSTRAINT "MatchMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_slug_key" ON "Agent"("slug");

-- CreateIndex
CREATE INDEX "Agent_aggregateRating_idx" ON "Agent"("aggregateRating");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCredential_tokenHash_key" ON "AgentCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentCredential_agentId_idx" ON "AgentCredential"("agentId");

-- CreateIndex
CREATE INDEX "Rating_gameKey_rating_idx" ON "Rating"("gameKey", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_agentId_gameKey_key" ON "Rating"("agentId", "gameKey");

-- CreateIndex
CREATE INDEX "QueueEntry_gameKey_createdAt_idx" ON "QueueEntry"("gameKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_gameKey_agentId_key" ON "QueueEntry"("gameKey", "agentId");

-- CreateIndex
CREATE INDEX "Match_gameKey_createdAt_idx" ON "Match"("gameKey", "createdAt");

-- CreateIndex
CREATE INDEX "Match_status_currentTurnAgentId_idx" ON "Match"("status", "currentTurnAgentId");

-- CreateIndex
CREATE INDEX "MatchMove_agentId_createdAt_idx" ON "MatchMove"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchMove_matchId_moveIndex_key" ON "MatchMove"("matchId", "moveIndex");

-- AddForeignKey
ALTER TABLE "AgentCredential" ADD CONSTRAINT "AgentCredential_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_playerOneId_fkey" FOREIGN KEY ("playerOneId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_playerTwoId_fkey" FOREIGN KEY ("playerTwoId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_winnerAgentId_fkey" FOREIGN KEY ("winnerAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchMove" ADD CONSTRAINT "MatchMove_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchMove" ADD CONSTRAINT "MatchMove_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

