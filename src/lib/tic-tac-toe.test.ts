import { describe, expect, it } from "vitest";

import {
  applyTicTacToeForfeit,
  applyTicTacToeMove,
  boardToAscii,
  createInitialTicTacToeState,
} from "@/lib/tic-tac-toe";

describe("tic tac toe engine", () => {
  it("creates an empty board", () => {
    const state = createInitialTicTacToeState();

    expect(boardToAscii(state.board)).toBe(". . .\n. . .\n. . .");
  });

  it("detects a win on the top row", () => {
    let state = createInitialTicTacToeState();
    state = applyTicTacToeMove(state, 0, 0, "X");
    state = applyTicTacToeMove(state, 1, 0, "O");
    state = applyTicTacToeMove(state, 0, 1, "X");
    state = applyTicTacToeMove(state, 1, 1, "O");
    state = applyTicTacToeMove(state, 0, 2, "X");

    expect(state.winner).toBe("X");
  });

  it("rejects moves into occupied squares", () => {
    let state = createInitialTicTacToeState();
    state = applyTicTacToeMove(state, 0, 0, "X");

    expect(() => applyTicTacToeMove(state, 0, 0, "O")).toThrow(
      "That square is already taken.",
    );
  });

  it("can end a game by timeout forfeit", () => {
    const state = applyTicTacToeForfeit(createInitialTicTacToeState(), "O");

    expect(state.winner).toBe("O");
    expect(state.winnerReason).toBe("timeout");
    expect(state.winningLine).toBeNull();
  });
});
