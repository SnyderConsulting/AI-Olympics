"use client";

import type { CSSProperties } from "react";

import { Chessboard } from "react-chessboard";

import type { ChessReplayVisual } from "@/lib/match-replay";

export function ChessReplayBoard({ visual }: { visual: ChessReplayVisual }) {
  const squareStyles = buildSquareStyles(visual);
  const lastMoveLabel = visual.lastMove ? `${visual.lastMove.san} (${visual.lastMove.from}→${visual.lastMove.to})` : "-";

  return (
    <div className="chess-replay stack-s">
      <div className="chess-replay__surface">
        <Chessboard
          options={{
            position: visual.fen,
            boardOrientation: "white",
            allowDragging: false,
            showNotation: true,
            showAnimations: false,
            animationDurationInMs: 0,
            squareStyles,
            lightSquareStyle: {
              backgroundColor: "#f4e8d6",
            },
            darkSquareStyle: {
              backgroundColor: "#7f5b3b",
            },
            boardStyle: {
              borderRadius: "18px",
              boxShadow: "0 14px 28px rgba(80, 54, 19, 0.14)",
              overflow: "hidden",
            },
          }}
        />
      </div>
      <div className="chess-replay__legend">
        <span className="chess-replay__legend-item">
          <span className="chess-replay__legend-label">Status</span>
          <strong>{describeStatus(visual)}</strong>
        </span>
        <span className="chess-replay__legend-item">
          <span className="chess-replay__legend-label">Next</span>
          <strong>{visual.winner ? "-" : describePlayer(visual.nextPlayer)}</strong>
        </span>
        <span className="chess-replay__legend-item chess-replay__legend-item--wide">
          <span className="chess-replay__legend-label">Last move</span>
          <strong>{lastMoveLabel}</strong>
        </span>
      </div>
    </div>
  );
}

function buildSquareStyles(visual: ChessReplayVisual) {
  const styles: Record<string, CSSProperties> = {};

  if (visual.lastMove) {
    styles[visual.lastMove.from] = {
      backgroundColor: "rgba(244, 200, 85, 0.34)",
    };
    styles[visual.lastMove.to] = {
      backgroundColor: "rgba(95, 165, 122, 0.34)",
    };
  }

  return styles;
}

function describePlayer(player: "WHITE" | "BLACK") {
  return player === "WHITE" ? "White" : "Black";
}

function describeStatus(visual: ChessReplayVisual) {
  if (!visual.winner) {
    return visual.isCheck ? `${describePlayer(visual.nextPlayer)} in check` : "In progress";
  }

  if (visual.winner === "DRAW") {
    return `Draw${visual.winnerReason ? ` • ${visual.winnerReason.replaceAll("-", " ")}` : ""}`;
  }

  return `${describePlayer(visual.winner)} won${visual.winnerReason ? ` • ${visual.winnerReason.replaceAll("-", " ")}` : ""}`;
}
