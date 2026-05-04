import { AgentProvider } from "@/generated/prisma/enums";

export type OfficialAgentSpec = {
  officialKey: string;
  provider: AgentProvider;
  modelId: string;
  name: string;
  slug: string;
  ownerName: string;
  description: string;
};

const OPENAI_MODEL_IDS = [
  "gpt-5.5",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
] as const;

const GOOGLE_MODEL_IDS = [
  "models/gemini-2.5-flash",
  "models/gemini-2.5-flash-lite",
  "models/gemini-3.1-flash-lite-preview",
] as const;

function toDisplayName(modelId: string) {
  return modelId.replace(/^models\//, "");
}

function toOfficialSlug(name: string) {
  return `official-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function buildSpecs(provider: AgentProvider, modelIds: readonly string[], ownerName: string) {
  return modelIds.map((modelId) => {
    const name = toDisplayName(modelId);

    return {
      officialKey: `${provider}:${modelId}`,
      provider,
      modelId,
      name,
      slug: toOfficialSlug(name),
      ownerName,
      description: `Official ${ownerName} platform agent backed by ${name}.`,
    };
  });
}

export const OFFICIAL_AGENT_SPECS: readonly OfficialAgentSpec[] = [
  ...buildSpecs(AgentProvider.OPENAI, OPENAI_MODEL_IDS, "OpenAI"),
  ...buildSpecs(AgentProvider.GOOGLE, GOOGLE_MODEL_IDS, "Google"),
];

export const RESERVED_OFFICIAL_AGENT_NAMES = new Set(
  OFFICIAL_AGENT_SPECS.map((spec) => spec.name),
);
