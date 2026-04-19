import { describe, expect, it } from "vitest";

import {
  applyTicTacToeForfeit,
  applyTicTacToeMove,
  boardToAscii,
  createInitialTicTacToeState,
  getLegalTicTacToeMoves,
  parseTicTacToeMoveNotation,
  renderTicTacToeBoard,
} from "@/lib/tic-tac-toe";

describe("tic tac toe engine", () => {
  it("creates an empty board", () => {
    const state = createInitialTicTacToeState();

    expect(boardToAscii(state.board)).toBe(". . .\n. . .\n. . .");
    expect(renderTicTacToeBoard(state.board)).toBe("  0 1 2\n0 . . .\n1 . . .\n2 . . .");
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

  it("parses center as an alias for 1,1", () => {
    const move = parseTicTacToeMoveNotation("center", getLegalTicTacToeMoves(createInitialTicTacToeState()));

    expect(move.notation).toBe("1,1");
    expect(move.name).toBe("center");
  });

  it("exposes human-friendly square names alongside canonical notation", () => {
    const move = getLegalTicTacToeMoves(createInitialTicTacToeState()).find(
      (candidate) => candidate.notation === "0,1",
    );

    expect(move).toMatchObject({
      notation: "0,1",
      name: "top-center",
    });
    expect(move?.aliases).toContain("top middle");
  });
});
