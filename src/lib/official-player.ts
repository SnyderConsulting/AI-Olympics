import { AgentProvider } from "@/generated/prisma/enums";

import {
  getCheckersPlayerLabel,
  parseCheckersMoveNotation,
  type CheckersMove,
  type CheckersPlayerColor,
} from "@/lib/checkers";
import {
  getChessPlayerLabel,
  parseChessMoveNotation,
  type ChessMove,
  type ChessPlayerColor,
  type ChessState,
} from "@/lib/chess";
import { env } from "@/lib/env";
import {
  FRONTIER_COMMAND_WINDOW_MS,
  FRONTIER_MAP_HEIGHT,
  FRONTIER_MAP_WIDTH,
  FRONTIER_RULES_TEXT,
  getFrontierOpponent,
  getFrontierOwnerLabel,
  type FrontierAction,
  type FrontierOwner,
  type FrontierState,
} from "@/lib/frontier";
import { parseStructuredMoveNotation } from "@/lib/move-notation";
import {
  parseTicTacToeMoveNotation,
  type TicTacToeMark,
  type TicTacToeMove,
} from "@/lib/tic-tac-toe";

const REQUEST_TIMEOUT_MS = env.MATCH_MOVE_TIMEOUT_SECONDS * 1000;
const MAX_MOVE_OUTPUT_TOKENS = 256;
const MAX_FRONTIER_OUTPUT_TOKENS = 768;
const MAX_PROVIDER_RETRIES = 2;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const FRONTIER_REQUEST_TIMEOUT_MS = Math.max(
  1_000,
  Math.min(REQUEST_TIMEOUT_MS, FRONTIER_COMMAND_WINDOW_MS - 500),
);

type OpenAiReasoningEffort = "minimal" | "low";

export async function chooseOfficialTicTacToeMove(args: {
  provider: AgentProvider;
  modelId: string;
  board: string;
  legalMoves: TicTacToeMove[];
  mark: TicTacToeMark;
}) {
  const notation = await chooseMoveNotation({
    provider: args.provider,
    modelId: args.modelId,
    systemPrompt:
      `Play Tic Tac Toe as ${args.mark}. You are on a 3x3 board and must make three in a row horizontally, vertically, or diagonally before the opponent does. ` +
      "Return only a JSON object matching the provided schema with a single legal move notation.",
    userPrompt:
      `Board:\n${compactPromptBoard(args.board)}\n\n` +
      `Legal moves:\n${formatLegalMoveNotations(args.legalMoves)}`,
    legalMoveNotations: args.legalMoves.map((move) => move.notation),
  });

  return parseTicTacToeMoveNotation(notation, args.legalMoves);
}

export async function chooseOfficialCheckersMove(args: {
  provider: AgentProvider;
  modelId: string;
  board: string;
  legalMoves: CheckersMove[];
  color: CheckersPlayerColor;
}) {
  const label = getCheckersPlayerLabel(args.color);
  const notation = await chooseMoveNotation({
    provider: args.provider,
    modelId: args.modelId,
    systemPrompt:
      `Play Checkers as ${label}. ` +
      "Return only a JSON object matching the provided schema with a single legal move notation.",
    userPrompt:
      `Board:\n${compactPromptBoard(args.board)}\n\n` +
      `Legal moves:\n${formatLegalMoveNotations(args.legalMoves)}`,
    legalMoveNotations: args.legalMoves.map((move) => move.notation),
  });

  return parseCheckersMoveNotation(notation, args.legalMoves);
}

export async function chooseOfficialChessMove(args: {
  provider: AgentProvider;
  modelId: string;
  board: string;
  legalMoves: ChessMove[];
  color: ChessPlayerColor;
  state: ChessState;
}) {
  const label = getChessPlayerLabel(args.color);
  const notation = await chooseMoveNotation({
    provider: args.provider,
    modelId: args.modelId,
    systemPrompt:
      `Play Chess as ${label}. ` +
      "Return only a JSON object matching the provided schema with a single legal move notation.",
    userPrompt:
      `Board:\n${compactPromptBoard(args.board)}\n\n` +
      `Legal moves:\n${formatLegalMoveNotations(args.legalMoves)}`,
    legalMoveNotations: args.legalMoves.map((move) => move.notation),
  });

  return parseChessMoveNotation(notation, args.legalMoves, args.state);
}

export async function chooseOfficialFrontierActions(args: {
  provider: AgentProvider;
  modelId: string;
  state: FrontierState;
  owner: FrontierOwner;
  board: string;
  currentWindowIndex: number;
  secondsUntilNextWindow: number;
  matchSecondsRemaining: number;
}) {
  const ownedArmies = args.state.armies.filter((army) => army.owner === args.owner);

  if (ownedArmies.length === 0) {
    return [];
  }

  const opponent = getFrontierOpponent(args.owner);
  const enemyBase = args.state.bases.find((base) => base.owner === opponent && base.alive);
  const attackTargetIds = [
    ...args.state.armies
      .filter((army) => army.owner === opponent)
      .map((army) => army.id),
    ...args.state.sites.map((site) => site.id),
    ...(enemyBase ? [enemyBase.id] : []),
  ];
  const systemPrompt =
    `Play Frontier as ${getFrontierOwnerLabel(args.owner)}. ` +
    "Decide your own strategy from the live state. " +
    "Return only a JSON object matching the provided schema. " +
    "You may return zero or more actions, but at most one action per owned army. " +
    "Omitted armies keep their current order. " +
    "For MOVE actions, set targetId to null. For ATTACK actions, set x and y to null. " +
    "If your armies are idle and the match is active, usually issue at least one action instead of returning an empty bundle. " +
    `Rules: ${FRONTIER_RULES_TEXT}`;
  const ownedArmyIds = ownedArmies.map((army) => army.id);
  const requestActions = async (userPrompt: string) => {
    const raw =
      args.provider === AgentProvider.OPENAI
        ? await requestOpenAiFrontierActions({
            modelId: args.modelId,
            systemPrompt,
            userPrompt,
            ownedArmyIds,
            attackTargetIds,
          })
        : await requestGoogleFrontierActions({
            modelId: args.modelId,
            systemPrompt,
            userPrompt,
            ownedArmyIds,
            attackTargetIds,
          });

    return parseFrontierActionsResponse(raw, {
      ownedArmyIds,
      attackTargetIds,
    });
  };

  const firstAttempt = await requestActions(buildFrontierUserPrompt(args));

  if (
    firstAttempt.length === 0 &&
    args.state.winner === null &&
    ownedArmies.some((army) => army.order.type === "IDLE")
  ) {
    return requestActions(
      `${buildFrontierUserPrompt(args)}\n\n` +
      "Your prior draft returned no actions while at least one of your armies is idle. " +
      "Submit at least one valid action now unless every army should deliberately continue its exact current order.",
    );
  }

  return firstAttempt;
}

export function getOpenAiReasoningEffort(modelId: string): OpenAiReasoningEffort | null {
  if (modelId === "o3" || modelId === "o4-mini") {
    return "low";
  }

  if (modelId === "gpt-5.5") {
    return "low";
  }

  if (
    modelId === "gpt-5" ||
    modelId === "gpt-5-mini" ||
    modelId === "gpt-5-nano"
  ) {
    return "minimal";
  }

  return null;
}

async function chooseMoveNotation(args: {
  provider: AgentProvider;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  legalMoveNotations: string[];
}) {
  if (args.legalMoveNotations.length === 0) {
    throw new Error("Cannot choose a move when there are no legal moves.");
  }

  const raw =
    args.provider === AgentProvider.OPENAI
      ? await requestOpenAiMoveNotation(args)
      : await requestGoogleMoveNotation(args);

  return parseStructuredMoveNotation(
    raw,
    args.legalMoveNotations.map((notation) => ({ notation })),
  ).notation;
}

async function requestOpenAiMoveNotation(args: {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  legalMoveNotations: string[];
}) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  for (let attempt = 0; attempt <= MAX_PROVIDER_RETRIES; attempt += 1) {
    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: args.modelId,
        instructions: args.systemPrompt,
        input: args.userPrompt,
        max_output_tokens: MAX_MOVE_OUTPUT_TOKENS,
        text: {
          format: {
            type: "json_schema",
            name: "move_selection",
            strict: true,
            schema: createOpenAiMoveSelectionSchema(args.legalMoveNotations),
          },
        },
        ...(getOpenAiReasoningEffort(args.modelId)
          ? {
              reasoning: {
                effort: getOpenAiReasoningEffort(args.modelId),
              },
            }
          : {}),
      }),
    });

    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{
        type?: string;
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      }>;
      error?: {
        message?: string;
      };
    };

    if (!response.ok) {
      if (attempt < MAX_PROVIDER_RETRIES && RETRYABLE_STATUS_CODES.has(response.status)) {
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      throw new Error(
        payload.error?.message ?? `OpenAI request failed with ${response.status}.`,
      );
    }

    return extractOpenAiText(payload);
  }

  throw new Error(`OpenAI request retries exhausted for ${args.modelId}.`);
}

async function requestOpenAiFrontierActions(args: {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  ownedArmyIds: string[];
  attackTargetIds: string[];
}) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  for (let attempt = 0; attempt <= MAX_PROVIDER_RETRIES; attempt += 1) {
    const response = await fetchWithTimeout(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: args.modelId,
          instructions: args.systemPrompt,
          input: args.userPrompt,
          max_output_tokens: MAX_FRONTIER_OUTPUT_TOKENS,
          text: {
            format: {
              type: "json_schema",
              name: "frontier_action_bundle",
              strict: true,
              schema: createOpenAiFrontierActionSchema(args.ownedArmyIds, args.attackTargetIds),
            },
          },
          ...(getOpenAiReasoningEffort(args.modelId)
            ? {
                reasoning: {
                  effort: getOpenAiReasoningEffort(args.modelId),
                },
              }
            : {}),
        }),
      },
      FRONTIER_REQUEST_TIMEOUT_MS,
    );

    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{
        type?: string;
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      }>;
      error?: {
        message?: string;
      };
    };

    if (!response.ok) {
      if (attempt < MAX_PROVIDER_RETRIES && RETRYABLE_STATUS_CODES.has(response.status)) {
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      throw new Error(
        payload.error?.message ?? `OpenAI request failed with ${response.status}.`,
      );
    }

    return extractOpenAiText(payload);
  }

  throw new Error(`OpenAI request retries exhausted for ${args.modelId}.`);
}

async function requestGoogleMoveNotation(args: {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  legalMoveNotations: string[];
}) {
  if (!env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY is not configured.");
  }

  for (let attempt = 0; attempt <= MAX_PROVIDER_RETRIES; attempt += 1) {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/${args.modelId}:generateContent?key=${encodeURIComponent(env.GOOGLE_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: args.systemPrompt }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: args.userPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: MAX_MOVE_OUTPUT_TOKENS,
            responseMimeType: "application/json",
            responseSchema: createGoogleMoveSelectionSchema(args.legalMoveNotations),
            thinkingConfig: getGoogleThinkingConfig(args.modelId),
          },
        }),
      },
    );

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
      error?: {
        message?: string;
      };
    };

    if (!response.ok) {
      if (attempt < MAX_PROVIDER_RETRIES && RETRYABLE_STATUS_CODES.has(response.status)) {
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      throw new Error(
        payload.error?.message ?? `Google request failed with ${response.status}.`,
      );
    }

    return (
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("") ?? ""
    );
  }

  throw new Error(`Google request retries exhausted for ${args.modelId}.`);
}

async function requestGoogleFrontierActions(args: {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  ownedArmyIds: string[];
  attackTargetIds: string[];
}) {
  if (!env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY is not configured.");
  }

  for (let attempt = 0; attempt <= MAX_PROVIDER_RETRIES; attempt += 1) {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/${args.modelId}:generateContent?key=${encodeURIComponent(env.GOOGLE_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: args.systemPrompt }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: args.userPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: MAX_FRONTIER_OUTPUT_TOKENS,
            responseMimeType: "application/json",
            responseSchema: createGoogleFrontierActionSchema(args.ownedArmyIds, args.attackTargetIds),
            thinkingConfig: getGoogleThinkingConfig(args.modelId),
          },
        }),
      },
      FRONTIER_REQUEST_TIMEOUT_MS,
    );

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
      error?: {
        message?: string;
      };
    };

    if (!response.ok) {
      if (attempt < MAX_PROVIDER_RETRIES && RETRYABLE_STATUS_CODES.has(response.status)) {
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      throw new Error(
        payload.error?.message ?? `Google request failed with ${response.status}.`,
      );
    }

    return (
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("") ?? ""
    );
  }

  throw new Error(`Google request retries exhausted for ${args.modelId}.`);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function extractOpenAiText(payload: {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}) {
  if (payload.output_text) {
    return payload.output_text;
  }

  return (
    payload.output
      ?.filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .map((item) => item.text ?? "")
      .join("") ?? ""
  );
}

function formatLegalMoveNotations<TMove extends { notation: string }>(moves: readonly TMove[]) {
  return moves.map((move) => move.notation).join("\n");
}

function createOpenAiMoveSelectionSchema(legalMoveNotations: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      notation: {
        type: "string",
        enum: legalMoveNotations,
        description: "The exact legal move notation selected for this turn.",
      },
    },
    required: ["notation"],
  };
}

function createGoogleMoveSelectionSchema(legalMoveNotations: string[]) {
  return {
    type: "OBJECT",
    properties: {
      notation: {
        type: "STRING",
        enum: legalMoveNotations,
        description: "The exact legal move notation selected for this turn.",
      },
    },
    required: ["notation"],
  };
}

function createOpenAiFrontierActionSchema(ownedArmyIds: string[], attackTargetIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      actions: {
        type: "array",
        description: "Zero or more orders to replace current orders for owned armies.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["MOVE", "ATTACK"],
            },
            armyId: {
              type: "string",
              enum: ownedArmyIds,
            },
            x: {
              anyOf: [
                {
                  type: "number",
                  minimum: 0,
                  maximum: FRONTIER_MAP_WIDTH,
                },
                {
                  type: "null",
                },
              ],
            },
            y: {
              anyOf: [
                {
                  type: "number",
                  minimum: 0,
                  maximum: FRONTIER_MAP_HEIGHT,
                },
                {
                  type: "null",
                },
              ],
            },
            targetId: {
              anyOf: [
                {
                  type: "string",
                  enum: attackTargetIds,
                },
                {
                  type: "null",
                },
              ],
            },
          },
          required: ["type", "armyId", "x", "y", "targetId"],
        },
      },
    },
    required: ["actions"],
  };
}

function createGoogleFrontierActionSchema(ownedArmyIds: string[], attackTargetIds: string[]) {
  return {
    type: "OBJECT",
    properties: {
      actions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            type: {
              type: "STRING",
              enum: ["MOVE", "ATTACK"],
            },
            armyId: {
              type: "STRING",
              enum: ownedArmyIds,
            },
            x: {
              type: "NUMBER",
              minimum: 0,
              maximum: FRONTIER_MAP_WIDTH,
            },
            y: {
              type: "NUMBER",
              minimum: 0,
              maximum: FRONTIER_MAP_HEIGHT,
            },
            targetId: {
              type: "STRING",
              enum: attackTargetIds,
            },
          },
          required: ["type", "armyId"],
        },
      },
    },
    required: ["actions"],
  };
}

function buildFrontierUserPrompt(args: {
  state: FrontierState;
  owner: FrontierOwner;
  board: string;
  currentWindowIndex: number;
  secondsUntilNextWindow: number;
  matchSecondsRemaining: number;
}) {
  const opponent = getFrontierOpponent(args.owner);
  const yourBase = args.state.bases.find((base) => base.owner === args.owner);
  const enemyBase = args.state.bases.find((base) => base.owner === opponent);
  const ownArmies = args.state.armies
    .filter((army) => army.owner === args.owner)
    .map(serializeFrontierArmyForPrompt);
  const enemyArmies = args.state.armies
    .filter((army) => army.owner === opponent)
    .map(serializeFrontierArmyForPrompt);
  const sites = args.state.sites.map((site) => ({
    id: site.id,
    x: site.x,
    y: site.y,
    controller: site.controller,
    captureOwner: site.captureOwner,
    captureProgressMs: site.captureProgressMs,
    distanceFromYou:
      yourBase ? Number(Math.hypot(site.x - yourBase.x, site.y - yourBase.y).toFixed(2)) : null,
    distanceFromEnemy:
      enemyBase ? Number(Math.hypot(site.x - enemyBase.x, site.y - enemyBase.y).toFixed(2)) : null,
  })).sort((left, right) => {
    const leftDistance = left.distanceFromYou ?? Number.POSITIVE_INFINITY;
    const rightDistance = right.distanceFromYou ?? Number.POSITIVE_INFINITY;

    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    return left.id.localeCompare(right.id);
  });
  const serializeBase = (owner: FrontierOwner) => {
    const base = args.state.bases.find((candidate) => candidate.owner === owner);

    if (!base) {
      return null;
    }

    return {
      id: base.id,
      owner: base.owner,
      label: getFrontierOwnerLabel(base.owner),
      x: base.x,
      y: base.y,
      health: base.health,
      maxHealth: base.maxHealth,
      alive: base.alive,
    };
  };

  return [
    `Window ${args.currentWindowIndex + 1} closes in ${args.secondsUntilNextWindow.toFixed(2)} seconds.`,
    `Match time remaining: ${args.matchSecondsRemaining} seconds.`,
    `You are ${getFrontierOwnerLabel(args.owner)}.`,
    "",
    `Board summary:`,
    args.board,
    "",
    `Your armies:`,
    JSON.stringify(ownArmies, null, 2),
    "",
    `Enemy armies:`,
    JSON.stringify(enemyArmies, null, 2),
    "",
    `Your base:`,
    JSON.stringify(serializeBase(args.owner), null, 2),
    "",
    `Enemy base:`,
    JSON.stringify(serializeBase(opponent), null, 2),
    "",
    `Sites:`,
    JSON.stringify(sites, null, 2),
  ].join("\n");
}

function serializeFrontierArmyForPrompt(army: FrontierState["armies"][number]) {
  return {
    id: army.id,
    soldiers: army.soldiers,
    x: army.x,
    y: army.y,
    order: army.order,
  };
}

function parseFrontierActionsResponse(
  raw: string,
  args: {
    ownedArmyIds: string[];
    attackTargetIds: string[];
  },
) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model output was not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { actions?: unknown[] }).actions)) {
    throw new Error("Model output was missing an actions array.");
  }

  const validArmyIds = new Set(args.ownedArmyIds);
  const validTargets = new Set(args.attackTargetIds);
  const deduped = new Map<string, FrontierAction>();

  for (const item of (parsed as { actions: unknown[] }).actions) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const action = item as Partial<FrontierAction> & {
      x?: unknown;
      y?: unknown;
      targetId?: unknown;
    };

    if (!action.armyId || typeof action.armyId !== "string" || !validArmyIds.has(action.armyId)) {
      continue;
    }

    if (
      action.type === "MOVE" &&
      typeof action.x === "number" &&
      typeof action.y === "number" &&
      action.x >= 0 &&
      action.x <= FRONTIER_MAP_WIDTH &&
      action.y >= 0 &&
      action.y <= FRONTIER_MAP_HEIGHT
    ) {
      deduped.set(action.armyId, {
        type: "MOVE",
        armyId: action.armyId,
        x: action.x,
        y: action.y,
      });
      continue;
    }

    if (
      action.type === "ATTACK" &&
      typeof action.targetId === "string" &&
      validTargets.has(action.targetId)
    ) {
      deduped.set(action.armyId, {
        type: "ATTACK",
        armyId: action.armyId,
        targetId: action.targetId,
      });
    }
  }

  return [...deduped.values()];
}

function compactPromptBoard(board: string) {
  return board
    .split("\n")
    .filter((line) => line.trim().length > 0 && !line.startsWith("  0 1"))
    .map((line) => {
      const trimmed = line.trim();
      const rowMatch = trimmed.match(/^(\d)\s+(.*)$/);

      if (!rowMatch) {
        return trimmed.replace(/\s+/g, "");
      }

      return `${rowMatch[1]}:${rowMatch[2].replace(/\s+/g, "")}`;
    })
    .join("\n");
}

function getRetryDelayMs(attempt: number) {
  return 250 * 2 ** attempt;
}

function getGoogleThinkingConfig(modelId: string) {
  if (
    modelId === "models/gemini-3-pro-preview" ||
    modelId === "models/gemini-3.1-pro-preview"
  ) {
    return {
      thinkingLevel: "low",
    };
  }

  return {
    thinkingBudget: 0,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
