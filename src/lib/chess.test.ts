import { describe, expect, it } from "vitest";

import {
  applyChessForfeit,
  applyChessMove,
  createInitialChessState,
  getLegalChessMoves,
  parseChessMoveNotation,
  parseChessState,
  type ChessState,
} from "@/lib/chess";

function playNotation(state: ChessState, notation: string) {
  const move = parseChessMoveNotation(notation, getLegalChessMoves(state), state);
  return applyChessMove(state, move);
}

describe("chess engine", () => {
  it("creates the standard opening position", () => {
    const state = createInitialChessState();
    const legalMoves = getLegalChessMoves(state);

    expect(state.winner).toBeNull();
    expect(legalMoves).toHaveLength(20);
    expect(legalMoves.map((move) => move.notation)).toContain("e4");
    expect(legalMoves.map((move) => move.notation)).toContain("Nf3");
  });

  it("parses coordinate-style notation when it resolves to a legal SAN move", () => {
    const state = createInitialChessState();
    const move = parseChessMoveNotation("e2e4", getLegalChessMoves(state), state);

    expect(move.notation).toBe("e4");
    expect(move.lan).toBe("e2e4");
  });

  it("parses castling from coordinate notation", () => {
    let state = createInitialChessState();

    for (const notation of ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]) {
      state = playNotation(state, notation);
    }

    const move = parseChessMoveNotation("e1g1", getLegalChessMoves(state), state);

    expect(move.notation).toBe("O-O");
    expect(move.isKingsideCastle).toBe(true);
  });

  it("parses promotion moves", () => {
    const state = parseChessState(
      JSON.stringify({
        fen: "7k/P7/8/8/8/8/8/K7 w - - 0 1",
        history: [],
        winner: null,
        winnerReason: null,
        turnCount: 0,
        lastMove: null,
      }),
    );

    const move = parseChessMoveNotation("a7a8q", getLegalChessMoves(state), state);

    expect(move.notation).toBe("a8=Q+");
    expect(move.isPromotion).toBe(true);
    expect(move.promotion).toBe("Q");
  });

  it("detects checkmate", () => {
    let state = createInitialChessState();

    for (const notation of ["f3", "e5", "g4", "Qh4#"]) {
      state = playNotation(state, notation);
    }

    expect(state.winner).toBe("BLACK");
    expect(state.winnerReason).toBe("checkmate");
  });

  it("can end a game by timeout forfeit", () => {
    const state = applyChessForfeit(createInitialChessState(), "BLACK");

    expect(state.winner).toBe("BLACK");
    expect(state.winnerReason).toBe("timeout");
  });
});
