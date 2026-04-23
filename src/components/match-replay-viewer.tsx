"use client";

import type { CSSProperties } from "react";
import { useState } from "react";

import { CheckersReplayCanvas } from "@/components/checkers-replay-canvas";
import { ChessReplayBoard } from "@/components/chess-replay-board";
import { FrontierReplayMap } from "@/components/frontier-replay-map";
import { TicTacToeReplayCanvas } from "@/components/tic-tac-toe-replay-canvas";
import { formatDateTime } from "@/lib/format";
import type { MatchReplay } from "@/lib/match-replay";

export function MatchReplayViewer({ replay }: { replay: MatchReplay }) {
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(Math.max(replay.frames.length - 1, 0));

  if (replay.frames.length === 0) {
    return replay.unavailableReason ? <p className="muted">{replay.unavailableReason}</p> : null;
  }

  const frame = replay.frames[selectedFrameIndex];
  const maxFrameIndex = replay.frames.length - 1;
  const progress = maxFrameIndex === 0 ? 100 : (selectedFrameIndex / maxFrameIndex) * 100;

  return (
    <div className="replay-viewer stack-s">
      <div className="replay-viewer__meta">
        <strong>
          Turn {selectedFrameIndex} of {maxFrameIndex}
        </strong>
        <span className="replay-viewer__headline" title={frame.headline}>
          {frame.headline}
        </span>
        <span className="replay-viewer__time">
          {frame.createdAt ? formatDateTime(frame.createdAt) : "\u00A0"}
        </span>
      </div>

      {maxFrameIndex > 0 ? (
        <input
          aria-label="Replay turn selector"
          className="replay-viewer__range"
          max={maxFrameIndex}
          min={0}
          onChange={(event) => setSelectedFrameIndex(Number(event.currentTarget.value))}
          step={1}
          style={{ "--replay-progress": `${progress}%` } as CSSProperties}
          type="range"
          value={selectedFrameIndex}
        />
      ) : null}

      {frame.visual?.kind === "frontier" ? (
        <FrontierReplayMap visual={frame.visual} />
      ) : frame.visual?.kind === "chess" ? (
        <ChessReplayBoard visual={frame.visual} />
      ) : frame.visual?.kind === "checkers" ? (
        <CheckersReplayCanvas visual={frame.visual} />
      ) : frame.visual?.kind === "tic-tac-toe" ? (
        <TicTacToeReplayCanvas visual={frame.visual} />
      ) : (
        <pre className="board-preview">{frame.board}</pre>
      )}
    </div>
  );
}
