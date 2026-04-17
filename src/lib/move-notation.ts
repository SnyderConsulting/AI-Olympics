type NotatedMove = {
  notation: string;
};

const STRUCTURED_MOVE_KEYS = [
  "notation",
  "move",
  "moveNotation",
  "move_notation",
  "selectedMove",
  "selected_move",
  "choice",
] as const;

export function parseMoveNotation<TMove extends NotatedMove>(
  raw: string,
  legalMoves: readonly TMove[],
) {
  const trimmed = raw.trim();

  if (!trimmed) {
    throw new Error("No move notation found in model output.");
  }

  const exactMatch = findExactMoveNotationMatch(trimmed, legalMoves);
  if (exactMatch) {
    return exactMatch;
  }

  const structuredMatch = extractMoveNotationFromStructuredPayload(
    stripCodeFences(trimmed),
    legalMoves,
  );
  if (structuredMatch) {
    return structuredMatch;
  }

  const normalizedRaw = normalizeMoveNotation(trimmed);
  const inlineMatches = legalMoves.filter((move) =>
    normalizedRaw.includes(normalizeMoveNotation(move.notation)),
  );

  if (inlineMatches.length === 1) {
    return inlineMatches[0];
  }

  if (inlineMatches.length > 1) {
    throw new Error(`Ambiguous legal move notation found in model output: ${raw}`);
  }

  throw new Error(`No legal move notation found in model output: ${raw}`);
}

export function parseStructuredMoveNotation<TMove extends NotatedMove>(
  raw: string,
  legalMoves: readonly TMove[],
) {
  const trimmed = stripCodeFences(raw).trim();

  if (!trimmed) {
    throw new Error("No structured move JSON found in model output.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Model output was not valid JSON: ${raw}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Model output was not a JSON object: ${raw}`);
  }

  const notation = (parsed as Record<string, unknown>).notation;

  if (typeof notation !== "string" || notation.trim().length === 0) {
    throw new Error(`Model output did not include a string notation field: ${raw}`);
  }

  return parseMoveNotation(notation, legalMoves);
}

export function normalizeMoveNotation(value: string) {
  return stripCodeFences(value)
    .trim()
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/→/g, "->")
    .replace(/[–—]/g, "-")
    .replace(/×/g, "x")
    .replace(/\s+/g, "");
}

function findExactMoveNotationMatch<TMove extends NotatedMove>(
  raw: string,
  legalMoves: readonly TMove[],
) {
  const normalizedRaw = normalizeMoveNotation(raw);

  return (
    legalMoves.find(
      (move) => normalizeMoveNotation(move.notation) === normalizedRaw,
    ) ?? null
  );
}

function extractMoveNotationFromStructuredPayload<TMove extends NotatedMove>(
  raw: string,
  legalMoves: readonly TMove[],
): TMove | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return findMoveNotationInStructuredValue(parsed, legalMoves);
  } catch {
    return null;
  }
}

function findMoveNotationInStructuredValue<TMove extends NotatedMove>(
  value: unknown,
  legalMoves: readonly TMove[],
): TMove | null {
  if (typeof value === "string") {
    return parseMoveNotationCandidate(value, legalMoves);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findMoveNotationInStructuredValue(entry, legalMoves);
      if (match) {
        return match;
      }
    }

    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  for (const key of STRUCTURED_MOVE_KEYS) {
    const match = findMoveNotationInStructuredValue(record[key], legalMoves);
    if (match) {
      return match;
    }
  }

  for (const entry of Object.values(record)) {
    const match = findMoveNotationInStructuredValue(entry, legalMoves);
    if (match) {
      return match;
    }
  }

  return null;
}

function parseMoveNotationCandidate<TMove extends NotatedMove>(
  raw: string,
  legalMoves: readonly TMove[],
) {
  try {
    return parseMoveNotation(raw, legalMoves);
  } catch {
    return null;
  }
}

function stripCodeFences(value: string) {
  return value.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
}
