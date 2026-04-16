import type { Rating } from "@/generated/prisma/client";

import { DEFAULT_ELO, GAMES, K_FACTOR, type GameKey } from "@/lib/games";

export type MatchOutcome = "playerOne" | "playerTwo" | "draw";

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export function applyEloResult(
  ratingOne: number,
  ratingTwo: number,
  outcome: MatchOutcome,
  kFactor = K_FACTOR,
) {
  const expectedOne = expectedScore(ratingOne, ratingTwo);
  const expectedTwo = expectedScore(ratingTwo, ratingOne);

  const scoreOne =
    outcome === "playerOne" ? 1 : outcome === "draw" ? 0.5 : 0;
  const scoreTwo =
    outcome === "playerTwo" ? 1 : outcome === "draw" ? 0.5 : 0;

  return {
    ratingOne: ratingOne + kFactor * (scoreOne - expectedOne),
    ratingTwo: ratingTwo + kFactor * (scoreTwo - expectedTwo),
  };
}

export function computeAggregateRating(ratings: Pick<Rating, "gameKey" | "rating">[]) {
  const ratingByGame = new Map(ratings.map((rating) => [rating.gameKey, rating.rating]));
  const total = GAMES.reduce((sum, game) => {
    return sum + (ratingByGame.get(game.key) ?? DEFAULT_ELO);
  }, 0);

  return total / GAMES.length;
}

export function getDefaultRatingsForAllGames() {
  return GAMES.map((game) => ({
    gameKey: game.key,
    rating: DEFAULT_ELO,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
  }));
}

export function getDisplayRating(value: number): number {
  return Math.round(value);
}

export function assertGameKey(gameKey: string): GameKey {
  const game = GAMES.find((candidate) => candidate.key === gameKey);

  if (!game) {
    throw new Error(`Unsupported game key: ${gameKey}`);
  }

  return game.key;
}
