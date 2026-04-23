import { describe, expect, it } from "vitest";

import { chooseDominantFrontierActions } from "@/lib/frontier-bot";
import { createInitialFrontierState, type FrontierLayout } from "@/lib/frontier";

const TEST_LAYOUT: FrontierLayout = {
  bases: [
    { id: "one-base", owner: "ONE", x: 16, y: 20 },
    { id: "two-base", owner: "TWO", x: 84, y: 20 },
  ],
  sites: [
    { id: "site_1", x: 30, y: 10 },
    { id: "site_2", x: 34, y: 20 },
    { id: "site_3", x: 30, y: 30 },
    { id: "site_4", x: 70, y: 10 },
    { id: "site_5", x: 66, y: 20 },
    { id: "site_6", x: 70, y: 30 },
  ],
};

describe("frontier-bot", () => {
  it("pushes for a lethal base attack when the enemy base is exposed", () => {
    const state = createInitialFrontierState({ layout: TEST_LAYOUT });
    const enemyBase = state.bases.find((base) => base.owner === "TWO")!;

    state.armies[0]!.x = enemyBase.x - 1;
    state.armies[0]!.y = enemyBase.y;
    state.armies[0]!.soldiers = 8;
    enemyBase.health = 6;
    state.armies[1]!.soldiers = 0;

    const actions = chooseDominantFrontierActions({
      state,
      owner: "ONE",
    });

    expect(actions).toContainEqual({
      type: "ATTACK",
      armyId: "army-1",
      targetId: "two-base",
    });
  });

  it("opens by contesting a resource site instead of idling", () => {
    const state = createInitialFrontierState({ layout: TEST_LAYOUT });

    const actions = chooseDominantFrontierActions({
      state,
      owner: "ONE",
    });

    expect(actions.some((action) => {
      return action.type === "ATTACK" && action.targetId.startsWith("site_");
    })).toBe(true);
  });

  it("does not rush the enemy base early before securing map control", () => {
    const state = createInitialFrontierState({ layout: TEST_LAYOUT });

    state.elapsedMs = 8_000;
    state.armies[0]!.x = 42;
    state.armies[0]!.y = 20;
    state.armies[0]!.soldiers = 12;
    state.armies[1]!.x = 58;
    state.armies[1]!.y = 20;
    state.armies[1]!.soldiers = 12;
    state.sites[0]!.controller = "ONE";
    state.sites[3]!.controller = "TWO";
    state.income = {
      ONE: 2,
      TWO: 2,
    };

    const actions = chooseDominantFrontierActions({
      state,
      owner: "ONE",
    });

    expect(actions.some((action) => {
      return action.type === "ATTACK" && action.targetId === "two-base";
    })).toBe(false);
  });

  it("prioritizes intercepting an enemy army threatening the base", () => {
    const state = createInitialFrontierState({ layout: TEST_LAYOUT });
    const ownBase = state.bases.find((base) => base.owner === "ONE")!;

    state.armies[1]!.x = ownBase.x + 3;
    state.armies[1]!.y = ownBase.y;
    state.armies[1]!.soldiers = 7;
    state.armies[1]!.order = { type: "ATTACK", targetId: ownBase.id };

    const actions = chooseDominantFrontierActions({
      state,
      owner: "ONE",
    });

    expect(actions.some((action) => {
      return action.type === "ATTACK" && action.targetId.startsWith("site_");
    })).toBe(false);
    expect(actions.some((action) => {
      return action.type === "ATTACK" && action.targetId === "two-base";
    })).toBe(false);
  });
});
