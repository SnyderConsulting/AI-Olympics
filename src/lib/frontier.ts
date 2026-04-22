export const FRONTIER_MAP_WIDTH = 100;
export const FRONTIER_MAP_HEIGHT = 60;
export const FRONTIER_TICK_MS = 250;
export const FRONTIER_COMMAND_WINDOW_MS = 4_000;
export const FRONTIER_MATCH_DURATION_MS = 300_000;
export const FRONTIER_CAPTURE_RADIUS = 3;
export const FRONTIER_CAPTURE_DURATION_MS = 2_000;
export const FRONTIER_BASE_INCOME_PER_SECOND = 1;
export const FRONTIER_SITE_INCOME_PER_SECOND = 1;
export const FRONTIER_SPAWN_COST = 6;
export const FRONTIER_STARTING_SOLDIERS = 12;
export const FRONTIER_ARMY_SPEED = 6;
export const FRONTIER_MERGE_DISTANCE = 1;
export const FRONTIER_ENGAGE_DISTANCE = 1.5;
export const FRONTIER_ATTACKER_BONUS = 1.15;
export const FRONTIER_BASE_DEFENSE = 8;
export const FRONTIER_BASE_BONUS = 1.25;

export type FrontierOwner = "ONE" | "TWO";
export type FrontierWinner = FrontierOwner | "DRAW";
export type FrontierWinnerReason = "base-destroyed" | "soldier-count" | "site-control" | "draw";

export type FrontierBase = {
  id: string;
  owner: FrontierOwner;
  x: number;
  y: number;
  alive: boolean;
};

export type FrontierSite = {
  id: string;
  x: number;
  y: number;
  controller: FrontierOwner | null;
  captureOwner: FrontierOwner | null;
  captureProgressMs: number;
};

export type FrontierArmyOrder =
  | { type: "IDLE" }
  | { type: "MOVE"; x: number; y: number }
  | { type: "ATTACK"; targetId: string };

export type FrontierArmy = {
  id: string;
  owner: FrontierOwner;
  soldiers: number;
  x: number;
  y: number;
  order: FrontierArmyOrder;
};

export type FrontierMoveAction = {
  type: "MOVE";
  armyId: string;
  x: number;
  y: number;
};

export type FrontierAttackAction = {
  type: "ATTACK";
  armyId: string;
  targetId: string;
};

export type FrontierAction = FrontierMoveAction | FrontierAttackAction;

export type FrontierPendingCommandSet = {
  windowIndex: number;
  actions: FrontierAction[];
};

export type FrontierState = {
  elapsedMs: number;
  income: Record<FrontierOwner, number>;
  bases: FrontierBase[];
  sites: FrontierSite[];
  armies: FrontierArmy[];
  pendingCommands: Record<FrontierOwner, FrontierPendingCommandSet | null>;
  nextArmySequence: number;
  winner: FrontierWinner | null;
  winnerReason: FrontierWinnerReason | null;
};

export type FrontierSimulationEvent =
  | {
      type: "spawn";
      owner: FrontierOwner;
      soldiers: number;
      armyId: string;
    }
  | {
      type: "merge";
      owner: FrontierOwner;
      targetArmyId: string;
      absorbedArmyId: string;
      resultingSoldiers: number;
    }
  | {
      type: "battle";
      location: { x: number; y: number };
      attackerId: string;
      defenderId: string;
      attackerOwner: FrontierOwner;
      defenderOwner: FrontierOwner;
      attackerSoldiers: number;
      defenderSoldiers: number;
      attackerRoll: number;
      defenderRoll: number;
      attackerBonusApplied: boolean;
      winnerOwner: FrontierOwner;
      winnerArmyId: string;
      survivors: number;
    }
  | {
      type: "site-captured";
      owner: FrontierOwner;
      siteId: string;
    }
  | {
      type: "base-destroyed";
      destroyedOwner: FrontierOwner;
      attackerOwner: FrontierOwner;
      attackerArmyId: string;
    }
  | {
      type: "match-ended";
      winner: FrontierWinner;
      winnerReason: FrontierWinnerReason;
    };

export type FrontierTickResult = {
  state: FrontierState;
  events: FrontierSimulationEvent[];
};

export type FrontierReplayVisual = {
  kind: "frontier";
  mapWidth: number;
  mapHeight: number;
  elapsedMs: number;
  income: Record<FrontierOwner, number>;
  winner: FrontierWinner | null;
  winnerReason: FrontierWinnerReason | null;
  bases: FrontierBase[];
  sites: FrontierSite[];
  armies: FrontierArmy[];
};

const FRONTIER_BASES: Record<FrontierOwner, { id: string; x: number; y: number; label: string }> = {
  ONE: {
    id: "one-base",
    x: 10,
    y: 30,
    label: "West",
  },
  TWO: {
    id: "two-base",
    x: 90,
    y: 30,
    label: "East",
  },
};

const FRONTIER_SITES: Array<{ id: string; x: number; y: number }> = [
  { id: "site_1", x: 25, y: 15 },
  { id: "site_2", x: 25, y: 45 },
  { id: "site_3", x: 50, y: 22 },
  { id: "site_4", x: 50, y: 38 },
  { id: "site_5", x: 75, y: 15 },
  { id: "site_6", x: 75, y: 45 },
];

const PREVIEW_ARMY_LIMIT = 4;

export const FRONTIER_RULES_TEXT =
  "Frontier is a simple real-time territory war game. Each side has one base, armies of soldiers, and resource sites on an open map. Bases always generate baseline income, controlled sites add more income, and soldiers spawn automatically at the base whenever enough income accrues. Agents only issue MOVE and ATTACK orders to whole army stacks. Orders persist until replaced. Combat resolves immediately and automatically when armies engage. The attacker gains a modest advantage unless both sides committed to the fight in the same command window. Bases are intentionally fragile enough that a territorial lead can convert into a real base kill. Win by destroying the enemy base, or if time expires by having more soldiers remaining, then more controlled sites.";

export function createInitialFrontierState(): FrontierState {
  return {
    elapsedMs: 0,
    income: {
      ONE: 0,
      TWO: 0,
    },
    bases: [
      {
        id: FRONTIER_BASES.ONE.id,
        owner: "ONE",
        x: FRONTIER_BASES.ONE.x,
        y: FRONTIER_BASES.ONE.y,
        alive: true,
      },
      {
        id: FRONTIER_BASES.TWO.id,
        owner: "TWO",
        x: FRONTIER_BASES.TWO.x,
        y: FRONTIER_BASES.TWO.y,
        alive: true,
      },
    ],
    sites: FRONTIER_SITES.map((site) => ({
      ...site,
      controller: null,
      captureOwner: null,
      captureProgressMs: 0,
    })),
    armies: [
      {
        id: "army-1",
        owner: "ONE",
        soldiers: FRONTIER_STARTING_SOLDIERS,
        x: FRONTIER_BASES.ONE.x,
        y: FRONTIER_BASES.ONE.y,
        order: { type: "IDLE" },
      },
      {
        id: "army-2",
        owner: "TWO",
        soldiers: FRONTIER_STARTING_SOLDIERS,
        x: FRONTIER_BASES.TWO.x,
        y: FRONTIER_BASES.TWO.y,
        order: { type: "IDLE" },
      },
    ],
    pendingCommands: {
      ONE: null,
      TWO: null,
    },
    nextArmySequence: 3,
    winner: null,
    winnerReason: null,
  };
}

export function parseFrontierState(stateJson: string): FrontierState {
  const parsed = JSON.parse(stateJson) as Partial<FrontierState>;
  const initial = createInitialFrontierState();

  return {
    elapsedMs: typeof parsed.elapsedMs === "number" ? parsed.elapsedMs : 0,
    income: {
      ONE: getIncomeValue(parsed.income, "ONE"),
      TWO: getIncomeValue(parsed.income, "TWO"),
    },
    bases: Array.isArray(parsed.bases) ? parsed.bases as FrontierBase[] : initial.bases,
    sites: Array.isArray(parsed.sites) ? parsed.sites as FrontierSite[] : initial.sites,
    armies: Array.isArray(parsed.armies) ? parsed.armies as FrontierArmy[] : initial.armies,
    pendingCommands: {
      ONE: parsePendingCommandSet(parsed.pendingCommands, "ONE"),
      TWO: parsePendingCommandSet(parsed.pendingCommands, "TWO"),
    },
    nextArmySequence:
      typeof parsed.nextArmySequence === "number" ? parsed.nextArmySequence : initial.nextArmySequence,
    winner:
      parsed.winner === "ONE" || parsed.winner === "TWO" || parsed.winner === "DRAW"
        ? parsed.winner
        : null,
    winnerReason:
      parsed.winnerReason === "base-destroyed" ||
      parsed.winnerReason === "soldier-count" ||
      parsed.winnerReason === "site-control" ||
      parsed.winnerReason === "draw"
        ? parsed.winnerReason
        : null,
  };
}

export function serializeFrontierState(state: FrontierState): string {
  return JSON.stringify(state);
}

export function createFrontierReplayVisual(state: FrontierState): FrontierReplayVisual {
  return {
    kind: "frontier",
    mapWidth: FRONTIER_MAP_WIDTH,
    mapHeight: FRONTIER_MAP_HEIGHT,
    elapsedMs: state.elapsedMs,
    income: {
      ONE: Number(state.income.ONE.toFixed(2)),
      TWO: Number(state.income.TWO.toFixed(2)),
    },
    winner: state.winner,
    winnerReason: state.winnerReason,
    bases: state.bases.map((base) => ({ ...base })),
    sites: state.sites.map((site) => ({ ...site })),
    armies: state.armies.map((army) => ({
      ...army,
      order: { ...army.order },
    })),
  };
}

export function parseFrontierReplayVisual(value: unknown): FrontierReplayVisual | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const visual = value as Partial<FrontierReplayVisual>;

  if (
    visual.kind !== "frontier" ||
    typeof visual.mapWidth !== "number" ||
    typeof visual.mapHeight !== "number" ||
    typeof visual.elapsedMs !== "number" ||
    !visual.income ||
    typeof visual.income !== "object" ||
    !Array.isArray(visual.bases) ||
    !Array.isArray(visual.sites) ||
    !Array.isArray(visual.armies)
  ) {
    return null;
  }

  return {
    kind: "frontier",
    mapWidth: visual.mapWidth,
    mapHeight: visual.mapHeight,
    elapsedMs: visual.elapsedMs,
    income: {
      ONE: getIncomeValue(visual.income as Partial<Record<FrontierOwner, number>>, "ONE"),
      TWO: getIncomeValue(visual.income as Partial<Record<FrontierOwner, number>>, "TWO"),
    },
    winner:
      visual.winner === "ONE" || visual.winner === "TWO" || visual.winner === "DRAW"
        ? visual.winner
        : null,
    winnerReason:
      visual.winnerReason === "base-destroyed" ||
      visual.winnerReason === "soldier-count" ||
      visual.winnerReason === "site-control" ||
      visual.winnerReason === "draw"
        ? visual.winnerReason
        : null,
    bases: visual.bases as FrontierBase[],
    sites: visual.sites as FrontierSite[],
    armies: visual.armies as FrontierArmy[],
  };
}

export function getFrontierOwner(isPlayerOne: boolean): FrontierOwner {
  return isPlayerOne ? "ONE" : "TWO";
}

export function getFrontierOwnerLabel(owner: FrontierOwner) {
  return FRONTIER_BASES[owner].label;
}

export function getFrontierOpponent(owner: FrontierOwner): FrontierOwner {
  return owner === "ONE" ? "TWO" : "ONE";
}

export function getFrontierWindowIndex(elapsedMs: number) {
  return Math.floor(elapsedMs / FRONTIER_COMMAND_WINDOW_MS);
}

export function getFrontierSecondsRemaining(state: FrontierState) {
  return Math.max(0, Math.ceil((FRONTIER_MATCH_DURATION_MS - state.elapsedMs) / 1000));
}

export function getFrontierSecondsUntilNextWindow(state: FrontierState) {
  const elapsedWithinWindow = state.elapsedMs % FRONTIER_COMMAND_WINDOW_MS;
  const remainingMs = FRONTIER_COMMAND_WINDOW_MS - elapsedWithinWindow;
  return Math.max(0, Number((remainingMs / 1000).toFixed(2)));
}

export function getFrontierIncomePerSecond(state: FrontierState, owner: FrontierOwner) {
  return FRONTIER_BASE_INCOME_PER_SECOND + state.sites.filter((site) => site.controller === owner).length * FRONTIER_SITE_INCOME_PER_SECOND;
}

export function renderFrontierBoard(state: FrontierState): string {
  const timeLine =
    `Time ${formatFrontierSeconds(state.elapsedMs / 1000)} / ${formatFrontierSeconds(FRONTIER_MATCH_DURATION_MS / 1000)} ` +
    `| Window ${getFrontierWindowIndex(state.elapsedMs)} ` +
    `| Next ${formatFrontierSeconds(getFrontierSecondsUntilNextWindow(state))}`;

  const baseOne = getFrontierBase(state, "ONE");
  const baseTwo = getFrontierBase(state, "TWO");
  const sitesLine = state.sites
    .map((site) => `${site.id}:${site.controller ? getFrontierOwnerLabel(site.controller).charAt(0) : "-"}`)
    .join(" ");

  return [
    timeLine,
    `Bases | West ${baseOne.alive ? "alive" : "destroyed"} | East ${baseTwo.alive ? "alive" : "destroyed"}`,
    `Income | West ${formatIncome(state.income.ONE)} (+${getFrontierIncomePerSecond(state, "ONE")}/s) | East ${formatIncome(state.income.TWO)} (+${getFrontierIncomePerSecond(state, "TWO")}/s)`,
    `Sites | ${sitesLine}`,
    `West armies | ${formatFrontierArmyPreview(state.armies.filter((army) => army.owner === "ONE"))}`,
    `East armies | ${formatFrontierArmyPreview(state.armies.filter((army) => army.owner === "TWO"))}`,
  ].join("\n");
}

export function applyFrontierCommandActions(
  state: FrontierState,
  owner: FrontierOwner,
  actions: FrontierAction[],
) {
  const nextState = cloneFrontierState(state);
  const appliedActions: FrontierAction[] = [];

  for (const action of actions) {
    const army = nextState.armies.find((candidate) => candidate.id === action.armyId && candidate.owner === owner);

    if (!army) {
      continue;
    }

    if (action.type === "MOVE") {
      army.order = {
        type: "MOVE",
        x: clamp(action.x, 0, FRONTIER_MAP_WIDTH),
        y: clamp(action.y, 0, FRONTIER_MAP_HEIGHT),
      };
      appliedActions.push({
        type: "MOVE",
        armyId: action.armyId,
        x: army.order.x,
        y: army.order.y,
      });
      continue;
    }

    if (getFrontierTarget(nextState, action.targetId, owner)) {
      army.order = {
        type: "ATTACK",
        targetId: action.targetId,
      };
      appliedActions.push(action);
    }
  }

  return {
    state: nextState,
    appliedActions,
  };
}

export function tickFrontierState(
  state: FrontierState,
  deltaMs: number,
  random = Math.random,
): FrontierTickResult {
  const nextState = cloneFrontierState(state);
  const events: FrontierSimulationEvent[] = [];

  if (nextState.winner) {
    nextState.elapsedMs = Math.min(FRONTIER_MATCH_DURATION_MS, nextState.elapsedMs + deltaMs);
    return { state: nextState, events };
  }

  accrueFrontierIncome(nextState, deltaMs, events);
  moveFrontierArmies(nextState, deltaMs);
  mergeFriendlyFrontierArmies(nextState, events);
  resolveFrontierArmyBattles(nextState, events, random);
  resolveFrontierBaseAttacks(nextState, events, random);
  updateFrontierSiteCapture(nextState, deltaMs, events);

  nextState.elapsedMs = Math.min(FRONTIER_MATCH_DURATION_MS, nextState.elapsedMs + deltaMs);

  if (!nextState.winner && nextState.elapsedMs >= FRONTIER_MATCH_DURATION_MS) {
    const finalResult = determineFrontierWinnerOnTimeout(nextState);
    nextState.winner = finalResult.winner;
    nextState.winnerReason = finalResult.reason;
    events.push({
      type: "match-ended",
      winner: finalResult.winner,
      winnerReason: finalResult.reason,
    });
  }

  return {
    state: nextState,
    events,
  };
}

function accrueFrontierIncome(
  state: FrontierState,
  deltaMs: number,
  events: FrontierSimulationEvent[],
) {
  for (const owner of ["ONE", "TWO"] as const) {
    state.income[owner] += getFrontierIncomePerSecond(state, owner) * (deltaMs / 1000);

    const spawnedSoldiers = Math.floor(state.income[owner] / FRONTIER_SPAWN_COST);

    if (spawnedSoldiers <= 0) {
      continue;
    }

    state.income[owner] -= spawnedSoldiers * FRONTIER_SPAWN_COST;
    const base = getFrontierBase(state, owner);
    const baseArmy = state.armies.find((army) => army.owner === owner && distance(army, base) <= FRONTIER_MERGE_DISTANCE);

    if (baseArmy) {
      baseArmy.soldiers += spawnedSoldiers;
      events.push({
        type: "spawn",
        owner,
        soldiers: spawnedSoldiers,
        armyId: baseArmy.id,
      });
      continue;
    }

    const newArmyId = `army-${state.nextArmySequence}`;
    state.nextArmySequence += 1;
    state.armies.push({
      id: newArmyId,
      owner,
      soldiers: spawnedSoldiers,
      x: base.x,
      y: base.y,
      order: { type: "IDLE" },
    });
    events.push({
      type: "spawn",
      owner,
      soldiers: spawnedSoldiers,
      armyId: newArmyId,
    });
  }
}

function moveFrontierArmies(state: FrontierState, deltaMs: number) {
  for (const army of state.armies) {
    const target = getFrontierOrderTarget(state, army);

    if (!target) {
      continue;
    }

    moveFrontierArmyToward(army, target, deltaMs);
  }
}

function mergeFriendlyFrontierArmies(state: FrontierState, events: FrontierSimulationEvent[]) {
  let merged = true;

  while (merged) {
    merged = false;

    for (let index = 0; index < state.armies.length; index += 1) {
      const army = state.armies[index];

      for (let otherIndex = index + 1; otherIndex < state.armies.length; otherIndex += 1) {
        const otherArmy = state.armies[otherIndex];

        if (army.owner !== otherArmy.owner || distance(army, otherArmy) > FRONTIER_MERGE_DISTANCE) {
          continue;
        }

        const [targetArmy, absorbedArmy] =
          army.id.localeCompare(otherArmy.id) <= 0 ? [army, otherArmy] : [otherArmy, army];

        targetArmy.soldiers += absorbedArmy.soldiers;
        state.armies = state.armies.filter((candidate) => candidate.id !== absorbedArmy.id);
        events.push({
          type: "merge",
          owner: targetArmy.owner,
          targetArmyId: targetArmy.id,
          absorbedArmyId: absorbedArmy.id,
          resultingSoldiers: targetArmy.soldiers,
        });
        merged = true;
        break;
      }

      if (merged) {
        break;
      }
    }
  }
}

function resolveFrontierArmyBattles(
  state: FrontierState,
  events: FrontierSimulationEvent[],
  random: () => number,
) {
  let battleOccurred = true;

  while (battleOccurred) {
    battleOccurred = false;

    outer: for (const army of [...state.armies]) {
      for (const enemyArmy of state.armies) {
        if (army.id === enemyArmy.id || army.owner === enemyArmy.owner) {
          continue;
        }

        if (distance(army, enemyArmy) > FRONTIER_ENGAGE_DISTANCE) {
          continue;
        }

        const battle = resolveFrontierArmyBattle(state, army.id, enemyArmy.id, random);

        if (!battle) {
          continue;
        }

        events.push(battle.event);
        battleOccurred = true;
        break outer;
      }
    }
  }
}

function resolveFrontierBaseAttacks(
  state: FrontierState,
  events: FrontierSimulationEvent[],
  random: () => number,
) {
  if (state.winner) {
    return;
  }

  const destroyedOwners = new Set<FrontierOwner>();

  for (const owner of ["ONE", "TWO"] as const) {
    const defendingBase = getFrontierBase(state, owner);

    if (!defendingBase.alive) {
      continue;
    }

    const attackers = state.armies
      .filter((army) => {
        return (
          army.owner !== owner &&
          army.order.type === "ATTACK" &&
          army.order.targetId === defendingBase.id &&
          distance(army, defendingBase) <= FRONTIER_ENGAGE_DISTANCE
        );
      })
      .sort((left, right) => right.soldiers - left.soldiers);

    for (const attacker of attackers) {
      if (!defendingBase.alive) {
        break;
      }

      const rngArmy = toFrontierBattleRoll(random());
      const rngBase = toFrontierBattleRoll(random());
      const armyStrength = attacker.soldiers * FRONTIER_ATTACKER_BONUS * rngArmy;
      const baseStrength = FRONTIER_BASE_DEFENSE * FRONTIER_BASE_BONUS * rngBase;

      if (armyStrength > baseStrength) {
        defendingBase.alive = false;
        state.armies = state.armies.filter((candidate) => candidate.id !== attacker.id);
        destroyedOwners.add(owner);
        events.push({
          type: "base-destroyed",
          destroyedOwner: owner,
          attackerOwner: attacker.owner,
          attackerArmyId: attacker.id,
        });
        continue;
      }

      state.armies = state.armies.filter((candidate) => candidate.id !== attacker.id);
      events.push({
        type: "battle",
        location: { x: defendingBase.x, y: defendingBase.y },
        attackerId: attacker.id,
        defenderId: defendingBase.id,
        attackerOwner: attacker.owner,
        defenderOwner: owner,
        attackerSoldiers: attacker.soldiers,
        defenderSoldiers: FRONTIER_BASE_DEFENSE,
        attackerRoll: rngArmy,
        defenderRoll: rngBase,
        attackerBonusApplied: true,
        winnerOwner: owner,
        winnerArmyId: defendingBase.id,
        survivors: FRONTIER_BASE_DEFENSE,
      });
    }
  }

  if (destroyedOwners.size === 2) {
    state.winner = "DRAW";
    state.winnerReason = "base-destroyed";
    events.push({
      type: "match-ended",
      winner: "DRAW",
      winnerReason: "base-destroyed",
    });
    return;
  }

  if (destroyedOwners.size === 1) {
    const destroyedOwner = [...destroyedOwners][0];
    const winnerOwner = getFrontierOpponent(destroyedOwner);
    state.winner = winnerOwner;
    state.winnerReason = "base-destroyed";
    events.push({
      type: "match-ended",
      winner: winnerOwner,
      winnerReason: "base-destroyed",
    });
  }
}

function updateFrontierSiteCapture(
  state: FrontierState,
  deltaMs: number,
  events: FrontierSimulationEvent[],
) {
  for (const site of state.sites) {
    const occupiers = new Set(
      state.armies
        .filter((army) => distance(army, site) <= FRONTIER_CAPTURE_RADIUS)
        .map((army) => army.owner),
    );

    if (occupiers.size !== 1) {
      site.captureOwner = null;
      site.captureProgressMs = 0;
      continue;
    }

    const [occupyingOwner] = [...occupiers];

    if (site.controller === occupyingOwner) {
      site.captureOwner = null;
      site.captureProgressMs = 0;
      continue;
    }

    if (site.captureOwner !== occupyingOwner) {
      site.captureOwner = occupyingOwner;
      site.captureProgressMs = 0;
    }

    site.captureProgressMs += deltaMs;

    if (site.captureProgressMs < FRONTIER_CAPTURE_DURATION_MS) {
      continue;
    }

    site.controller = occupyingOwner;
    site.captureOwner = null;
    site.captureProgressMs = 0;
    events.push({
      type: "site-captured",
      owner: occupyingOwner,
      siteId: site.id,
    });
  }
}

function determineFrontierWinnerOnTimeout(state: FrontierState) {
  const westSoldiers = countFrontierSoldiers(state, "ONE");
  const eastSoldiers = countFrontierSoldiers(state, "TWO");

  if (westSoldiers !== eastSoldiers) {
    return {
      winner: westSoldiers > eastSoldiers ? ("ONE" as const) : ("TWO" as const),
      reason: "soldier-count" as const,
    };
  }

  const westSites = countControlledSites(state, "ONE");
  const eastSites = countControlledSites(state, "TWO");

  if (westSites !== eastSites) {
    return {
      winner: westSites > eastSites ? ("ONE" as const) : ("TWO" as const),
      reason: "site-control" as const,
    };
  }

  return {
    winner: "DRAW" as const,
    reason: "draw" as const,
  };
}

function resolveFrontierArmyBattle(
  state: FrontierState,
  armyId: string,
  enemyArmyId: string,
  random: () => number,
) {
  const army = state.armies.find((candidate) => candidate.id === armyId);
  const enemyArmy = state.armies.find((candidate) => candidate.id === enemyArmyId);

  if (!army || !enemyArmy || army.owner === enemyArmy.owner) {
    return null;
  }

  const armyInitiated = army.order.type === "ATTACK" && army.order.targetId === enemyArmy.id;
  const enemyInitiated = enemyArmy.order.type === "ATTACK" && enemyArmy.order.targetId === army.id;
  const attacker = armyInitiated && !enemyInitiated ? army : enemyInitiated && !armyInitiated ? enemyArmy : army;
  const defender = attacker.id === army.id ? enemyArmy : army;
  const attackerBonusApplied = armyInitiated !== enemyInitiated;

  const attackerRoll = toFrontierBattleRoll(random());
  const defenderRoll = toFrontierBattleRoll(random());
  const attackerStrength =
    attacker.soldiers * attackerRoll * (attackerBonusApplied ? FRONTIER_ATTACKER_BONUS : 1);
  const defenderStrength = defender.soldiers * defenderRoll;
  const winner = attackerStrength > defenderStrength ? attacker : defender;
  const loser = winner.id === attacker.id ? defender : attacker;
  const winnerStrength = winner.id === attacker.id ? attackerStrength : defenderStrength;
  const loserStrength = winner.id === attacker.id ? defenderStrength : attackerStrength;
  const survivors = Math.max(
    1,
    Math.ceil(winner.soldiers * ((winnerStrength - loserStrength) / winnerStrength)),
  );

  const winnerArmy = state.armies.find((candidate) => candidate.id === winner.id);

  if (!winnerArmy) {
    return null;
  }

  winnerArmy.soldiers = survivors;
  winnerArmy.order = { type: "IDLE" };
  state.armies = state.armies.filter((candidate) => candidate.id !== loser.id);

  return {
    event: {
      type: "battle" as const,
      location: {
        x: Number(((army.x + enemyArmy.x) / 2).toFixed(2)),
        y: Number(((army.y + enemyArmy.y) / 2).toFixed(2)),
      },
      attackerId: attacker.id,
      defenderId: defender.id,
      attackerOwner: attacker.owner,
      defenderOwner: defender.owner,
      attackerSoldiers: attacker.soldiers,
      defenderSoldiers: defender.soldiers,
      attackerRoll,
      defenderRoll,
      attackerBonusApplied,
      winnerOwner: winner.owner,
      winnerArmyId: winner.id,
      survivors,
    },
  };
}

function getFrontierOrderTarget(state: FrontierState, army: FrontierArmy) {
  if (army.order.type === "IDLE") {
    return null;
  }

  if (army.order.type === "MOVE") {
    return {
      x: army.order.x,
      y: army.order.y,
    };
  }

  return getFrontierTarget(state, army.order.targetId, army.owner);
}

function getFrontierTarget(state: FrontierState, targetId: string, owner: FrontierOwner) {
  const targetArmy = state.armies.find((army) => army.id === targetId && army.owner !== owner);

  if (targetArmy) {
    return {
      x: targetArmy.x,
      y: targetArmy.y,
    };
  }

  const targetSite = state.sites.find((site) => site.id === targetId);

  if (targetSite) {
    return {
      x: targetSite.x,
      y: targetSite.y,
    };
  }

  const targetBase = state.bases.find((base) => base.id === targetId && base.owner !== owner && base.alive);

  if (targetBase) {
    return {
      x: targetBase.x,
      y: targetBase.y,
    };
  }

  return null;
}

function moveFrontierArmyToward(
  army: FrontierArmy,
  target: { x: number; y: number },
  deltaMs: number,
) {
  const travelDistance = FRONTIER_ARMY_SPEED * (deltaMs / 1000);
  const totalDistance = distance(army, target);

  if (totalDistance <= travelDistance || totalDistance === 0) {
    army.x = target.x;
    army.y = target.y;
    return;
  }

  const ratio = travelDistance / totalDistance;
  army.x = roundPosition(army.x + (target.x - army.x) * ratio);
  army.y = roundPosition(army.y + (target.y - army.y) * ratio);
}

function cloneFrontierState(state: FrontierState): FrontierState {
  return {
    elapsedMs: state.elapsedMs,
    income: {
      ONE: state.income.ONE,
      TWO: state.income.TWO,
    },
    bases: state.bases.map((base) => ({ ...base })),
    sites: state.sites.map((site) => ({ ...site })),
    armies: state.armies.map((army) => ({
      ...army,
      order: { ...army.order },
    })),
    pendingCommands: {
      ONE: clonePendingCommandSet(state.pendingCommands.ONE),
      TWO: clonePendingCommandSet(state.pendingCommands.TWO),
    },
    nextArmySequence: state.nextArmySequence,
    winner: state.winner,
    winnerReason: state.winnerReason,
  };
}

function getFrontierBase(state: FrontierState, owner: FrontierOwner) {
  const base = state.bases.find((candidate) => candidate.owner === owner);

  if (!base) {
    throw new Error(`Missing frontier base for ${owner}.`);
  }

  return base;
}

function countFrontierSoldiers(state: FrontierState, owner: FrontierOwner) {
  return state.armies
    .filter((army) => army.owner === owner)
    .reduce((sum, army) => sum + army.soldiers, 0);
}

function countControlledSites(state: FrontierState, owner: FrontierOwner) {
  return state.sites.filter((site) => site.controller === owner).length;
}

function getIncomeValue(
  income: Partial<Record<FrontierOwner, number>> | undefined,
  owner: FrontierOwner,
) {
  if (!income || typeof income[owner] !== "number") {
    return 0;
  }

  return income[owner] ?? 0;
}

function parsePendingCommandSet(
  value: unknown,
  owner: FrontierOwner,
): FrontierPendingCommandSet | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const pendingByOwner = value as Partial<Record<FrontierOwner, unknown>>;
  const pending = pendingByOwner[owner];

  if (!pending || typeof pending !== "object") {
    return null;
  }

  const parsed = pending as Partial<FrontierPendingCommandSet>;

  if (
    typeof parsed.windowIndex !== "number" ||
    !Array.isArray(parsed.actions)
  ) {
    return null;
  }

  return {
    windowIndex: parsed.windowIndex,
    actions: parsed.actions.filter(isFrontierAction),
  };
}

function clonePendingCommandSet(
  pending: FrontierPendingCommandSet | null,
): FrontierPendingCommandSet | null {
  if (!pending) {
    return null;
  }

  return {
    windowIndex: pending.windowIndex,
    actions: pending.actions.map((action) => ({ ...action })),
  };
}

function isFrontierAction(value: unknown): value is FrontierAction {
  if (!value || typeof value !== "object") {
    return false;
  }

  const action = value as Partial<FrontierAction>;

  if (
    action.type === "MOVE" &&
    typeof action.armyId === "string" &&
    typeof action.x === "number" &&
    typeof action.y === "number"
  ) {
    return true;
  }

  return (
    action.type === "ATTACK" &&
    typeof action.armyId === "string" &&
    typeof action.targetId === "string"
  );
}

function formatFrontierArmyPreview(armies: FrontierArmy[]) {
  if (armies.length === 0) {
    return "none";
  }

  const preview = armies
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, PREVIEW_ARMY_LIMIT)
    .map((army) => {
      return `${army.id}:${army.soldiers}@${roundPosition(army.x)},${roundPosition(army.y)} ${formatFrontierOrderPreview(army.order)}`;
    });

  const remainingCount = armies.length - preview.length;

  if (remainingCount > 0) {
    preview.push(`+${remainingCount} more`);
  }

  return preview.join(" | ");
}

function formatFrontierOrderPreview(order: FrontierArmyOrder) {
  if (order.type === "IDLE") {
    return "idle";
  }

  if (order.type === "MOVE") {
    return `move(${roundPosition(order.x)},${roundPosition(order.y)})`;
  }

  return `attack(${order.targetId})`;
}

function formatFrontierSeconds(value: number) {
  return `${value.toFixed(1)}s`;
}

function formatIncome(value: number) {
  return value.toFixed(2);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function toFrontierBattleRoll(value: number) {
  return Number((0.9 + value * 0.2).toFixed(3));
}

function roundPosition(value: number) {
  return Number(value.toFixed(1));
}

function distance(
  left: { x: number; y: number },
  right: { x: number; y: number },
) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
