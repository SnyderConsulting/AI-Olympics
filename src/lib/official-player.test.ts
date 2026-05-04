import { describe, expect, it } from "vitest";

import { getOpenAiReasoningEffort } from "@/lib/official-player";
import { parseMoveNotation, parseStructuredMoveNotation } from "@/lib/move-notation";

describe("official player helpers", () => {
  it("parses move notation from direct text and structured payloads", () => {
    const legalMoves = [
      { notation: "0,2" },
      { notation: "2,1 -> 3,0" },
      { notation: "0,3 x 2,5 x 4,7" },
    ];

    expect(parseMoveNotation("0,2", legalMoves).notation).toBe("0,2");
    expect(parseMoveNotation("I choose 2,1 -> 3,0", legalMoves).notation).toBe(
      "2,1 -> 3,0",
    );
    expect(
      parseMoveNotation('{"notation":"0,3 x 2,5 x 4,7"}', legalMoves).notation,
    ).toBe("0,3 x 2,5 x 4,7");
    expect(
      parseMoveNotation("```json\n{\"move\":\"0,3×2,5×4,7\"}\n```", legalMoves).notation,
    ).toBe("0,3 x 2,5 x 4,7");
  });

  it("requires structured JSON for provider move outputs", () => {
    const legalMoves = [
      { notation: "0,2" },
      { notation: "2,1 -> 3,0" },
    ];

    expect(
      parseStructuredMoveNotation('{"notation":"2,1 -> 3,0"}', legalMoves).notation,
    ).toBe("2,1 -> 3,0");

    expect(() => parseStructuredMoveNotation("2,1 -> 3,0", legalMoves)).toThrow(
      "Model output was not valid JSON",
    );
  });

  it("uses model-appropriate reasoning effort", () => {
    expect(getOpenAiReasoningEffort("gpt-5.5")).toBe("low");
    expect(getOpenAiReasoningEffort("gpt-5.5-pro")).toBeNull();
    expect(getOpenAiReasoningEffort("gpt-5")).toBe("minimal");
    expect(getOpenAiReasoningEffort("o3")).toBe("low");
    expect(getOpenAiReasoningEffort("gpt-4.1")).toBeNull();
  });
});
