import express, { type Request, type Response } from "express";
import * as z from "zod/v4";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { getCheckersPlayerLabel } from "@/lib/checkers";
import { getChessPlayerLabel } from "@/lib/chess";
import { env } from "@/lib/env";
import { GAMES, GAME_KEYS } from "@/lib/games";
import { ensureOfficialAgents } from "@/lib/official-agents";
import {
  getOAuthAuthorizationEndpointUrl,
  getOAuthAuthorizationServerBaseUrl,
  getOAuthProtectedResourceMetadataUrl,
  getOAuthRegistrationEndpointUrl,
  getOAuthResourceUri,
  getOAuthTokenEndpointUrl,
  OAUTH_AGENT_GRANT_TYPE,
  OAUTH_CODE_CHALLENGE_METHOD,
  OAUTH_CONNECTOR_GRANT_TYPE,
  OAUTH_REFRESH_GRANT_TYPE,
  OAUTH_SCOPE,
} from "@/lib/oauth";
import {
  authenticateAgentOAuthClientCredentials,
  authenticateOAuthAccessToken,
  exchangeOAuthAuthorizationCode,
  exchangeOAuthClientCredentials,
  exchangeOAuthRefreshToken,
  getOAuthClientByClientId,
  getOAuthClientRegistrationMetadata,
  issueOAuthAuthorizationCodeForAgent,
  registerOAuthDynamicClient,
} from "@/lib/oauth-service";
import {
  ensureMatchTimeoutWorker,
  getCheckersMatchStateForAgent,
  getChessMatchStateForAgent,
  getFrontierMatchStateForAgent,
  getTicTacToeMatchStateForAgent,
  listMatchesForAgent,
  playCheckersTurn,
  playChessTurn,
  playTicTacToeTurn,
  queueAgentForGame,
  serializeMatchForMcp,
  submitFrontierOrdersForAgent,
  waitForTurnOrMatchEndForAgent,
} from "@/lib/matches";
import { getDisplayRating } from "@/lib/elo";
import { TIC_TAC_TOE_RULES_TEXT } from "@/lib/tic-tac-toe";

type AuthenticatedRequest = Request & {
  agent?: Awaited<ReturnType<typeof authenticateOAuthAccessToken>>;
};

void ensureOfficialAgents().catch((error) => {
  console.error("Failed to provision official agents", error);
});

ensureMatchTimeoutWorker();

const matchSummarySchema = z.object({
  id: z.string(),
  gameKey: z.enum(GAME_KEYS),
  status: z.string(),
  result: z.string().nullable(),
  currentTurnAgentId: z.string().nullable(),
  currentTurnAgentName: z.string().nullable(),
  isYourTurn: z.boolean().nullable(),
  playerOne: z.string(),
  playerTwo: z.string().nullable(),
  winner: z.string().nullable(),
  board: z.string(),
  moveCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
  turnDeadlineAt: z.string().nullable(),
  secondsRemaining: z.number().int().nullable(),
  moveTimeoutSeconds: z.number().int().positive(),
});

const joinQueueOutputSchema = {
  status: z.enum(["waiting", "matched"]),
  gameKey: z.enum(GAME_KEYS),
  match: matchSummarySchema.nullable(),
  recommendedTool: z.string().nullable(),
};

const myMatchesOutputSchema = {
  matches: z.array(matchSummarySchema),
};

const ticTacToePositionSchema = z.object({
  row: z.number().int().min(0).max(2),
  column: z.number().int().min(0).max(2),
});

const ticTacToeLegalMoveSchema = z.object({
  notation: z.string(),
  row: z.number().int().min(0).max(2),
  column: z.number().int().min(0).max(2),
  name: z.string(),
  aliases: z.array(z.string()),
});

const ticTacToeStateOutputSchema = {
  matchId: z.string(),
  gameKey: z.literal("tic-tac-toe"),
  status: z.string(),
  yourMark: z.enum(["X", "O"]),
  opponentName: z.string(),
  currentTurnAgentId: z.string().nullable(),
  currentTurnAgentName: z.string().nullable(),
  isYourTurn: z.boolean(),
  board: z.string(),
  legalMoves: z.array(ticTacToeLegalMoveSchema),
  winner: z.enum(["X", "O", "DRAW"]).nullable(),
  winnerReason: z.enum(["line", "draw", "timeout"]).nullable(),
  turnCount: z.number().int().nonnegative(),
  winningLine: z.array(ticTacToePositionSchema).nullable(),
  turnDeadlineAt: z.string().nullable(),
  secondsRemaining: z.number().int().nullable(),
  moveTimeoutSeconds: z.number().int().positive(),
  rules: z.string(),
  recommendedTool: z.enum(["play_tic_tac_toe_move", "wait_for_turn_or_match_end"]),
};

const waitForTurnOutputSchema = {
  match: matchSummarySchema,
  timedOutWaiting: z.boolean(),
};

const frontierMoveActionSchema = z.object({
  type: z.literal("MOVE"),
  armyId: z.string().trim().min(1),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(60),
});

const frontierAttackActionSchema = z.object({
  type: z.literal("ATTACK"),
  armyId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
});

const frontierActionSchema = z.union([
  frontierMoveActionSchema,
  frontierAttackActionSchema,
]);

const frontierStateOutputSchema = {
  matchId: z.string(),
  gameKey: z.literal("frontier"),
  status: z.string(),
  youAre: z.enum(["ONE", "TWO"]),
  yourLabel: z.string(),
  opponentName: z.string(),
  opponentLabel: z.string(),
  board: z.string(),
  currentWindowIndex: z.number().int().nonnegative(),
  secondsUntilNextWindow: z.number().nonnegative(),
  matchSecondsRemaining: z.number().int().nonnegative(),
  nextWindowClosesAt: z.string().nullable(),
  income: z.object({
    ONE: z.number().nonnegative(),
    TWO: z.number().nonnegative(),
  }),
  incomePerSecond: z.object({
    ONE: z.number().nonnegative(),
    TWO: z.number().nonnegative(),
  }),
  ownedArmies: z.array(
    z.object({
      id: z.string(),
      soldiers: z.number().int().positive(),
      x: z.number(),
      y: z.number(),
      order: z.object({
        type: z.string(),
      }).and(z.record(z.string(), z.unknown())),
    }),
  ),
  enemyArmies: z.array(
    z.object({
      id: z.string(),
      soldiers: z.number().int().positive(),
      x: z.number(),
      y: z.number(),
      order: z.object({
        type: z.string(),
      }).and(z.record(z.string(), z.unknown())),
    }),
  ),
  sites: z.array(
    z.object({
      id: z.string(),
      x: z.number(),
      y: z.number(),
      controller: z.enum(["ONE", "TWO"]).nullable(),
      captureOwner: z.enum(["ONE", "TWO"]).nullable(),
      captureProgressMs: z.number().int().nonnegative(),
    }),
  ),
  bases: z.array(
    z.object({
      id: z.string(),
      owner: z.enum(["ONE", "TWO"]),
      label: z.string(),
      x: z.number(),
      y: z.number(),
      health: z.number().nonnegative(),
      maxHealth: z.number().positive(),
      alive: z.boolean(),
    }),
  ),
  pendingSubmission: z.object({
    windowIndex: z.number().int().nonnegative(),
    actions: z.array(frontierActionSchema),
  }).nullable(),
  winner: z.enum(["ONE", "TWO", "DRAW"]).nullable(),
  winnerReason: z.string().nullable(),
  rules: z.string(),
  recommendedTool: z.literal("submit_frontier_orders"),
};

const frontierSubmissionOutputSchema = {
  ...frontierStateOutputSchema,
  acceptedActions: z.array(frontierActionSchema),
  submissionWindowIndex: z.number().int().nonnegative(),
};

function toStructuredToolResult(structuredContent: Record<string, unknown>, text?: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: text ?? JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

function getLegalMovesToolName(gameKey: string) {
  switch (gameKey) {
    case "tic-tac-toe":
      return "get_tic_tac_toe_legal_moves";
    case "checkers":
      return "get_checkers_legal_moves";
    case "chess":
      return "get_chess_legal_moves";
    case "frontier":
      return "get_frontier_state";
    default:
      return null;
  }
}

function serializeTicTacToeStateForTool(
  state: Awaited<ReturnType<typeof getTicTacToeMatchStateForAgent>>,
  agentId: string,
) {
  const opponentName =
    state.match.playerOneId === agentId
      ? state.match.playerTwo?.name ?? "unknown"
      : state.match.playerOne.name;

  return {
    matchId: state.match.id,
    gameKey: "tic-tac-toe" as const,
    status: state.match.status,
    yourMark: state.mark,
    opponentName,
    currentTurnAgentId: state.match.currentTurnAgentId,
    currentTurnAgentName: state.currentTurnAgentName,
    isYourTurn: state.isYourTurn,
    board: state.board,
    legalMoves: state.legalMoves.map((move) => ({
      notation: move.notation,
      row: move.row,
      column: move.column,
      name: move.name,
      aliases: move.aliases,
    })),
    winner: state.winner,
    winnerReason: state.winnerReason,
    turnCount: state.turnCount,
    winningLine: state.winningLine
      ? state.winningLine.map(([row, column]) => ({ row, column }))
      : null,
    turnDeadlineAt: state.turnDeadlineAt,
    secondsRemaining: state.secondsRemaining,
    moveTimeoutSeconds: state.moveTimeoutSeconds,
    rules: TIC_TAC_TOE_RULES_TEXT,
    recommendedTool: state.isYourTurn
      ? ("play_tic_tac_toe_move" as const)
      : ("wait_for_turn_or_match_end" as const),
  };
}

function formatTicTacToeStateText(payload: ReturnType<typeof serializeTicTacToeStateForTool>) {
  const nextStep = payload.isYourTurn
    ? "Your turn. Call play_tic_tac_toe_move with one legal move notation."
    : "Not your turn. Call wait_for_turn_or_match_end to block until your turn or match end.";

  return [
    `Match ${payload.matchId}`,
    `${payload.yourMark} vs ${payload.opponentName}`,
    payload.board,
    `Legal moves: ${payload.legalMoves.map((move) => move.notation).join(", ") || "none"}`,
    `Seconds remaining on current turn: ${payload.secondsRemaining ?? "n/a"}`,
    `Winner: ${payload.winner ?? "pending"}`,
    nextStep,
  ].join("\n");
}

function serializeFrontierStateForTool(
  state: Awaited<ReturnType<typeof getFrontierMatchStateForAgent>>,
  agentId: string,
) {
  const opponentName =
    state.match.playerOneId === agentId
      ? state.match.playerTwo?.name ?? "unknown"
      : state.match.playerOne.name;

  return {
    matchId: state.match.id,
    gameKey: "frontier" as const,
    status: state.match.status,
    youAre: state.youAre,
    yourLabel: state.yourLabel,
    opponentName,
    opponentLabel: state.opponentLabel,
    board: state.board,
    currentWindowIndex: state.currentWindowIndex,
    secondsUntilNextWindow: state.secondsUntilNextWindow,
    matchSecondsRemaining: state.matchSecondsRemaining,
    nextWindowClosesAt: state.nextWindowClosesAt,
    income: state.income,
    incomePerSecond: state.incomePerSecond,
    ownedArmies: state.ownedArmies,
    enemyArmies: state.enemyArmies,
    sites: state.sites,
    bases: state.bases,
    pendingSubmission: state.pendingSubmission,
    winner: state.winner,
    winnerReason: state.winnerReason,
    rules: state.rules,
    recommendedTool: "submit_frontier_orders" as const,
  };
}

function formatFrontierStateText(payload: ReturnType<typeof serializeFrontierStateForTool>) {
  const nextStep =
    payload.status === "ACTIVE"
      ? "If you want to change orders for the next window, call submit_frontier_orders."
      : `Winner: ${payload.winner ?? "pending"}`;

  return [
    `Match ${payload.matchId}`,
    `${payload.yourLabel} vs ${payload.opponentName} (${payload.opponentLabel})`,
    payload.board,
    `Window ${payload.currentWindowIndex} closes in ${payload.secondsUntilNextWindow}s`,
    `Match time remaining: ${payload.matchSecondsRemaining}s`,
    `Pending submission: ${payload.pendingSubmission ? "yes" : "no"}`,
    nextStep,
  ].join("\n");
}

function getServer(agent: NonNullable<AuthenticatedRequest["agent"]>) {
  const server = new McpServer(
    {
      name: "ai-olympics",
      version: "0.1.0",
      websiteUrl: "https://example.com/ai-olympics",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  server.registerTool(
    "list_games",
    {
      description: "List ranked games currently available in AI Olympics.",
    },
    async () => {
      const lines = GAMES.map((game) => {
        return `- ${game.name}: ${game.description} (${game.status})`;
      });

      return {
        content: [
          {
            type: "text",
            text: lines.join("\n"),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_profile",
    {
      description: "Return the authenticated agent profile and current ratings.",
    },
    async () => {
      const lines = [
        `${agent.name} (${agent.slug})`,
        `Aggregate ELO: ${getDisplayRating(agent.aggregateRating)}`,
        ...agent.ratings.map((rating) => {
          return `${rating.gameKey}: ${getDisplayRating(rating.rating)} (${rating.wins}-${rating.losses}-${rating.draws})`;
        }),
      ];

      return {
        content: [
          {
            type: "text",
            text: lines.join("\n"),
          },
        ],
      };
    },
  );

  server.registerTool(
    "join_queue",
    {
      description:
        "Queue the authenticated agent for a live ranked game. If a match is assigned, immediately call the game-specific legal-moves tool. To play a full live game, if it is not your turn, call wait_for_turn_or_match_end instead of manually polling.",
      inputSchema: {
        gameKey: z.enum(GAME_KEYS),
      },
      outputSchema: joinQueueOutputSchema,
    },
    async ({ gameKey }) => {
      const result = await queueAgentForGame(agent.id, gameKey);

      if (result.status === "waiting") {
        const payload = {
          status: "waiting" as const,
          gameKey,
          match: null,
          recommendedTool: null,
        };

        return toStructuredToolResult(
          payload,
          `${agent.name} is now waiting in the ${gameKey} queue.`,
        );
      }

      const recommendedTool = getLegalMovesToolName(result.match.gameKey);
      const payload = {
        status: "matched" as const,
        gameKey,
        match: serializeMatchForMcp(result.match, agent.id),
        recommendedTool,
      };

      return toStructuredToolResult(
        payload,
        `Match ready: ${result.match.id}\n` +
          `${formatMatchupLine(
            result.match.gameKey,
            result.match.playerOne.name,
            result.match.playerTwo?.name ?? "unknown",
          )}\n` +
          `${result.board}\n` +
          (recommendedTool
            ? `Next step: call ${recommendedTool}. If it is not your turn, call wait_for_turn_or_match_end.`
            : "Next step: inspect the assigned match."),
      );
    },
  );

  server.registerTool(
    "my_matches",
    {
      description:
        "List the authenticated agent's recent matches with turn state and move timer details. For active play, prefer wait_for_turn_or_match_end plus the game-specific legal-moves tool.",
      outputSchema: myMatchesOutputSchema,
    },
    async () => {
      const matches = await listMatchesForAgent(agent.id);
      const formatted = matches.map((match) => serializeMatchForMcp(match, agent.id));

      return toStructuredToolResult(
        { matches: formatted },
        formatted.length === 0 ? "No matches found." : JSON.stringify(formatted, null, 2),
      );
    },
  );

  server.registerTool(
    "wait_for_turn_or_match_end",
    {
      description:
        "Block on a live match until it becomes your turn, a real-time match advances, the match finishes, or the wait window expires. Use this instead of manual polling so you do not miss move deadlines or window updates.",
      inputSchema: {
        matchId: z.string().trim().min(1).describe("The active match to watch."),
        maxWaitSeconds: z
          .number()
          .int()
          .min(1)
          .max(120)
          .optional()
          .describe("Maximum number of seconds to wait before returning even if the match is unchanged."),
      },
      outputSchema: waitForTurnOutputSchema,
    },
    async ({ matchId, maxWaitSeconds }) => {
      const result = await waitForTurnOrMatchEndForAgent({
        agentId: agent.id,
        matchId,
        maxWaitSeconds,
      });
      const payload = {
        match: serializeMatchForMcp(result.match, agent.id),
        timedOutWaiting: result.timedOutWaiting,
      };

      return toStructuredToolResult(
        payload,
        result.timedOutWaiting
          ? `Wait window elapsed for match ${result.match.id}.`
          : `Match ${result.match.id} changed state.`,
      );
    },
  );

  server.registerTool(
    "get_tic_tac_toe_legal_moves",
    {
      description:
        "Return the current Tic Tac Toe board, legal moves, move timer, and turn state for the authenticated agent. Tic Tac Toe uses zero-based row,column notation from top-left 0,0 to bottom-right 2,2. Common square names like center and top-left are also accepted.",
      inputSchema: {
        matchId: z.string().trim().min(1).describe("The live Tic Tac Toe match to inspect."),
      },
      outputSchema: ticTacToeStateOutputSchema,
    },
    async ({ matchId }) => {
      const state = await getTicTacToeMatchStateForAgent({
        agentId: agent.id,
        matchId,
      });
      const payload = serializeTicTacToeStateForTool(state, agent.id);

      return toStructuredToolResult(payload, formatTicTacToeStateText(payload));
    },
  );

  server.registerTool(
    "get_frontier_state",
    {
      description:
        "Return the current Frontier match state, map control, armies, pending orders, and command-window timing for the authenticated agent. Frontier is real-time with 4-second order windows; orders persist until replaced.",
      inputSchema: {
        matchId: z.string().trim().min(1).describe("The live Frontier match to inspect."),
      },
      outputSchema: frontierStateOutputSchema,
    },
    async ({ matchId }) => {
      const state = await getFrontierMatchStateForAgent({
        agentId: agent.id,
        matchId,
      });
      const payload = serializeFrontierStateForTool(state, agent.id);

      return toStructuredToolResult(payload, formatFrontierStateText(payload));
    },
  );

  server.registerTool(
    "get_chess_legal_moves",
    {
      description:
        "Return the current Chess board and the legal moves for the authenticated agent if it is their turn.",
      inputSchema: {
        matchId: z.string().min(1),
      },
    },
    async ({ matchId }) => {
      const state = await getChessMatchStateForAgent({
        agentId: agent.id,
        matchId,
      });

      const payload = {
        matchId: state.match.id,
        status: state.match.status,
        pieceColor: state.pieceColor,
        pieceLabel: getChessPlayerLabel(state.pieceColor),
        isYourTurn: state.isYourTurn,
        isCheck: state.isCheck,
        fen: state.fen,
        board: state.board,
        legalMoves: state.legalMoves.map((move) => ({
          notation: move.notation,
          san: move.san,
          lan: move.lan,
          from: move.from,
          to: move.to,
          piece: move.piece,
          captured: move.captured,
          promotion: move.promotion,
          isCapture: move.isCapture,
          isPromotion: move.isPromotion,
          isEnPassant: move.isEnPassant,
          isKingsideCastle: move.isKingsideCastle,
          isQueensideCastle: move.isQueensideCastle,
        })),
        winner: state.winner,
        winnerReason: state.winnerReason,
        turnCount: state.turnCount,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_checkers_legal_moves",
    {
      description:
        "Return the current Checkers board and the legal moves for the authenticated agent if it is their turn.",
      inputSchema: {
        matchId: z.string().min(1),
      },
    },
    async ({ matchId }) => {
      const state = await getCheckersMatchStateForAgent({
        agentId: agent.id,
        matchId,
      });

      const payload = {
        matchId: state.match.id,
        status: state.match.status,
        pieceColor: state.pieceColor,
        pieceLabel: getCheckersPlayerLabel(state.pieceColor),
        isYourTurn: state.isYourTurn,
        board: state.board,
        legalMoves: state.legalMoves.map((move) => ({
          from: move.from,
          sequence: move.sequence,
          captures: move.captures,
          isCapture: move.isCapture,
          promotes: move.promotes,
          notation: move.notation,
        })),
        winner: state.winner,
        winnerReason: state.winnerReason,
        turnCount: state.turnCount,
        staleHalfmoveCount: state.staleHalfmoveCount,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "submit_frontier_orders",
    {
      description:
        "Submit the latest Frontier command bundle for the current 4-second window. Only the latest valid submission before the window closes is applied, and existing orders persist until replaced. Use structured JSON actions with either MOVE or ATTACK.",
      inputSchema: {
        matchId: z.string().trim().min(1).describe("The live Frontier match to control."),
        actions: z
          .array(frontierActionSchema)
          .min(1)
          .max(32)
          .describe("A structured list of Frontier MOVE or ATTACK actions."),
      },
      outputSchema: frontierSubmissionOutputSchema,
    },
    async ({ matchId, actions }) => {
      const result = await submitFrontierOrdersForAgent({
        agentId: agent.id,
        matchId,
        actions,
      });
      const payload = {
        ...serializeFrontierStateForTool(result, agent.id),
        acceptedActions: result.acceptedActions,
        submissionWindowIndex: result.submissionWindowIndex,
      };

      return toStructuredToolResult(
        payload,
        `Queued ${payload.acceptedActions.length} Frontier actions for window ${payload.submissionWindowIndex}.\n${formatFrontierStateText(payload)}`,
      );
    },
  );

  server.registerTool(
    "play_chess_move",
    {
      description:
        "Play one Chess move using the exact legal move notation, usually SAN such as 'e4', 'Nf3', 'O-O', or 'exd8=Q+'.",
      inputSchema: {
        matchId: z.string().min(1),
        notation: z.string().trim().min(1),
      },
    },
    async ({ matchId, notation }) => {
      const result = await playChessTurn({
        agentId: agent.id,
        matchId,
        notation,
      });

      return {
        content: [
          {
            type: "text",
            text:
              `Match ${result.match.id}\n` +
              `${result.lastMove?.notation ?? "Move recorded"}\n` +
              `${result.board}\n` +
              `Winner: ${result.winner ?? "pending"}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "play_checkers_move",
    {
      description:
        "Play one complete Checkers turn using the exact legal move notation, for example '2,1 -> 3,0' or '2,1 x 4,3'.",
      inputSchema: {
        matchId: z.string().min(1),
        notation: z.string().trim().min(1),
      },
    },
    async ({ matchId, notation }) => {
      const result = await playCheckersTurn({
        agentId: agent.id,
        matchId,
        notation,
      });

      return {
        content: [
          {
            type: "text",
            text:
              `Match ${result.match.id}\n` +
              `${result.lastMove?.notation ?? "Move recorded"}\n` +
              `${result.board}\n` +
              `Winner: ${result.winner ?? "pending"}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "play_tic_tac_toe_move",
    {
      description:
        "Play one Tic Tac Toe move. Before calling this tool, first call get_tic_tac_toe_legal_moves and use one of its legalMoves[].notation values such as '1,1'. Common square names like 'center' and 'top-left' are also accepted. To finish a full game, alternate between get_tic_tac_toe_legal_moves and wait_for_turn_or_match_end until the match is finished.",
      inputSchema: {
        matchId: z.string().trim().min(1).describe("The live Tic Tac Toe match to play in."),
        notation: z
          .string()
          .trim()
          .min(1)
          .describe("A legal Tic Tac Toe move notation from get_tic_tac_toe_legal_moves, such as '1,1' or 'center'."),
      },
      outputSchema: ticTacToeStateOutputSchema,
    },
    async ({ matchId, notation }) => {
      await playTicTacToeTurn({
        agentId: agent.id,
        matchId,
        notation,
      });
      const state = await getTicTacToeMatchStateForAgent({
        agentId: agent.id,
        matchId,
      });
      const payload = serializeTicTacToeStateForTool(state, agent.id);

      return toStructuredToolResult(payload, formatTicTacToeStateText(payload));
    },
  );

  return server;
}

function formatMatchupLine(gameKey: string, playerOneName: string, playerTwoName: string) {
  if (gameKey === "frontier") {
    return `${playerOneName} controls West, ${playerTwoName} controls East.`;
  }

  if (gameKey === "checkers") {
    return `${playerOneName} is Red, ${playerTwoName} is Black.`;
  }

  if (gameKey === "chess") {
    return `${playerOneName} is White, ${playerTwoName} is Black.`;
  }

  return `${playerOneName} is X, ${playerTwoName} is O.`;
}

const app = createMcpExpressApp({ host: env.MCP_HOST });
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const dynamicClientRegistrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(z.string().trim().url()).min(1),
  grant_types: z.array(z.string().trim()).optional(),
  response_types: z.array(z.string().trim()).optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
  scope: z.string().trim().optional(),
});

const authorizeRequestSchema = z.object({
  client_id: z.string().trim().min(1),
  redirect_uri: z.string().trim().url(),
  response_type: z.literal("code"),
  scope: z.string().trim().optional(),
  state: z.string().optional(),
  resource: z.string().trim().url().optional(),
  code_challenge: z.string().trim().min(1),
  code_challenge_method: z.literal(OAUTH_CODE_CHALLENGE_METHOD),
});

const authorizeApprovalSchema = authorizeRequestSchema.extend({
  agent_client_id: z.string().trim().min(1),
  agent_client_secret: z.string().trim().min(1),
});

type AuthorizeRequestInput = z.infer<typeof authorizeRequestSchema>;

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json({
    resource: getOAuthResourceUri(),
    authorization_servers: [getOAuthAuthorizationServerBaseUrl()],
    scopes_supported: [OAUTH_SCOPE],
  });
});

app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json({
    issuer: getOAuthAuthorizationServerBaseUrl(),
    authorization_endpoint: getOAuthAuthorizationEndpointUrl(),
    token_endpoint: getOAuthTokenEndpointUrl(),
    registration_endpoint: getOAuthRegistrationEndpointUrl(),
    grant_types_supported: [
      OAUTH_CONNECTOR_GRANT_TYPE,
      OAUTH_REFRESH_GRANT_TYPE,
      OAUTH_AGENT_GRANT_TYPE,
    ],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: [OAUTH_CODE_CHALLENGE_METHOD],
    scopes_supported: [OAUTH_SCOPE],
  });
});

app.post("/register", async (req, res) => {
  const rawBody = getObjectRecord(req.body);
  const parsed = dynamicClientRegistrationSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_client_metadata",
      error_description: parsed.error.issues[0]?.message ?? "Invalid OAuth client registration request.",
    });
    return;
  }

  try {
    const oauthClient = await registerOAuthDynamicClient({
      clientName: parsed.data.client_name,
      redirectUris: parsed.data.redirect_uris,
      grantTypes: parsed.data.grant_types,
      responseTypes: parsed.data.response_types,
      scope: parsed.data.scope,
      metadata: rawBody,
    });

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.status(201).json(getOAuthClientRegistrationMetadata(oauthClient));
  } catch (error) {
    res.status(400).json({
      error: "invalid_client_metadata",
      error_description: error instanceof Error ? error.message : "Unable to register OAuth client.",
    });
  }
});

app.get("/authorize", async (req, res) => {
  const parsed = authorizeRequestSchema.safeParse(getStringRecord(req.query));

  if (!parsed.success) {
    res.status(400).type("html").send(
      renderAuthorizePage({
        request: null,
        clientName: "Unknown client",
        error: parsed.error.issues[0]?.message ?? "Invalid OAuth authorization request.",
      }),
    );
    return;
  }

  const authorizationClient = await validateAuthorizationClient(parsed.data);

  if ("error" in authorizationClient) {
    res.status(400).type("html").send(
      renderAuthorizePage({
        request: parsed.data,
        clientName: "Unknown client",
        error: authorizationClient.error,
      }),
    );
    return;
  }

  res.type("html").send(
    renderAuthorizePage({
      request: parsed.data,
      clientName: authorizationClient.oauthClient.displayName ?? authorizationClient.oauthClient.clientId,
    }),
  );
});

app.post("/authorize", async (req, res) => {
  const parsed = authorizeApprovalSchema.safeParse(getStringRecord(req.body));

  if (!parsed.success) {
    res.status(400).type("html").send(
      renderAuthorizePage({
        request: null,
        clientName: "Unknown client",
        error: parsed.error.issues[0]?.message ?? "Invalid OAuth approval request.",
      }),
    );
    return;
  }

  const authorizationClient = await validateAuthorizationClient(parsed.data);

  if ("error" in authorizationClient) {
    res.status(400).type("html").send(
      renderAuthorizePage({
        request: parsed.data,
        clientName: "Unknown client",
        error: authorizationClient.error,
      }),
    );
    return;
  }

  const agentClient = await authenticateAgentOAuthClientCredentials({
    clientId: parsed.data.agent_client_id,
    clientSecret: parsed.data.agent_client_secret,
  });

  if (!agentClient?.agent) {
    res.status(401).type("html").send(
      renderAuthorizePage({
        request: parsed.data,
        clientName: authorizationClient.oauthClient.displayName ?? authorizationClient.oauthClient.clientId,
        error: "Invalid agent client credentials.",
      }),
    );
    return;
  }

  try {
    const authorizationCode = await issueOAuthAuthorizationCodeForAgent({
      clientId: parsed.data.client_id,
      agentId: agentClient.agent.id,
      redirectUri: parsed.data.redirect_uri,
      scope: parsed.data.scope,
      resource: parsed.data.resource,
      codeChallenge: parsed.data.code_challenge,
      codeChallengeMethod: parsed.data.code_challenge_method,
    });

    if (!authorizationCode) {
      res.status(400).type("html").send(
        renderAuthorizePage({
          request: parsed.data,
          clientName: authorizationClient.oauthClient.displayName ?? authorizationClient.oauthClient.clientId,
          error: "Unknown OAuth client.",
        }),
      );
      return;
    }

    const redirectUrl = new URL(parsed.data.redirect_uri);
    redirectUrl.searchParams.set("code", authorizationCode.authorizationCode);

    if (parsed.data.state) {
      redirectUrl.searchParams.set("state", parsed.data.state);
    }

    res.redirect(302, redirectUrl.toString());
  } catch (error) {
    res.status(400).type("html").send(
      renderAuthorizePage({
        request: parsed.data,
        clientName: authorizationClient.oauthClient.displayName ?? authorizationClient.oauthClient.clientId,
        error: error instanceof Error ? error.message : "Unable to issue authorization code.",
      }),
    );
  }
});

app.post("/token", async (req, res) => {
  const body = getTokenRequestBody(req);

  if (!body.grant_type) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "Missing grant_type.",
    });
    return;
  }

  try {
    if (body.grant_type === OAUTH_AGENT_GRANT_TYPE) {
      const clientCredentials = getConfidentialOAuthClientCredentials(req, body);

      if (!clientCredentials?.clientId || !clientCredentials.clientSecret) {
        res.status(401).json({
          error: "invalid_client",
          error_description: "Missing confidential OAuth client credentials.",
        });
        return;
      }

      const tokenResponse = await exchangeOAuthClientCredentials({
        clientId: clientCredentials.clientId,
        clientSecret: clientCredentials.clientSecret,
        resource: body.resource,
        scope: body.scope,
      });

      if (!tokenResponse) {
        res.status(401).json({
          error: "invalid_client",
          error_description: "Invalid OAuth client credentials.",
        });
        return;
      }

      res.json({
        access_token: tokenResponse.accessToken,
        token_type: tokenResponse.tokenType,
        expires_in: tokenResponse.expiresIn,
        scope: tokenResponse.scope,
        resource: getOAuthResourceUri(),
      });
      return;
    }

    if (body.grant_type === OAUTH_CONNECTOR_GRANT_TYPE) {
      if (!body.client_id) {
        res.status(401).json({
          error: "invalid_client",
          error_description: "Missing public OAuth client_id.",
        });
        return;
      }

      if (!body.code) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing authorization code.",
        });
        return;
      }

      if (!body.redirect_uri) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing redirect_uri.",
        });
        return;
      }

      if (!body.code_verifier) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing code_verifier.",
        });
        return;
      }

      const tokenResponse = await exchangeOAuthAuthorizationCode({
        clientId: body.client_id,
        code: body.code,
        redirectUri: body.redirect_uri,
        codeVerifier: body.code_verifier,
        resource: body.resource,
      });

      if (!tokenResponse) {
        res.status(401).json({
          error: "invalid_client",
          error_description: "Invalid OAuth client.",
        });
        return;
      }

      res.json({
        access_token: tokenResponse.accessToken,
        token_type: tokenResponse.tokenType,
        expires_in: tokenResponse.expiresIn,
        scope: tokenResponse.scope,
        resource: getOAuthResourceUri(),
        refresh_token: tokenResponse.refreshToken,
      });
      return;
    }

    if (body.grant_type === OAUTH_REFRESH_GRANT_TYPE) {
      if (!body.client_id) {
        res.status(401).json({
          error: "invalid_client",
          error_description: "Missing public OAuth client_id.",
        });
        return;
      }

      if (!body.refresh_token) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing refresh_token.",
        });
        return;
      }

      const tokenResponse = await exchangeOAuthRefreshToken({
        clientId: body.client_id,
        refreshToken: body.refresh_token,
        resource: body.resource,
      });

      res.json({
        access_token: tokenResponse.accessToken,
        token_type: tokenResponse.tokenType,
        expires_in: tokenResponse.expiresIn,
        scope: tokenResponse.scope,
        resource: getOAuthResourceUri(),
        refresh_token: tokenResponse.refreshToken,
      });
      return;
    }

    res.status(400).json({
      error: "unsupported_grant_type",
      error_description:
        `Supported grant types are ${OAUTH_CONNECTOR_GRANT_TYPE}, ${OAUTH_REFRESH_GRANT_TYPE}, and ${OAUTH_AGENT_GRANT_TYPE}.`,
    });
  } catch (error) {
    res.status(400).json({
      error: "invalid_request",
      error_description: error instanceof Error ? error.message : "Invalid OAuth request.",
    });
  }
});

app.post("/mcp", async (req: AuthenticatedRequest, res) => {
  const token = getBearerToken(req);

  if (!token) {
    setOAuthChallenge(res);
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Missing OAuth access token.",
      },
      id: null,
    });
    return;
  }

  const agent = await authenticateOAuthAccessToken(token);

  if (!agent) {
    setOAuthChallenge(res, "invalid_token");
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Invalid or expired OAuth access token.",
      },
      id: null,
    });
    return;
  }

  req.agent = agent;

  const server = getServer(agent);

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Failed to handle MCP request", error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    }),
  );
});

app.delete("/mcp", (_req, res) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    }),
  );
});

app.listen(env.MCP_PORT, env.MCP_HOST, () => {
  console.log(`AI Olympics MCP server listening at http://${env.MCP_HOST}:${env.MCP_PORT}/mcp`);
});

function getBearerToken(req: Request) {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

function setOAuthChallenge(res: Response, errorCode?: string) {
  const challenge = [
    'Bearer realm="ai-olympics"',
    `resource_metadata="${getOAuthProtectedResourceMetadataUrl()}"`,
    errorCode ? `error="${errorCode}"` : null,
  ]
    .filter(Boolean)
    .join(", ");

  res.setHeader("WWW-Authenticate", challenge);
}

function getTokenRequestBody(req: Request) {
  return getStringRecord(req.body);
}

function getObjectRecord(rawValue: unknown) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {} as Record<string, unknown>;
  }

  return rawValue as Record<string, unknown>;
}

function getConfidentialOAuthClientCredentials(
  req: Request,
  body: Record<string, string | undefined>,
) {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex >= 0) {
      return {
        clientId: decoded.slice(0, separatorIndex),
        clientSecret: decoded.slice(separatorIndex + 1),
      };
    }
  }

  if (body.client_id && body.client_secret) {
    return {
      clientId: body.client_id,
      clientSecret: body.client_secret,
    };
  }

  return null;
}

function getStringRecord(rawValue: unknown) {
  if (!rawValue || typeof rawValue !== "object") {
    return {} as Record<string, string | undefined>;
  }

  return Object.fromEntries(
    Object.entries(rawValue).map(([key, value]) => {
      return [key, getSingleStringValue(value)];
    }),
  );
}

function getSingleStringValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const firstString = value.find((entry): entry is string => typeof entry === "string");
    return firstString;
  }

  return undefined;
}

async function validateAuthorizationClient(request: AuthorizeRequestInput) {
  if ((request.scope ?? OAUTH_SCOPE) !== OAUTH_SCOPE) {
    return {
      error: `Unsupported scope. Use "${OAUTH_SCOPE}".`,
    };
  }

  if ((request.resource ?? getOAuthResourceUri()) !== getOAuthResourceUri()) {
    return {
      error: "Unsupported resource indicator for this MCP server.",
    };
  }

  const oauthClient = await getOAuthClientByClientId(request.client_id);

  if (!oauthClient || oauthClient.clientType !== "PUBLIC") {
    return {
      error: "Unknown OAuth client.",
    };
  }

  if (!oauthClient.grantTypes.includes(OAUTH_CONNECTOR_GRANT_TYPE)) {
    return {
      error: `OAuth client is not allowed to use ${OAUTH_CONNECTOR_GRANT_TYPE}.`,
    };
  }

  if (!oauthClient.redirectUris.includes(request.redirect_uri)) {
    return {
      error: "Redirect URI is not registered for this OAuth client.",
    };
  }

  return {
    oauthClient,
  };
}

function renderAuthorizePage(args: {
  request: (AuthorizeRequestInput & { agent_client_id?: string; agent_client_secret?: string }) | null;
  clientName: string;
  error?: string;
}) {
  const hiddenFields = args.request
    ? [
        hiddenField("client_id", args.request.client_id),
        hiddenField("redirect_uri", args.request.redirect_uri),
        hiddenField("response_type", args.request.response_type),
        hiddenField("scope", args.request.scope ?? OAUTH_SCOPE),
        hiddenField("state", args.request.state ?? ""),
        hiddenField("resource", args.request.resource ?? getOAuthResourceUri()),
        hiddenField("code_challenge", args.request.code_challenge),
        hiddenField("code_challenge_method", args.request.code_challenge_method),
      ].join("\n")
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize AI Olympics</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f4efe6; color: #1f1a17; margin: 0; }
    main { max-width: 720px; margin: 48px auto; padding: 0 20px; }
    .card { background: #fffaf3; border: 1px solid #d8cfc2; border-radius: 18px; padding: 28px; box-shadow: 0 20px 40px rgba(65, 47, 31, 0.08); }
    h1 { margin: 0 0 12px; font-size: 2rem; line-height: 1.1; }
    p { line-height: 1.55; }
    .muted { color: #5e544a; }
    .meta { background: #f1e6d8; border-radius: 12px; padding: 14px; margin: 18px 0; word-break: break-word; }
    .error { background: #f7d9d4; color: #6b1d12; border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; }
    label { display: block; margin: 14px 0; font-weight: 600; }
    input { width: 100%; box-sizing: border-box; margin-top: 8px; padding: 12px 14px; border: 1px solid #c9bcab; border-radius: 12px; font: inherit; background: #fff; }
    button { margin-top: 18px; padding: 12px 18px; border: 0; border-radius: 999px; background: #9f3b28; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
    code { font-family: ui-monospace, SFMono-Regular, monospace; }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <h1>Authorize ${escapeHtml(args.clientName)}</h1>
      <p class="muted">Approve ChatGPT to act as one of your AI Olympics agents. Use the direct runtime client ID and secret that were issued when you registered the agent.</p>
      <div class="meta">
        <div><strong>Client:</strong> <code>${escapeHtml(args.clientName)}</code></div>
        <div><strong>Resource:</strong> <code>${escapeHtml(args.request?.resource ?? getOAuthResourceUri())}</code></div>
        <div><strong>Scope:</strong> <code>${escapeHtml(args.request?.scope ?? OAUTH_SCOPE)}</code></div>
      </div>
      ${args.error ? `<div class="error">${escapeHtml(args.error)}</div>` : ""}
      <form method="post" action="/authorize">
        ${hiddenFields}
        <label>
          Agent Client ID
          <input name="agent_client_id" autocomplete="username" required value="${escapeHtml(args.request?.agent_client_id ?? "")}" />
        </label>
        <label>
          Agent Client Secret
          <input name="agent_client_secret" type="password" autocomplete="current-password" required value="" />
        </label>
        <button type="submit">Authorize ChatGPT</button>
      </form>
    </section>
  </main>
</body>
</html>`;
}

function hiddenField(name: string, value: string) {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
