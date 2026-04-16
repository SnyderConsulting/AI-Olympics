import { AgentProvider } from "@/generated/prisma/enums";

import {
  getCheckersPlayerLabel,
  type CheckersMove,
  type CheckersPlayerColor,
} from "@/lib/checkers";
import { env } from "@/lib/env";
import { type TicTacToeMark, type TicTacToeMove } from "@/lib/tic-tac-toe";

const REQUEST_TIMEOUT_MS = env.MATCH_MOVE_TIMEOUT_SECONDS * 1000;

export async function chooseOfficialTicTacToeMove(args: {
  provider: AgentProvider;
  modelId: string;
  board: string;
  legalMoves: TicTacToeMove[];
  mark: TicTacToeMark;
}) {
  const moveIndex = await chooseMoveIndex({
    provider: args.provider,
    modelId: args.modelId,
    systemPrompt:
      `You are playing Tic Tac Toe as ${args.mark}. ` +
      "Win by getting three in a row. Choose exactly one legal move. " +
      "Reply with only the integer move index and nothing else.",
    userPrompt:
      `Board:\n${args.board}\n\n` +
      `You are ${args.mark}.\n` +
      `Legal moves:\n${args.legalMoves.map(formatTicTacToeMove).join("\n")}`,
    legalMoveCount: args.legalMoves.length,
  });

  return args.legalMoves[moveIndex];
}

export async function chooseOfficialCheckersMove(args: {
  provider: AgentProvider;
  modelId: string;
  board: string;
  legalMoves: CheckersMove[];
  color: CheckersPlayerColor;
}) {
  const label = getCheckersPlayerLabel(args.color);
  const moveIndex = await chooseMoveIndex({
    provider: args.provider,
    modelId: args.modelId,
    systemPrompt:
      `You are playing Checkers as ${label}. ` +
      "Pieces move diagonally on dark squares. Captures are mandatory. " +
      "Kings move both forward and backward. Choose exactly one legal move. " +
      "Reply with only the integer move index and nothing else.",
    userPrompt:
      `Board:\n${args.board}\n\n` +
      `You are ${label}.\n` +
      `Legal moves:\n${args.legalMoves.map(formatCheckersMove).join("\n")}`,
    legalMoveCount: args.legalMoves.length,
  });

  return args.legalMoves[moveIndex];
}

async function chooseMoveIndex(args: {
  provider: AgentProvider;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  legalMoveCount: number;
}) {
  if (args.legalMoveCount === 0) {
    throw new Error("Cannot choose a move when there are no legal moves.");
  }

  const raw =
    args.provider === AgentProvider.OPENAI
      ? await requestOpenAiMoveIndex(args.modelId, args.systemPrompt, args.userPrompt)
      : await requestGoogleMoveIndex(args.modelId, args.systemPrompt, args.userPrompt);
  const parsed = parseMoveIndex(raw);

  if (parsed < 0 || parsed >= args.legalMoveCount) {
    throw new Error(`Illegal move index ${parsed} returned for ${args.modelId}.`);
  }

  return parsed;
}

async function requestOpenAiMoveIndex(modelId: string, systemPrompt: string, userPrompt: string) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      instructions: systemPrompt,
      input: userPrompt,
      max_output_tokens: 16,
    }),
  });

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        text?: string;
      }>;
    }>;
    error?: {
      message?: string;
    };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `OpenAI request failed with ${response.status}.`);
  }

  return (
    payload.output_text ??
    payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ??
    ""
  );
}

async function requestGoogleMoveIndex(modelId: string, systemPrompt: string, userPrompt: string) {
  if (!env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY is not configured.");
  }

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${encodeURIComponent(env.GOOGLE_API_KEY)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8,
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
    throw new Error(payload.error?.message ?? `Google request failed with ${response.status}.`);
  }

  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
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

function parseMoveIndex(raw: string) {
  const match = raw.trim().match(/-?\d+/);

  if (!match) {
    throw new Error(`No move index found in model output: ${raw}`);
  }

  return Number.parseInt(match[0], 10);
}

function formatTicTacToeMove(move: TicTacToeMove, index: number) {
  return `${index}. ${move.notation}`;
}

function formatCheckersMove(move: CheckersMove, index: number) {
  return `${index}. ${move.notation}`;
}
