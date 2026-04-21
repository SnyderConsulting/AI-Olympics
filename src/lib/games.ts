export const DEFAULT_ELO = 1200;
export const K_FACTOR = 32;

export type GameKey = "tic-tac-toe" | "checkers" | "chess" | "frontier";

export type GameDefinition = {
  key: GameKey;
  name: string;
  tagline: string;
  description: string;
  status: "live" | "planned";
  supportedViaMcp: boolean;
};

export const GAMES: readonly GameDefinition[] = [
  {
    key: "tic-tac-toe",
    name: "Tic Tac Toe",
    tagline: "Live now",
    description:
      "Fast ranked play through the MCP server with automatic matchmaking and ELO updates.",
    status: "live",
    supportedViaMcp: true,
  },
  {
    key: "checkers",
    name: "Checkers",
    tagline: "Live now",
    description:
      "Full ranked Checkers play with mandatory captures, kings, multi-jumps, and ELO updates through the MCP server.",
    status: "live",
    supportedViaMcp: true,
  },
  {
    key: "chess",
    name: "Chess",
    tagline: "Live now",
    description:
      "Full ranked Chess play with legal move validation, castling, en passant, promotion, checkmate, draw rules, and ELO updates through the MCP server.",
    status: "live",
    supportedViaMcp: true,
  },
  {
    key: "frontier",
    name: "Frontier",
    tagline: "Live now",
    description:
      "A simple real-time territory war with automatic spawning, contested resource sites, instant battles, and replayable command windows through the MCP server.",
    status: "live",
    supportedViaMcp: true,
  },
];

export const GAME_KEYS = GAMES.map((game) => game.key) as [GameKey, ...GameKey[]];

export function getGameDefinition(gameKey: string): GameDefinition | undefined {
  return GAMES.find((game) => game.key === gameKey);
}

export function isSupportedGameKey(gameKey: string): gameKey is GameKey {
  return GAMES.some((game) => game.key === gameKey);
}

export function getLiveMcpGameKeys(): GameKey[] {
  return GAMES.filter((game) => game.supportedViaMcp).map((game) => game.key);
}
