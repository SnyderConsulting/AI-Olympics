"use client";

import { useEffect, useRef } from "react";

import type { TicTacToeReplayVisual } from "@/lib/match-replay";

const CANVAS_SIZE = 900;
const BOARD_PADDING = 92;
const GRID_LINE_WIDTH = 18;
const MARK_STROKE_WIDTH = 22;

export function TicTacToeReplayCanvas({ visual }: { visual: TicTacToeReplayVisual }) {
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

  return (
    <div className="tic-tac-toe-canvas stack-s">
      <div className="tic-tac-toe-canvas__surface">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="tic-tac-toe-canvas__element"
          height={CANVAS_SIZE}
          width={CANVAS_SIZE}
        />
      </div>
      <div className="tic-tac-toe-canvas__legend">
        <span className="tic-tac-toe-canvas__legend-item">
          <span className="tic-tac-toe-canvas__legend-label">Status</span>
          <strong>{describeStatus(visual)}</strong>
        </span>
        <span className="tic-tac-toe-canvas__legend-item">
          <span className="tic-tac-toe-canvas__legend-label">Next</span>
          <strong>{visual.winner ? "-" : visual.nextMark}</strong>
        </span>
      </div>
    </div>
  );
}

function drawBoard(context: CanvasRenderingContext2D, visual: TicTacToeReplayVisual) {
  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const boardSize = CANVAS_SIZE - BOARD_PADDING * 2;
  const cellSize = boardSize / 3;

  context.save();
  context.fillStyle = "#f7efe2";
  context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const gradient = context.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.92)");
  gradient.addColorStop(1, "rgba(233, 221, 204, 0.96)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  context.strokeStyle = "rgba(108, 78, 46, 0.08)";
  context.lineWidth = 1;

  for (let offset = 0; offset <= CANVAS_SIZE; offset += CANVAS_SIZE / 12) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset, CANVAS_SIZE);
    context.stroke();

    context.beginPath();
    context.moveTo(0, offset);
    context.lineTo(CANVAS_SIZE, offset);
    context.stroke();
  }

  const winningCells = new Set(
    (visual.winningLine ?? []).map(([row, column]) => `${row}:${column}`),
  );

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const x = BOARD_PADDING + column * cellSize;
      const y = BOARD_PADDING + row * cellSize;
      const inset = 8;

      context.fillStyle = winningCells.has(`${row}:${column}`)
        ? "rgba(236, 188, 85, 0.28)"
        : "rgba(255, 250, 244, 0.82)";
      context.fillRect(x + inset, y + inset, cellSize - inset * 2, cellSize - inset * 2);
    }
  }

  context.strokeStyle = "#2b2016";
  context.lineCap = "round";
  context.lineWidth = GRID_LINE_WIDTH;

  for (let index = 1; index < 3; index += 1) {
    const offset = BOARD_PADDING + cellSize * index;

    context.beginPath();
    context.moveTo(offset, BOARD_PADDING + 16);
    context.lineTo(offset, CANVAS_SIZE - BOARD_PADDING - 16);
    context.stroke();

    context.beginPath();
    context.moveTo(BOARD_PADDING + 16, offset);
    context.lineTo(CANVAS_SIZE - BOARD_PADDING - 16, offset);
    context.stroke();
  }

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const cell = visual.board[row]?.[column];

      if (!cell) {
        continue;
      }

      const x = BOARD_PADDING + column * cellSize;
      const y = BOARD_PADDING + row * cellSize;

      if (cell === "X") {
        drawX(context, x, y, cellSize);
      } else {
        drawO(context, x, y, cellSize);
      }
    }
  }

  if (visual.winningLine && visual.winningLine.length >= 2) {
    const [startRow, startColumn] = visual.winningLine[0];
    const [endRow, endColumn] = visual.winningLine[visual.winningLine.length - 1];

    context.strokeStyle = "rgba(236, 188, 85, 0.98)";
    context.lineCap = "round";
    context.lineWidth = 18;
    context.beginPath();
    context.moveTo(
      BOARD_PADDING + startColumn * cellSize + cellSize / 2,
      BOARD_PADDING + startRow * cellSize + cellSize / 2,
    );
    context.lineTo(
      BOARD_PADDING + endColumn * cellSize + cellSize / 2,
      BOARD_PADDING + endRow * cellSize + cellSize / 2,
    );
    context.stroke();
  }

  context.restore();
}

function drawX(context: CanvasRenderingContext2D, x: number, y: number, cellSize: number) {
  const inset = cellSize * 0.24;

  context.save();
  context.strokeStyle = "#cf5a2e";
  context.shadowBlur = 12;
  context.shadowColor = "rgba(207, 90, 46, 0.25)";
  context.lineCap = "round";
  context.lineWidth = MARK_STROKE_WIDTH;

  context.beginPath();
  context.moveTo(x + inset, y + inset);
  context.lineTo(x + cellSize - inset, y + cellSize - inset);
  context.stroke();

  context.beginPath();
  context.moveTo(x + cellSize - inset, y + inset);
  context.lineTo(x + inset, y + cellSize - inset);
  context.stroke();
  context.restore();
}

function drawO(context: CanvasRenderingContext2D, x: number, y: number, cellSize: number) {
  context.save();
  context.strokeStyle = "#1f7f88";
  context.shadowBlur = 12;
  context.shadowColor = "rgba(31, 127, 136, 0.22)";
  context.lineWidth = MARK_STROKE_WIDTH;

  context.beginPath();
  context.arc(x + cellSize / 2, y + cellSize / 2, cellSize * 0.27, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function describeStatus(visual: TicTacToeReplayVisual) {
  if (!visual.winner) {
    return "In progress";
  }

  if (visual.winner === "DRAW") {
    return visual.winnerReason === "timeout" ? "Draw • timeout" : "Draw";
  }

  return visual.winnerReason === "timeout"
    ? `${visual.winner} won • timeout`
    : `${visual.winner} won`;
}
