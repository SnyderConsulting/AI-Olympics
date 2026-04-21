"use client";

import type { CSSProperties } from "react";

import {
  FRONTIER_MATCH_DURATION_MS,
  type FrontierOwner,
  type FrontierReplayVisual,
} from "@/lib/frontier";

const OWNER_LABEL: Record<FrontierOwner, string> = {
  ONE: "West",
  TWO: "East",
};

export function FrontierReplayMap({ visual }: { visual: FrontierReplayVisual }) {
  const targetById = new Map<string, { x: number; y: number }>();

  for (const base of visual.bases) {
    targetById.set(base.id, { x: base.x, y: base.y });
  }

  for (const site of visual.sites) {
    targetById.set(site.id, { x: site.x, y: site.y });
  }

  for (const army of visual.armies) {
    targetById.set(army.id, { x: army.x, y: army.y });
  }

  const westSoldiers = visual.armies
    .filter((army) => army.owner === "ONE")
    .reduce((sum, army) => sum + army.soldiers, 0);
  const eastSoldiers = visual.armies
    .filter((army) => army.owner === "TWO")
    .reduce((sum, army) => sum + army.soldiers, 0);

  return (
    <div className="frontier-map stack-s">
      <div className="frontier-map__summary">
        <div className="frontier-map__summary-card frontier-map__summary-card--west">
          <strong>West</strong>
          <span>{westSoldiers} soldiers</span>
          <span>{visual.income.ONE.toFixed(2)} income</span>
        </div>
        <div className="frontier-map__summary-card frontier-map__summary-card--clock">
          <strong>{formatFrontierClock(visual.elapsedMs)}</strong>
          <span>{formatFrontierRemaining(visual.elapsedMs)} left</span>
          <span>{visual.winner ? describeWinner(visual) : "In progress"}</span>
        </div>
        <div className="frontier-map__summary-card frontier-map__summary-card--east">
          <strong>East</strong>
          <span>{eastSoldiers} soldiers</span>
          <span>{visual.income.TWO.toFixed(2)} income</span>
        </div>
      </div>

      <div className="frontier-map__surface">
        <svg
          aria-hidden="true"
          className="frontier-map__vectors"
          viewBox={`0 0 ${visual.mapWidth} ${visual.mapHeight}`}
        >
          {visual.armies.map((army) => {
            if (army.order.type === "IDLE") {
              return null;
            }

            const target =
              army.order.type === "MOVE"
                ? { x: army.order.x, y: army.order.y }
                : targetById.get(army.order.targetId);

            if (!target) {
              return null;
            }

            return (
              <line
                key={`${army.id}-${army.order.type}-${target.x}-${target.y}`}
                className={`frontier-map__vector frontier-map__vector--${army.owner === "ONE" ? "west" : "east"}`}
                x1={army.x}
                x2={target.x}
                y1={army.y}
                y2={target.y}
              />
            );
          })}
        </svg>

        {visual.sites.map((site) => (
          <div
            key={site.id}
            className={[
              "frontier-map__site",
              site.controller === "ONE"
                ? "frontier-map__site--west"
                : site.controller === "TWO"
                  ? "frontier-map__site--east"
                  : "frontier-map__site--neutral",
            ].join(" ")}
            style={toPositionStyle(site.x, site.y, visual)}
            title={`${site.id} • ${describeSite(site)}`}
          >
            <span>{site.id.replace("site_", "S")}</span>
          </div>
        ))}

        {visual.bases.map((base) => (
          <div
            key={base.id}
            className={[
              "frontier-map__base",
              base.owner === "ONE" ? "frontier-map__base--west" : "frontier-map__base--east",
              base.alive ? "" : "frontier-map__base--destroyed",
            ].join(" ")}
            style={toPositionStyle(base.x, base.y, visual)}
            title={`${OWNER_LABEL[base.owner]} base${base.alive ? "" : " destroyed"}`}
          >
            <span>{OWNER_LABEL[base.owner]}</span>
          </div>
        ))}

        {visual.armies.map((army) => (
          <div
            key={army.id}
            className={[
              "frontier-map__army",
              army.owner === "ONE" ? "frontier-map__army--west" : "frontier-map__army--east",
            ].join(" ")}
            style={toPositionStyle(army.x, army.y, visual)}
            title={`${OWNER_LABEL[army.owner]} ${army.id} • ${army.soldiers} soldiers`}
          >
            <span>{army.soldiers}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function toPositionStyle(
  x: number,
  y: number,
  visual: FrontierReplayVisual,
): CSSProperties {
  return {
    left: `${(x / visual.mapWidth) * 100}%`,
    top: `${(y / visual.mapHeight) * 100}%`,
  };
}

function describeSite(site: FrontierReplayVisual["sites"][number]) {
  if (site.controller) {
    return `${OWNER_LABEL[site.controller]} controlled`;
  }

  if (site.captureOwner) {
    return `${OWNER_LABEL[site.captureOwner]} capturing`;
  }

  return "Neutral";
}

function formatFrontierClock(elapsedMs: number) {
  return `${Math.floor(elapsedMs / 60000)}:${String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0")}`;
}

function formatFrontierRemaining(elapsedMs: number) {
  const remainingMs = Math.max(0, FRONTIER_MATCH_DURATION_MS - elapsedMs);
  return `${Math.floor(remainingMs / 60000)}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0")}`;
}

function describeWinner(visual: FrontierReplayVisual) {
  if (!visual.winner) {
    return "In progress";
  }

  if (visual.winner === "DRAW") {
    return `Draw${visual.winnerReason ? ` • ${visual.winnerReason.replaceAll("-", " ")}` : ""}`;
  }

  return `${OWNER_LABEL[visual.winner]} won${visual.winnerReason ? ` • ${visual.winnerReason.replaceAll("-", " ")}` : ""}`;
}
