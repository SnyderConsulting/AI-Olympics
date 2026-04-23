import { describe, expect, it } from "vitest";

import {
  applyFrontierCommandActions,
  createInitialFrontierState,
  FRONTIER_CAPTURE_DURATION_MS,
  FRONTIER_MAP_WIDTH,
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
    const westBase = state.bases.find((base) => base.owner === "ONE");
    const eastBase = state.bases.find((base) => base.owner === "TWO");

    expect(board).toContain("Time 0.0s / 300.0s");
    expect(board).toContain("Bases | West 12.0/12 alive | East 12.0/12 alive");
    expect(board).toContain(`West armies | army-1:12@${westBase?.x},${westBase?.y} idle`);
    expect(board).toContain(`East armies | army-2:12@${eastBase?.x},${eastBase?.y} idle`);
    expect(parseFrontierState(serializeFrontierState(state))).toEqual(state);
  });

  it("hydrates legacy frontier state without explicit base health", () => {
    const legacy = JSON.stringify({
      elapsedMs: 0,
      income: { ONE: 0, TWO: 0 },
      bases: [
        { id: "one-base", owner: "ONE", x: 10, y: 30, alive: true },
        { id: "two-base", owner: "TWO", x: 90, y: 30, alive: false },
      ],
      sites: [],
      armies: [],
      pendingCommands: { ONE: null, TWO: null },
      nextArmySequence: 3,
      winner: null,
      winnerReason: null,
    });

    const parsed = parseFrontierState(legacy);

    expect(parsed.bases.find((base) => base.owner === "ONE")).toMatchObject({
      health: 12,
      maxHealth: 12,
      alive: true,
    });
    expect(parsed.bases.find((base) => base.owner === "TWO")).toMatchObject({
      health: 0,
      maxHealth: 12,
      alive: false,
    });
  });

  it("keeps generated layouts distance-symmetric for both seats", () => {
    for (let index = 0; index < 10; index += 1) {
      const state = createInitialFrontierState();
      const westBase = state.bases.find((base) => base.owner === "ONE");
      const eastBase = state.bases.find((base) => base.owner === "TWO");

      expect(westBase).toBeDefined();
      expect(eastBase).toBeDefined();
      expect(westBase?.x).toBe(FRONTIER_MAP_WIDTH - (eastBase?.x ?? 0));
      expect(westBase?.y).toBe(eastBase?.y);

      const westDistances = state.sites
        .map((site) => Math.hypot(site.x - westBase!.x, site.y - westBase!.y).toFixed(2))
        .sort();
      const eastDistances = state.sites
        .map((site) => Math.hypot(site.x - eastBase!.x, site.y - eastBase!.y).toFixed(2))
        .sort();

      expect(westDistances).toEqual(eastDistances);
    }
  });

  it("captures a site after uncontested occupation", () => {
    const initial = createInitialFrontierState();
    const targetSite = initial.sites[0]!;
    initial.armies[0]!.x = targetSite.x;
    initial.armies[0]!.y = targetSite.y;
    initial.armies[0]!.order = { type: "IDLE" };

    const result = tickFrontierState(initial, FRONTIER_CAPTURE_DURATION_MS);
    const capturedSite = result.state.sites.find((site) => site.id === targetSite.id);

    expect(capturedSite?.controller).toBe("ONE");
    expect(result.events).toContainEqual({
      type: "site-captured",
      owner: "ONE",
      siteId: targetSite.id,
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

  it("damages bases over time and destroys them after sustained attacks", () => {
    const initial = createInitialFrontierState();
    const eastBase = initial.bases.find((base) => base.owner === "TWO");

    expect(eastBase).toBeDefined();

    initial.armies[0]!.x = (eastBase?.x ?? 0) - 1;
    initial.armies[0]!.y = eastBase?.y ?? 0;
    initial.armies[0]!.soldiers = 12;
    initial.armies[0]!.order = { type: "ATTACK", targetId: eastBase?.id ?? "two-base" };
    initial.armies[1]!.x = 10;
    initial.armies[1]!.y = 30;
    initial.armies[1]!.soldiers = 0;

    const firstTick = tickFrontierState(initial, FRONTIER_TICK_MS, () => 0.5);
    const eastBaseAfterFirstTick = firstTick.state.bases.find((base) => base.owner === "TWO");

    expect(eastBaseAfterFirstTick?.health).toBe(9);
    expect(firstTick.state.winner).toBeNull();
    expect(firstTick.events).toContainEqual({
      type: "base-damaged",
      damagedOwner: "TWO",
      attackerOwner: "ONE",
      attackerArmyId: "army-1",
      damage: 3,
      remainingHealth: 9,
    });

    const secondTick = tickFrontierState(firstTick.state, FRONTIER_TICK_MS, () => 0.5);
    const thirdTick = tickFrontierState(secondTick.state, FRONTIER_TICK_MS, () => 0.5);
    const fourthTick = tickFrontierState(thirdTick.state, FRONTIER_TICK_MS, () => 0.5);
    const eastBaseAfterFourthTick = fourthTick.state.bases.find((base) => base.owner === "TWO");

    expect(eastBaseAfterFourthTick?.alive).toBe(false);
    expect(eastBaseAfterFourthTick?.health).toBe(0);
    expect(fourthTick.state.winner).toBe("ONE");
    expect(fourthTick.state.winnerReason).toBe("base-destroyed");
    expect(fourthTick.events.some((event) => event.type === "base-destroyed")).toBe(true);
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
