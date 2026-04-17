import "dotenv/config";

import { z } from "zod";

import { OAUTH_AGENT_GRANT_TYPE, OAUTH_SCOPE } from "../src/lib/oauth";
import { requestStockfishBestmove, resolveStockfishMoveNotation } from "../src/lib/stockfish";

const envSchema = z.object({
  LOCAL_STOCKFISH_CLIENT_ID: z.string().trim().min(1),
  LOCAL_STOCKFISH_CLIENT_SECRET: z.string().trim().min(1),
  LOCAL_STOCKFISH_MCP_URL: z
    .string()
    .trim()
    .url()
    .default(process.env.MCP_PUBLIC_URL ?? "http://127.0.0.1:8787/mcp"),
  LOCAL_STOCKFISH_TOKEN_URL: z
    .string()
    .trim()
    .url()
    .optional(),
  LOCAL_STOCKFISH_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  LOCAL_STOCKFISH_MAX_MATCHES: z.coerce.number().int().positive().default(1),
  STOCKFISH_PATH: z.string().trim().min(1).default("stockfish"),
  STOCKFISH_MOVETIME_MS: z.coerce.number().int().positive().default(250),
  STOCKFISH_THREADS: z.coerce.number().int().positive().default(1),
  STOCKFISH_HASH_MB: z.coerce.number().int().positive().default(16),
});

type ChessStatePayload = {
  matchId: string;
  status: string;
  pieceColor: "WHITE" | "BLACK";
  pieceLabel: string;
  isYourTurn: boolean;
  isCheck: boolean;
  fen: string;
  board: string;
  legalMoves: Array<{
    notation: string;
    san: string;
    lan: string;
    from: string;
    to: string;
    piece: string;
    captured: string | null;
    promotion: string | null;
    isCapture: boolean;
    isPromotion: boolean;
    isEnPassant: boolean;
    isKingsideCastle: boolean;
    isQueensideCastle: boolean;
  }>;
  winner: "WHITE" | "BLACK" | "DRAW" | null;
  winnerReason: string | null;
  turnCount: number;
};

type MatchSummary = {
  id: string;
  gameKey: string;
  status: string;
  result: string | null;
  currentTurnAgentId: string | null;
  playerOne: string;
  playerTwo: string | null;
  winner: string | null;
  board: string;
  moveCount: number;
  updatedAt: string;
};

const env = envSchema.parse({
  LOCAL_STOCKFISH_CLIENT_ID: process.env.LOCAL_STOCKFISH_CLIENT_ID,
  LOCAL_STOCKFISH_CLIENT_SECRET: process.env.LOCAL_STOCKFISH_CLIENT_SECRET,
  LOCAL_STOCKFISH_MCP_URL:
    process.env.LOCAL_STOCKFISH_MCP_URL ?? process.env.MCP_PUBLIC_URL,
  LOCAL_STOCKFISH_TOKEN_URL:
    process.env.LOCAL_STOCKFISH_TOKEN_URL ??
    new URL(
      "/token",
      process.env.LOCAL_STOCKFISH_MCP_URL ??
        process.env.MCP_PUBLIC_URL ??
        "http://127.0.0.1:8787/mcp",
    ).toString(),
  LOCAL_STOCKFISH_POLL_INTERVAL_MS: process.env.LOCAL_STOCKFISH_POLL_INTERVAL_MS,
  LOCAL_STOCKFISH_MAX_MATCHES: process.env.LOCAL_STOCKFISH_MAX_MATCHES,
  STOCKFISH_PATH: process.env.STOCKFISH_PATH,
  STOCKFISH_MOVETIME_MS: process.env.STOCKFISH_MOVETIME_MS,
  STOCKFISH_THREADS: process.env.STOCKFISH_THREADS,
  STOCKFISH_HASH_MB: process.env.STOCKFISH_HASH_MB,
});

let oauthSession:
  | {
      accessToken: string;
      expiresAt: number;
    }
  | null = null;

async function main() {
  log(
    `Starting local Stockfish agent against ${env.LOCAL_STOCKFISH_MCP_URL} ` +
      `with binary ${env.STOCKFISH_PATH}.`,
  );

  for (let matchIndex = 0; matchIndex < env.LOCAL_STOCKFISH_MAX_MATCHES; matchIndex += 1) {
    const matchId = await findOrQueueChessMatch();
    const state = await getChessState(matchId);

    log(
      `Joined chess match ${matchId} as ${state.pieceLabel}. ` +
        `${state.isYourTurn ? "Our move first." : "Waiting for opponent."}`,
    );

    const summary = await playMatch(matchId);
    log(
      `Finished ${summary.matchId}: ${summary.result} ` +
        `(${summary.winnerReason ?? "no winner reason"}) after ${summary.turnCount} plies.`,
    );
    log(summary.board);
  }
}

async function playMatch(matchId: string) {
  while (true) {
    const state = await getChessState(matchId);

    if (state.winner) {
      return {
        matchId,
        result: state.winner,
        winnerReason: state.winnerReason,
        turnCount: state.turnCount,
        board: state.board,
      };
    }

    if (!state.isYourTurn) {
      await sleep(env.LOCAL_STOCKFISH_POLL_INTERVAL_MS);
      continue;
    }

    const bestmove = await requestStockfishBestmove({
      binaryPath: env.STOCKFISH_PATH,
      fen: state.fen,
      movetimeMs: env.STOCKFISH_MOVETIME_MS,
      threads: env.STOCKFISH_THREADS,
      hashMb: env.STOCKFISH_HASH_MB,
    });
    const notation = resolveStockfishMoveNotation(bestmove, state.legalMoves);

    await callTool("play_chess_move", {
      matchId,
      notation,
    });

    log(`Played ${notation} from Stockfish bestmove ${bestmove}.`);
  }
}

async function findOrQueueChessMatch() {
  const existingMatch = await findActiveChessMatch();

  if (existingMatch) {
    return existingMatch.id;
  }

  const responseText = await callTool("join_queue", {
    gameKey: "chess",
  });
  const immediateMatchId = extractMatchId(responseText);

  if (immediateMatchId) {
    return immediateMatchId;
  }

  while (true) {
    await sleep(env.LOCAL_STOCKFISH_POLL_INTERVAL_MS);
    const queuedMatch = await findActiveChessMatch();

    if (queuedMatch) {
      return queuedMatch.id;
    }
  }
}

async function findActiveChessMatch() {
  const matches = await listMatches();
  return matches.find((match) => {
    return match.gameKey === "chess" && match.status === "ACTIVE";
  }) ?? null;
}

async function getChessState(matchId: string) {
  const responseText = await callTool("get_chess_legal_moves", { matchId });
  return JSON.parse(responseText) as ChessStatePayload;
}

async function listMatches() {
  const responseText = await callTool("my_matches");

  if (!responseText || responseText === "No matches found.") {
    return [] as MatchSummary[];
  }

  return JSON.parse(responseText) as MatchSummary[];
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const payload = await mcp("tools/call", {
    name,
    arguments: args,
  });

  const text = payload.content?.[0]?.text;

  if (typeof text !== "string") {
    throw new Error(`Tool ${name} did not return text content.`);
  }

  return text;
}

async function mcp(method: string, params: Record<string, unknown>) {
  let response = await performMcpRequest(await getAccessToken(), method, params);

  if (response.status === 401) {
    oauthSession = null;
    response = await performMcpRequest(await getAccessToken(true), method, params);
  }

  const raw = await response.text();
  const payload = parseMcpResponse(raw);

  if (payload.error) {
    throw new Error(`${payload.error.code}: ${payload.error.message}`);
  }

  if (!response.ok) {
    throw new Error(`MCP ${method} failed with HTTP ${response.status}.`);
  }

  return payload.result as {
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  };
}

async function performMcpRequest(
  accessToken: string,
  method: string,
  params: Record<string, unknown>,
) {
  return fetch(env.LOCAL_STOCKFISH_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });
}

async function getAccessToken(forceRefresh = false) {
  const refreshSkewMs = 30_000;

  if (!forceRefresh && oauthSession && oauthSession.expiresAt - refreshSkewMs > Date.now()) {
    return oauthSession.accessToken;
  }

  const response = await fetch(env.LOCAL_STOCKFISH_TOKEN_URL ?? new URL("/token", env.LOCAL_STOCKFISH_MCP_URL).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: OAUTH_AGENT_GRANT_TYPE,
      client_id: env.LOCAL_STOCKFISH_CLIENT_ID,
      client_secret: env.LOCAL_STOCKFISH_CLIENT_SECRET,
      resource: env.LOCAL_STOCKFISH_MCP_URL,
      scope: OAUTH_SCOPE,
    }),
  });

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token || !payload.expires_in) {
    throw new Error(
      payload.error_description ??
        payload.error ??
        `OAuth token request failed with HTTP ${response.status}.`,
    );
  }

  oauthSession = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };

  return oauthSession.accessToken;
}

function parseMcpResponse(raw: string) {
  const trimmed = raw.trim();

  if (!trimmed) {
    throw new Error("Empty MCP response.");
  }

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as {
      result?: unknown;
      error?: {
        code: number;
        message: string;
      };
    };
  }

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6));

  if (dataLines.length === 0) {
    throw new Error(`Unparseable MCP response: ${raw}`);
  }

  return JSON.parse(dataLines[dataLines.length - 1]) as {
    result?: unknown;
    error?: {
      code: number;
      message: string;
    };
  };
}

function extractMatchId(text: string) {
  return text.match(/Match ready: (\w+)/)?.[1] ?? null;
}

function log(message: string) {
  console.log(`[stockfish-agent] ${message}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(
    `[stockfish-agent] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
