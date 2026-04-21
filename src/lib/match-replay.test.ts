import { AgentKind, MatchResult, MatchStatus } from "@/generated/prisma/enums";

import { buildMatchReplay, type ReplayableMatch } from "@/lib/match-replay";
import {
  applyTicTacToeForfeit,
  applyTicTacToeMove,
  createInitialTicTacToeState,
  serializeTicTacToeState,
} from "@/lib/tic-tac-toe";
import { describe, expect, it } from "vitest";

const playerOne = {
  id: "agent-one",
  slug: "agent-one",
  name: "Agent One",
  kind: AgentKind.USER,
  provider: null,
  modelId: null,
  officialKey: null,
  ownerName: "Owner One",
  ownerEmail: null,
  description: null,
  aggregateRating: 1200,
  aggregateGamesPlayed: 0,
  createdAt: new Date("2026-04-21T12:00:00.000Z"),
  updatedAt: new Date("2026-04-21T12:00:00.000Z"),
};

const playerTwo = {
  id: "agent-two",
  slug: "agent-two",
  name: "Agent Two",
  kind: AgentKind.USER,
  provider: null,
  modelId: null,
  officialKey: null,
  ownerName: "Owner Two",
  ownerEmail: null,
  description: null,
  aggregateRating: 1200,
  aggregateGamesPlayed: 0,
  createdAt: new Date("2026-04-21T12:00:00.000Z"),
  updatedAt: new Date("2026-04-21T12:00:00.000Z"),
};

describe("buildMatchReplay", () => {
  it("reconstructs tic tac toe boards from stored moves", () => {
    const stateAfterOne = applyTicTacToeMove(createInitialTicTacToeState(), 0, 0, "X");
    const finalState = applyTicTacToeMove(stateAfterOne, 1, 1, "O");

    const replay = buildMatchReplay(
      createReplayableMatch({
        stateJson: serializeTicTacToeState(finalState),
        moves: [
          createMove(0, playerOne.id, {
            notation: "0,0",
            row: 0,
            column: 0,
            mark: "X",
          }),
          createMove(1, playerTwo.id, {
            notation: "1,1",
            row: 1,
            column: 1,
            mark: "O",
          }),
        ],
      }),
    );

    expect(replay.unavailableReason).toBeNull();
    expect(replay.frames).toHaveLength(3);
    expect(replay.frames[1]?.headline).toContain("Agent One played 0,0");
    expect(replay.frames[2]?.board).toBe("  0 1 2\n0 X . .\n1 . O .\n2 . . .");
  });

  it("adds a terminal timeout frame when the game ended without a final move", () => {
    const stateAfterOne = applyTicTacToeMove(createInitialTicTacToeState(), 1, 1, "X");
    const finalState = applyTicTacToeForfeit(stateAfterOne, "X");

    const replay = buildMatchReplay(
      createReplayableMatch({
        result: MatchResult.PLAYER_ONE,
        stateJson: serializeTicTacToeState(finalState),
        winner: playerOne,
        winnerAgentId: playerOne.id,
        moves: [
          createMove(0, playerOne.id, {
            notation: "1,1",
            row: 1,
            column: 1,
            mark: "X",
          }),
        ],
      }),
    );

    expect(replay.frames).toHaveLength(3);
    expect(replay.frames[2]?.isTerminal).toBe(true);
    expect(replay.frames[2]?.headline).toContain("timeout");
  });
});

function createReplayableMatch(
  overrides: Partial<ReplayableMatch>,
): ReplayableMatch {
  return {
    id: "match-one",
    gameKey: "tic-tac-toe",
    status: MatchStatus.FINISHED,
    result: MatchResult.DRAW,
    rated: true,
    currentTurnAgentId: null,
    stateJson: serializeTicTacToeState(createInitialTicTacToeState()),
    createdAt: new Date("2026-04-21T12:00:00.000Z"),
    updatedAt: new Date("2026-04-21T12:05:00.000Z"),
    startedAt: new Date("2026-04-21T12:00:00.000Z"),
    finishedAt: new Date("2026-04-21T12:05:00.000Z"),
    playerOneId: playerOne.id,
    playerTwoId: playerTwo.id,
    winnerAgentId: null,
    playerOne,
    playerTwo,
    winner: null,
    moves: [],
    ...overrides,
  };
}

function createMove(moveIndex: number, agentId: string, payload: Record<string, unknown>) {
  return {
    id: `move-${moveIndex}`,
    moveIndex,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date(`2026-04-21T12:0${moveIndex}:00.000Z`),
    matchId: "match-one",
    agentId,
  };
}
