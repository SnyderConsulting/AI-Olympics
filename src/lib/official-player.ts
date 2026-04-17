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
import { parseStructuredMoveNotation } from "@/lib/move-notation";
import {
  parseTicTacToeMoveNotation,
  type TicTacToeMark,
  type TicTacToeMove,
} from "@/lib/tic-tac-toe";

const REQUEST_TIMEOUT_MS = env.MATCH_MOVE_TIMEOUT_SECONDS * 1000;
const MAX_MOVE_OUTPUT_TOKENS = 256;
const MAX_PROVIDER_RETRIES = 2;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

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
      `Play Tic Tac Toe as ${args.mark}. ` +
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

export function getOpenAiReasoningEffort(modelId: string): OpenAiReasoningEffort | null {
  if (modelId === "o3" || modelId === "o4-mini") {
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

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
