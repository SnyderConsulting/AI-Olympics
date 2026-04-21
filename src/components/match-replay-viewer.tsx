"use client";

import { useState } from "react";

import { formatDateTime } from "@/lib/format";
import type { MatchReplay } from "@/lib/match-replay";

export function MatchReplayViewer({ replay }: { replay: MatchReplay }) {
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(Math.max(replay.frames.length - 1, 0));

  if (replay.frames.length === 0) {
    return replay.unavailableReason ? <p className="muted">{replay.unavailableReason}</p> : null;
  }

  const frame = replay.frames[selectedFrameIndex];
  const maxFrameIndex = replay.frames.length - 1;

  return (
    <div className="replay-viewer stack-s">
      <div className="replay-viewer__meta">
        <strong>
          Turn {selectedFrameIndex} of {maxFrameIndex}
        </strong>
        <span>{frame.headline}</span>
        {frame.createdAt ? <span>{formatDateTime(frame.createdAt)}</span> : null}
      </div>

      {maxFrameIndex > 0 ? (
        <input
          aria-label="Replay turn selector"
          className="replay-viewer__range"
          max={maxFrameIndex}
          min={0}
          onChange={(event) => setSelectedFrameIndex(Number(event.currentTarget.value))}
          step={1}
          type="range"
          value={selectedFrameIndex}
        />
      ) : null}

      <pre className="board-preview">{frame.board}</pre>
    </div>
  );
}
