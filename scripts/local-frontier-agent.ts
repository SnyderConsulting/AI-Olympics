import "dotenv/config";

import { z } from "zod";

import {
  FRONTIER_MATCH_DURATION_MS,
  getFrontierOpponent,
  type FrontierAction,
  type FrontierOwner,
  type FrontierState,
} from "../src/lib/frontier";
import { chooseDominantFrontierActions } from "../src/lib/frontier-bot";
import { OAUTH_AGENT_GRANT_TYPE, OAUTH_SCOPE } from "../src/lib/oauth";

const envSchema = z.object({
  LOCAL_FRONTIER_CLIENT_ID: z.string().trim().min(1),
  LOCAL_FRONTIER_CLIENT_SECRET: z.string().trim().min(1),
  LOCAL_FRONTIER_MCP_URL: z
    .string()
    .trim()
    .url()
    .default(process.env.MCP_PUBLIC_URL ?? "http://127.0.0.1:8787/mcp"),
  LOCAL_FRONTIER_TOKEN_URL: z
    .string()
    .trim()
    .url()
    .optional(),
  LOCAL_FRONTIER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  LOCAL_FRONTIER_MAX_MATCHES: z.coerce.number().int().positive().default(1),
  LOCAL_FRONTIER_SUBMIT_BUFFER_MS: z.coerce.number().int().nonnegative().default(150),
});

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

type FrontierOrder = { type: "IDLE" } | { type: "MOVE"; x: number; y: number } | { type: "ATTACK"; targetId: string };

type FrontierStatePayload = {
  matchId: string;
  status: string;
  youAre: FrontierOwner;
  yourLabel: string;
  opponentName: string;
  opponentLabel: string;
  board: string;
  currentWindowIndex: number;
  secondsUntilNextWindow: number;
  matchSecondsRemaining: number;
  nextWindowClosesAt: string;
  income: Record<FrontierOwner, number>;
  incomePerSecond: Record<FrontierOwner, number>;
  ownedArmies: Array<{
    id: string;
    soldiers: number;
    x: number;
    y: number;
    order: FrontierOrder;
  }>;
  enemyArmies: Array<{
    id: string;
    soldiers: number;
    x: number;
    y: number;
    order: FrontierOrder;
  }>;
  sites: Array<{
    id: string;
    x: number;
    y: number;
    controller: FrontierOwner | null;
    captureOwner: FrontierOwner | null;
    captureProgressMs: number;
  }>;
  bases: Array<{
    id: string;
    owner: FrontierOwner;
    label: string;
    x: number;
    y: number;
    health: number;
    maxHealth: number;
    alive: boolean;
  }>;
  pendingSubmission: {
    windowIndex: number;
    actions: FrontierAction[];
  } | null;
  winner: FrontierOwner | "DRAW" | null;
  winnerReason: string | null;
  rules: string;
};

const env = envSchema.parse({
  LOCAL_FRONTIER_CLIENT_ID: process.env.LOCAL_FRONTIER_CLIENT_ID,
  LOCAL_FRONTIER_CLIENT_SECRET: process.env.LOCAL_FRONTIER_CLIENT_SECRET,
  LOCAL_FRONTIER_MCP_URL:
    process.env.LOCAL_FRONTIER_MCP_URL ?? process.env.MCP_PUBLIC_URL,
  LOCAL_FRONTIER_TOKEN_URL:
    process.env.LOCAL_FRONTIER_TOKEN_URL ??
    new URL(
      "/token",
      process.env.LOCAL_FRONTIER_MCP_URL ??
        process.env.MCP_PUBLIC_URL ??
        "http://127.0.0.1:8787/mcp",
    ).toString(),
  LOCAL_FRONTIER_POLL_INTERVAL_MS: process.env.LOCAL_FRONTIER_POLL_INTERVAL_MS,
  LOCAL_FRONTIER_MAX_MATCHES: process.env.LOCAL_FRONTIER_MAX_MATCHES,
  LOCAL_FRONTIER_SUBMIT_BUFFER_MS: process.env.LOCAL_FRONTIER_SUBMIT_BUFFER_MS,
});

let oauthSession:
  | {
      accessToken: string;
      expiresAt: number;
    }
  | null = null;

async function main() {
  log(`Starting local Frontier agent against ${env.LOCAL_FRONTIER_MCP_URL}.`);

  for (let matchIndex = 0; matchIndex < env.LOCAL_FRONTIER_MAX_MATCHES; matchIndex += 1) {
    const matchId = await findOrQueueFrontierMatch();
    const opening = await getFrontierState(matchId);

    log(
      `Joined frontier match ${matchId} as ${opening.yourLabel} ` +
        `against ${opening.opponentName}.`,
    );

    const summary = await playMatch(matchId);
    log(
      `Finished ${summary.matchId}: ${summary.result} ` +
        `(${summary.winnerReason ?? "no winner reason"}).`,
    );
    log(summary.board);
  }
}

async function playMatch(matchId: string) {
  let lastSubmittedWindow = -1;

  while (true) {
    const payload = await getFrontierState(matchId);

    if (payload.winner) {
      return {
        matchId,
        result: payload.winner,
        winnerReason: payload.winnerReason,
        board: payload.board,
      };
    }

    if (
      payload.pendingSubmission?.windowIndex === payload.currentWindowIndex ||
      lastSubmittedWindow === payload.currentWindowIndex
    ) {
      await sleep(Math.min(
        env.LOCAL_FRONTIER_POLL_INTERVAL_MS,
        Math.max(100, payload.secondsUntilNextWindow * 1000 + env.LOCAL_FRONTIER_SUBMIT_BUFFER_MS),
      ));
      continue;
    }

    if (payload.secondsUntilNextWindow * 1000 <= env.LOCAL_FRONTIER_SUBMIT_BUFFER_MS) {
      await sleep(env.LOCAL_FRONTIER_SUBMIT_BUFFER_MS + 50);
      continue;
    }

    const frontierState = hydrateFrontierState(payload);
    const actions = chooseDominantFrontierActions({
      state: frontierState,
      owner: payload.youAre,
    });

    if (actions.length === 0) {
      log(`Window ${payload.currentWindowIndex}: keeping current Frontier orders.`);
      lastSubmittedWindow = payload.currentWindowIndex;
      await sleep(env.LOCAL_FRONTIER_POLL_INTERVAL_MS);
      continue;
    }

    await callTool("submit_frontier_orders", {
      matchId,
      actions,
    });

    lastSubmittedWindow = payload.currentWindowIndex;
    log(
      `Window ${payload.currentWindowIndex}: ${formatActions(actions)}`,
    );
  }
}

async function findOrQueueFrontierMatch() {
  const existingMatch = await findActiveFrontierMatch();

  if (existingMatch) {
    return existingMatch.id;
  }

  const response = await callTool("join_queue", {
    gameKey: "frontier",
  });
  const immediateMatchId = extractMatchId(response.text);

  if (immediateMatchId) {
    return immediateMatchId;
  }

  while (true) {
    await sleep(env.LOCAL_FRONTIER_POLL_INTERVAL_MS);
    const queuedMatch = await findActiveFrontierMatch();

    if (queuedMatch) {
      return queuedMatch.id;
    }
  }
}

async function findActiveFrontierMatch() {
  const matches = await listMatches();
  return matches.find((match) => {
    return match.gameKey === "frontier" && match.status === "ACTIVE";
  }) ?? null;
}

async function getFrontierState(matchId: string) {
  const response = await callTool("get_frontier_state", { matchId });

  if (!response.structuredContent) {
    throw new Error("get_frontier_state did not return structured content.");
  }

  return response.structuredContent as FrontierStatePayload;
}

async function listMatches() {
  const response = await callTool("my_matches");
  const responseText = response.text;

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

  const structuredContent =
    payload && typeof payload === "object" && "structuredContent" in payload
      ? (payload.structuredContent as Record<string, unknown> | undefined)
      : undefined;
  const text = payload.content?.[0]?.text;

  if (typeof text !== "string") {
    throw new Error(`Tool ${name} did not return text content.`);
  }

  return {
    text,
    structuredContent,
  };
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
    structuredContent?: Record<string, unknown>;
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
  return fetch(env.LOCAL_FRONTIER_MCP_URL, {
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

  const response = await fetch(env.LOCAL_FRONTIER_TOKEN_URL ?? new URL("/token", env.LOCAL_FRONTIER_MCP_URL).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: OAUTH_AGENT_GRANT_TYPE,
      client_id: env.LOCAL_FRONTIER_CLIENT_ID,
      client_secret: env.LOCAL_FRONTIER_CLIENT_SECRET,
      resource: env.LOCAL_FRONTIER_MCP_URL,
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

function hydrateFrontierState(payload: FrontierStatePayload): FrontierState {
  const opponent = getFrontierOpponent(payload.youAre);
  const allArmies = payload.ownedArmies
    .map((army) => ({ ...army, owner: payload.youAre as FrontierOwner }))
    .concat(payload.enemyArmies.map((army) => ({ ...army, owner: opponent })));
  const maxArmySequence = allArmies.reduce((max, army) => {
    const suffix = Number(army.id.split("-").at(-1));
    return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
  }, 2);

  return {
    elapsedMs: Math.max(0, FRONTIER_MATCH_DURATION_MS - payload.matchSecondsRemaining * 1000),
    income: payload.income,
    bases: payload.bases.map((base) => ({ ...base })),
    sites: payload.sites.map((site) => ({ ...site })),
    armies: allArmies.map((army) => ({
      id: army.id,
      owner: army.owner,
      soldiers: army.soldiers,
      x: army.x,
      y: army.y,
      order: { ...army.order },
    })),
    pendingCommands: {
      ONE:
        payload.youAre === "ONE" && payload.pendingSubmission
          ? {
              windowIndex: payload.pendingSubmission.windowIndex,
              actions: payload.pendingSubmission.actions.map((action) => ({ ...action })),
            }
          : null,
      TWO:
        payload.youAre === "TWO" && payload.pendingSubmission
          ? {
              windowIndex: payload.pendingSubmission.windowIndex,
              actions: payload.pendingSubmission.actions.map((action) => ({ ...action })),
            }
          : null,
    },
    nextArmySequence: maxArmySequence + 1,
    winner: payload.winner,
    winnerReason:
      payload.winnerReason === "base-destroyed" ||
      payload.winnerReason === "soldier-count" ||
      payload.winnerReason === "site-control" ||
      payload.winnerReason === "draw"
        ? payload.winnerReason
        : null,
  };
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
  return text.match(/Match ready: ([a-zA-Z0-9-]+)/)?.[1] ?? null;
}

function formatActions(actions: FrontierAction[]) {
  return actions
    .map((action) => {
      if (action.type === "MOVE") {
        return `MOVE ${action.armyId} ${action.x},${action.y}`;
      }

      return `ATTACK ${action.armyId} ${action.targetId}`;
    })
    .join(" ; ");
}

function log(message: string) {
  console.log(`[frontier-agent] ${message}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(
    `[frontier-agent] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
