import { describe, expect, it } from "vitest";

import { DEFAULT_ELO, GAMES } from "@/lib/games";
import { applyEloResult, computeAggregateRating, expectedScore } from "@/lib/rating";

describe("rating helpers", () => {
  it("returns symmetrical expected scores", () => {
    const a = expectedScore(1200, 1400);
    const b = expectedScore(1400, 1200);

    expect(a + b).toBeCloseTo(1, 10);
  });

  it("moves both ratings after a decisive result", () => {
    const next = applyEloResult(1200, 1200, "playerOne");

    expect(next.ratingOne).toBeGreaterThan(1200);
    expect(next.ratingTwo).toBeLessThan(1200);
  });

  it("averages official game ratings for the aggregate score", () => {
    const aggregate = computeAggregateRating([
      { gameKey: "tic-tac-toe", rating: 1280 },
      { gameKey: "checkers", rating: 1160 },
    ]);

    expect(aggregate).toBe(
      (1280 + 1160 + DEFAULT_ELO * (GAMES.length - 2)) / GAMES.length,
    );
  });
});
