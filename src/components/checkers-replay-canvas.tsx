"use client";

import { useEffect, useRef } from "react";

import type { CheckersPosition } from "@/lib/checkers";
import type { CheckersReplayVisual } from "@/lib/match-replay";

const CANVAS_SIZE = 960;
const BOARD_ORIGIN = 120;
const BOARD_SIZE = 720;
const CELL_SIZE = BOARD_SIZE / 8;

export function CheckersReplayCanvas({ visual }: { visual: CheckersReplayVisual }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    drawBoard(context, visual);
  }, [visual]);

  const redSummary = summarizeSide(visual, "RED");
  const blackSummary = summarizeSide(visual, "BLACK");

  return (
    <div className="checkers-canvas stack-s">
      <div className="checkers-canvas__surface">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="checkers-canvas__element"
          height={CANVAS_SIZE}
          width={CANVAS_SIZE}
        />
      </div>
      <div className="checkers-canvas__legend">
        <span className="checkers-canvas__legend-item">
          <span className="checkers-canvas__legend-label">Status</span>
          <strong>{describeStatus(visual)}</strong>
        </span>
        <span className="checkers-canvas__legend-item">
          <span className="checkers-canvas__legend-label">Next</span>
          <strong>{visual.winner ? "-" : describePlayer(visual.nextPlayer)}</strong>
        </span>
        <span className="checkers-canvas__legend-item">
          <span className="checkers-canvas__legend-label">Red</span>
          <strong>{redSummary}</strong>
        </span>
        <span className="checkers-canvas__legend-item">
          <span className="checkers-canvas__legend-label">Black</span>
          <strong>{blackSummary}</strong>
        </span>
      </div>
    </div>
  );
}

function drawBoard(context: CanvasRenderingContext2D, visual: CheckersReplayVisual) {
  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  context.save();
  const background = context.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  background.addColorStop(0, "#fbf5eb");
  background.addColorStop(1, "#eadfce");
  context.fillStyle = background;
  context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  context.strokeStyle = "rgba(108, 78, 46, 0.08)";
  context.lineWidth = 1;
  for (let offset = 0; offset <= CANVAS_SIZE; offset += CANVAS_SIZE / 16) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset, CANVAS_SIZE);
    context.stroke();

    context.beginPath();
    context.moveTo(0, offset);
    context.lineTo(CANVAS_SIZE, offset);
    context.stroke();
  }

  context.fillStyle = "#7d5a38";
  roundRect(context, BOARD_ORIGIN - 18, BOARD_ORIGIN - 18, BOARD_SIZE + 36, BOARD_SIZE + 36, 26);
  context.fill();

  context.fillStyle = "#f1e5cf";
  roundRect(context, BOARD_ORIGIN, BOARD_ORIGIN, BOARD_SIZE, BOARD_SIZE, 16);
  context.fill();

  for (let index = 0; index < 8; index += 1) {
    const label = String(index);
    const x = BOARD_ORIGIN + index * CELL_SIZE + CELL_SIZE / 2;
    const y = BOARD_ORIGIN + index * CELL_SIZE + CELL_SIZE / 2;

    context.fillStyle = "rgba(68, 48, 27, 0.72)";
    context.font = "600 28px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, x, BOARD_ORIGIN - 46);
    context.fillText(label, BOARD_ORIGIN - 46, y);
  }

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const x = BOARD_ORIGIN + column * CELL_SIZE;
      const y = BOARD_ORIGIN + row * CELL_SIZE;
      const isPlayable = (row + column) % 2 === 1;

      context.fillStyle = isPlayable ? "#6f5131" : "#f6ecdb";
      context.fillRect(x, y, CELL_SIZE, CELL_SIZE);
    }
  }

  const lastMovePath = visual.lastMove ? [visual.lastMove.from, ...visual.lastMove.sequence] : [];

  if (lastMovePath.length >= 2) {
    context.strokeStyle = "rgba(244, 200, 85, 0.9)";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 10;
    context.beginPath();
    context.moveTo(...toCenter(lastMovePath[0]!));
    for (let index = 1; index < lastMovePath.length; index += 1) {
      context.lineTo(...toCenter(lastMovePath[index]!));
    }
    context.stroke();
  }

  for (const position of lastMovePath) {
    highlightSquare(context, position, "rgba(244, 200, 85, 0.30)");
  }

  for (const position of visual.lastMove?.captures ?? []) {
    highlightSquare(context, position, "rgba(216, 86, 55, 0.34)");
    drawCaptureMarker(context, position);
  }

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const piece = visual.board[row]?.[column];

      if (!piece) {
        continue;
      }

      drawPiece(context, row, column, piece.color, piece.kind === "KING");
    }
  }

  context.restore();
}

function drawPiece(
  context: CanvasRenderingContext2D,
  row: number,
  column: number,
  color: "RED" | "BLACK",
  isKing: boolean,
) {
  const [centerX, centerY] = toCenter({ row, column });
  const radius = CELL_SIZE * 0.34;

  context.save();
  context.shadowBlur = 16;
  context.shadowColor = "rgba(28, 24, 19, 0.22)";
  context.fillStyle = "rgba(28, 24, 19, 0.2)";
  context.beginPath();
  context.arc(centerX, centerY + 6, radius, 0, Math.PI * 2);
  context.fill();

  const pieceGradient = context.createRadialGradient(
    centerX - radius * 0.3,
    centerY - radius * 0.35,
    radius * 0.15,
    centerX,
    centerY,
    radius,
  );

  if (color === "RED") {
    pieceGradient.addColorStop(0, "#ffb08e");
    pieceGradient.addColorStop(0.45, "#d76438");
    pieceGradient.addColorStop(1, "#8d2a14");
  } else {
    pieceGradient.addColorStop(0, "#98a1ad");
    pieceGradient.addColorStop(0.45, "#40464f");
    pieceGradient.addColorStop(1, "#14171b");
  }

  context.shadowBlur = 18;
  context.shadowColor = color === "RED" ? "rgba(207, 90, 46, 0.25)" : "rgba(20, 23, 27, 0.34)";
  context.fillStyle = pieceGradient;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();

  context.shadowBlur = 0;
  context.strokeStyle = color === "RED" ? "rgba(255, 229, 213, 0.75)" : "rgba(255, 255, 255, 0.2)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(centerX, centerY, radius - 6, 0, Math.PI * 2);
  context.stroke();

  if (isKing) {
    context.strokeStyle = "rgba(244, 200, 85, 0.92)";
    context.lineWidth = 6;
    context.beginPath();
    context.arc(centerX, centerY, radius - 15, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = "rgba(255, 243, 206, 0.98)";
    context.font = "700 28px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("K", centerX, centerY + 1);
  }

  context.restore();
}

function highlightSquare(
  context: CanvasRenderingContext2D,
  position: CheckersPosition,
  fillStyle: string,
) {
  const x = BOARD_ORIGIN + position.column * CELL_SIZE;
  const y = BOARD_ORIGIN + position.row * CELL_SIZE;

  context.save();
  context.fillStyle = fillStyle;
  context.fillRect(x, y, CELL_SIZE, CELL_SIZE);
  context.restore();
}

function drawCaptureMarker(context: CanvasRenderingContext2D, position: CheckersPosition) {
  const [centerX, centerY] = toCenter(position);

  context.save();
  context.strokeStyle = "rgba(255, 244, 235, 0.92)";
  context.lineCap = "round";
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(centerX - 14, centerY - 14);
  context.lineTo(centerX + 14, centerY + 14);
  context.moveTo(centerX + 14, centerY - 14);
  context.lineTo(centerX - 14, centerY + 14);
  context.stroke();
  context.restore();
}

function toCenter(position: CheckersPosition): [number, number] {
  return [
    BOARD_ORIGIN + position.column * CELL_SIZE + CELL_SIZE / 2,
    BOARD_ORIGIN + position.row * CELL_SIZE + CELL_SIZE / 2,
  ];
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function summarizeSide(visual: CheckersReplayVisual, color: "RED" | "BLACK") {
  let total = 0;
  let kings = 0;

  for (const row of visual.board) {
    for (const cell of row) {
      if (!cell || cell.color !== color) {
        continue;
      }

      total += 1;
      if (cell.kind === "KING") {
        kings += 1;
      }
    }
  }

  return kings > 0 ? `${total} • ${kings}K` : String(total);
}

function describePlayer(color: "RED" | "BLACK") {
  return color === "RED" ? "Red" : "Black";
}

function describeStatus(visual: CheckersReplayVisual) {
  if (!visual.winner) {
    return "In progress";
  }

  if (visual.winner === "DRAW") {
    return `Draw${visual.winnerReason ? ` • ${visual.winnerReason.replaceAll("-", " ")}` : ""}`;
  }

  return `${describePlayer(visual.winner)} won${visual.winnerReason ? ` • ${visual.winnerReason.replaceAll("-", " ")}` : ""}`;
}
