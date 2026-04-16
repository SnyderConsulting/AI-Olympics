import type { Request } from "express";
import * as z from "zod/v4";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { authenticateAgentToken } from "@/lib/agents";
import { getCheckersPlayerLabel } from "@/lib/checkers";
import { env } from "@/lib/env";
import { GAMES, GAME_KEYS } from "@/lib/games";
import { ensureOfficialAgents } from "@/lib/official-agents";
import {
  ensureMatchTimeoutWorker,
  getCheckersMatchStateForAgent,
  listMatchesForAgent,
  playCheckersTurn,
  playTicTacToeTurn,
  queueAgentForGame,
  serializeMatchForMcp,
} from "@/lib/matches";
import { getDisplayRating } from "@/lib/rating";

type AuthenticatedRequest = Request & {
  agent?: Awaited<ReturnType<typeof authenticateAgentToken>>;
};

void ensureOfficialAgents().catch((error) => {
  console.error("Failed to provision official agents", error);
});

ensureMatchTimeoutWorker();

const checkersPositionSchema = z.object({
  row: z.number().int().min(0).max(7),
  column: z.number().int().min(0).max(7),
});

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
      description: "Queue the authenticated agent for a live ranked game.",
      inputSchema: {
        gameKey: z.enum(GAME_KEYS),
      },
    },
    async ({ gameKey }) => {
      const result = await queueAgentForGame(agent.id, gameKey);

      if (result.status === "waiting") {
        return {
          content: [
            {
              type: "text",
              text: `${agent.name} is now waiting in the ${gameKey} queue.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text:
              `Match ready: ${result.match.id}\n` +
              `${formatMatchupLine(
                result.match.gameKey,
                result.match.playerOne.name,
                result.match.playerTwo?.name ?? "unknown",
              )}\n` +
              `${result.board}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "my_matches",
    {
      description: "List the authenticated agent's recent matches.",
    },
    async () => {
      const matches = await listMatchesForAgent(agent.id);
      const formatted = matches.map(serializeMatchForMcp);

      return {
        content: [
          {
            type: "text",
            text: formatted.length === 0 ? "No matches found." : JSON.stringify(formatted, null, 2),
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
    "play_checkers_move",
    {
      description:
        "Play one complete Checkers turn using a starting square and one or more landing squares.",
      inputSchema: {
        matchId: z.string().min(1),
        fromRow: z.number().int().min(0).max(7),
        fromColumn: z.number().int().min(0).max(7),
        sequence: z.array(checkersPositionSchema).min(1),
      },
    },
    async ({ matchId, fromRow, fromColumn, sequence }) => {
      const result = await playCheckersTurn({
        agentId: agent.id,
        matchId,
        fromRow,
        fromColumn,
        sequence,
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
      description: "Play a single Tic Tac Toe move for an active match.",
      inputSchema: {
        matchId: z.string().min(1),
        row: z.number().int().min(0).max(2),
        column: z.number().int().min(0).max(2),
      },
    },
    async ({ matchId, row, column }) => {
      const result = await playTicTacToeTurn({
        agentId: agent.id,
        matchId,
        row,
        column,
      });

      return {
        content: [
          {
            type: "text",
            text:
              `Match ${result.match.id}\n` +
              `${result.board}\n` +
              `Winner: ${result.winner ?? "pending"}`,
          },
        ],
      };
    },
  );

  return server;
}

function formatMatchupLine(gameKey: string, playerOneName: string, playerTwoName: string) {
  if (gameKey === "checkers") {
    return `${playerOneName} is Red, ${playerTwoName} is Black.`;
  }

  return `${playerOneName} is X, ${playerTwoName} is O.`;
}

const app = createMcpExpressApp({ host: env.MCP_HOST });

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.post("/mcp", async (req: AuthenticatedRequest, res) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Missing bearer token.",
      },
      id: null,
    });
    return;
  }

  const agent = await authenticateAgentToken(token);

  if (!agent) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Invalid bearer token.",
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
