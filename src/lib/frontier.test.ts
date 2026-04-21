import { describe, expect, it } from "vitest";

import {
  applyFrontierCommandActions,
  createInitialFrontierState,
  FRONTIER_CAPTURE_DURATION_MS,
  FRONTIER_MATCH_DURATION_MS,
  FRONTIER_TICK_MS,
  parseFrontierState,
  renderFrontierBoard,
  serializeFrontierState,
  tickFrontierState,
} from "@/lib/frontier";

describe("frontier engine", () => {
  it("creates the expected opening map state", () => {
    const state = createInitialFrontierState();
    const board = renderFrontierBoard(state);

    expect(board).toContain("Time 0.0s / 300.0s");
    expect(board).toContain("Bases | West alive | East alive");
    expect(board).toContain("West armies | army-1:12@10,30 idle");
    expect(board).toContain("East armies | army-2:12@90,30 idle");
    expect(parseFrontierState(serializeFrontierState(state))).toEqual(state);
  });

  it("captures a site after uncontested occupation", () => {
    const initial = createInitialFrontierState();
    initial.armies[0]!.x = 25;
    initial.armies[0]!.y = 15;
    initial.armies[0]!.order = { type: "IDLE" };

    const result = tickFrontierState(initial, FRONTIER_CAPTURE_DURATION_MS);
    const capturedSite = result.state.sites.find((site) => site.id === "site_1");

    expect(capturedSite?.controller).toBe("ONE");
    expect(result.events).toContainEqual({
      type: "site-captured",
      owner: "ONE",
      siteId: "site_1",
    });
  });

  it("moves armies and resolves deterministic battles", () => {
    const initial = createInitialFrontierState();
    initial.armies[0]!.x = 49.5;
    initial.armies[0]!.y = 30;
    initial.armies[0]!.soldiers = 14;
    initial.armies[1]!.x = 50.5;
    initial.armies[1]!.y = 30;
    initial.armies[1]!.soldiers = 10;
    initial.armies[0]!.order = { type: "ATTACK", targetId: initial.armies[1]!.id };
    initial.armies[1]!.order = { type: "IDLE" };

    const result = tickFrontierState(initial, FRONTIER_TICK_MS, () => 0.5);
    const survivingWestArmy = result.state.armies.find((army) => army.owner === "ONE");

    expect(result.state.armies).toHaveLength(1);
    expect(survivingWestArmy?.soldiers).toBeGreaterThan(0);
    expect(result.events.some((event) => event.type === "battle")).toBe(true);
  });

  it("applies only valid orders and ends by timeout when the clock expires", () => {
    const initial = createInitialFrontierState();
    const applied = applyFrontierCommandActions(initial, "ONE", [
      {
        type: "MOVE",
        armyId: "army-1",
        x: 25,
        y: 15,
      },
      {
        type: "ATTACK",
        armyId: "army-1",
        targetId: "missing-target",
      },
    ]);

    expect(applied.appliedActions).toEqual([
      {
        type: "MOVE",
        armyId: "army-1",
        x: 25,
        y: 15,
      },
    ]);

    const timeoutState = createInitialFrontierState();
    timeoutState.elapsedMs = FRONTIER_MATCH_DURATION_MS - FRONTIER_TICK_MS;
    timeoutState.armies[0]!.soldiers = 18;
    timeoutState.armies[1]!.soldiers = 9;

    const result = tickFrontierState(timeoutState, FRONTIER_TICK_MS, () => 0.5);

    expect(result.state.winner).toBe("ONE");
    expect(result.state.winnerReason).toBe("soldier-count");
  });
});
