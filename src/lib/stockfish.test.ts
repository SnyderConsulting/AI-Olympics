import { describe, expect, it } from "vitest";

import {
  extractStockfishBestmove,
  resolveStockfishMoveNotation,
} from "@/lib/stockfish";

describe("stockfish helpers", () => {
  it("extracts bestmove lines from UCI output", () => {
    expect(extractStockfishBestmove("bestmove e2e4 ponder c7c5")).toBe("e2e4");
    expect(extractStockfishBestmove("info depth 12")).toBeNull();
  });

  it("rejects missing legal moves", () => {
    expect(() => extractStockfishBestmove("bestmove (none)")).toThrow(
      "Stockfish did not return a legal move.",
    );
  });

  it("maps UCI-style best moves back to legal notation", () => {
    const legalMoves = [
      {
        notation: "e4",
        lan: "e2e4",
        from: "e2",
        to: "e4",
        promotion: null,
      },
      {
        notation: "a8=Q+",
        lan: "a7a8q",
        from: "a7",
        to: "a8",
        promotion: "Q",
      },
    ];

    expect(resolveStockfishMoveNotation("e2e4", legalMoves)).toBe("e4");
    expect(resolveStockfishMoveNotation("a7a8q", legalMoves)).toBe("a8=Q+");
  });
});
