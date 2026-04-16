import { describe, expect, it } from "vitest";

import {
  applyCheckersForfeit,
  applyCheckersMove,
  createEmptyCheckersBoard,
  createInitialCheckersState,
  getLegalCheckersMoves,
  type CheckersBoard,
  type CheckersState,
} from "@/lib/checkers";

function createState(board: CheckersBoard, nextPlayer: CheckersState["nextPlayer"] = "RED"): CheckersState {
  return {
    board,
    nextPlayer,
    winner: null,
    winnerReason: null,
    turnCount: 0,
    staleHalfmoveCount: 0,
    lastMove: null,
  };
}

describe("checkers engine", () => {
  it("creates the standard opening position", () => {
    const state = createInitialCheckersState();
    const legalMoves = getLegalCheckersMoves(state);

    expect(state.nextPlayer).toBe("RED");
    expect(legalMoves).toHaveLength(7);
  });

  it("enforces mandatory captures", () => {
    const board = createEmptyCheckersBoard();
    board[2][1] = { color: "RED", kind: "MAN" };
    board[2][5] = { color: "RED", kind: "MAN" };
    board[3][2] = { color: "BLACK", kind: "MAN" };

    const legalMoves = getLegalCheckersMoves(createState(board));

    expect(legalMoves).toHaveLength(1);
    expect(legalMoves[0].notation).toBe("2,1 x 4,3");
  });

  it("supports multi-jump captures and ends the game when all opponent pieces are gone", () => {
    const board = createEmptyCheckersBoard();
    board[2][1] = { color: "RED", kind: "MAN" };
    board[3][2] = { color: "BLACK", kind: "MAN" };
    board[5][4] = { color: "BLACK", kind: "MAN" };

    const nextState = applyCheckersMove(createState(board), {
      fromRow: 2,
      fromColumn: 1,
      sequence: [
        { row: 4, column: 3 },
        { row: 6, column: 5 },
      ],
    });

    expect(nextState.board[6][5]).toEqual({ color: "RED", kind: "MAN" });
    expect(nextState.board[3][2]).toBeNull();
    expect(nextState.board[5][4]).toBeNull();
    expect(nextState.winner).toBe("RED");
    expect(nextState.winnerReason).toBe("capture-all");
  });

  it("promotes men to kings on the far row", () => {
    const board = createEmptyCheckersBoard();
    board[6][1] = { color: "RED", kind: "MAN" };
    board[5][6] = { color: "BLACK", kind: "MAN" };

    const nextState = applyCheckersMove(createState(board), {
      fromRow: 6,
      fromColumn: 1,
      sequence: [{ row: 7, column: 0 }],
    });

    expect(nextState.board[7][0]).toEqual({ color: "RED", kind: "KING" });
    expect(nextState.nextPlayer).toBe("BLACK");
    expect(nextState.winner).toBeNull();
  });

  it("stops a capture chain when a man promotes", () => {
    const board = createEmptyCheckersBoard();
    board[5][0] = { color: "RED", kind: "MAN" };
    board[6][1] = { color: "BLACK", kind: "MAN" };
    board[6][3] = { color: "BLACK", kind: "MAN" };

    const legalMoves = getLegalCheckersMoves(createState(board));

    expect(legalMoves).toHaveLength(1);
    expect(legalMoves[0].sequence).toEqual([{ row: 7, column: 2 }]);
  });

  it("lets kings move backward", () => {
    const board = createEmptyCheckersBoard();
    board[4][3] = { color: "RED", kind: "KING" };

    const legalMoves = getLegalCheckersMoves(createState(board));

    expect(legalMoves.map((move) => move.notation)).toContain("4,3 -> 3,2");
    expect(legalMoves.map((move) => move.notation)).toContain("4,3 -> 5,2");
  });

  it("can end a game by timeout forfeit", () => {
    const state = applyCheckersForfeit(createInitialCheckersState(), "BLACK");

    expect(state.winner).toBe("BLACK");
    expect(state.winnerReason).toBe("timeout");
  });
});
