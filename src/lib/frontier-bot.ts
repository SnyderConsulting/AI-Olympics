import {
  applyFrontierCommandActions,
  FRONTIER_ARMY_SPEED,
  FRONTIER_ATTACKER_BONUS,
  FRONTIER_BASE_DAMAGE_PER_SOLDIER_PER_SECOND,
  FRONTIER_COMMAND_WINDOW_MS,
  FRONTIER_ENGAGE_DISTANCE,
  getFrontierIncomePerSecond,
  getFrontierOpponent,
  tickFrontierState,
  type FrontierAction,
  type FrontierArmy,
  type FrontierBase,
  type FrontierOwner,
  type FrontierState,
} from "@/lib/frontier";

const BEAM_WIDTH = 12;
const QUICK_ROLLOUT_WINDOWS = 1;
const FINAL_ROLLOUT_WINDOWS = 2;
const FINAL_ROLLOUT_SEEDS = [7, 29, 61];
const QUICK_ROLLOUT_SEED = 17;
const MAX_SITE_OPTIONS = 2;
const MAX_ARMY_OPTIONS = 2;
const BASE_ATTACK_MIN_SOLDIERS = 4;
const BASE_THREAT_RADIUS = 24;
const BASE_DANGER_RADIUS = 16;
const IMMEDIATE_BASE_THREAT_SECONDS = 6;
const EARLY_BASE_RUSH_LOCK_MS = 60_000;
const MIN_HOME_GUARD_SOLDIERS = 4;
const MIN_STABLE_SITE_ADVANTAGE = 2;
const MIN_STABLE_SOLDIER_ADVANTAGE = 4;

type FrontierBundleCandidate = {
  actions: FrontierAction[];
  score: number;
};

export function chooseDominantFrontierActions(args: {
  state: FrontierState;
  owner: FrontierOwner;
}): FrontierAction[] {
  if (args.state.winner) {
    return [];
  }

  const ownArmies = getArmies(args.state, args.owner).sort(compareArmiesForControl);

  if (ownArmies.length === 0) {
    return [];
  }

  let beams: FrontierBundleCandidate[] = [{ actions: [], score: evaluateRolloutBundle({
    state: args.state,
    owner: args.owner,
    actions: [],
    windows: QUICK_ROLLOUT_WINDOWS,
    seeds: [QUICK_ROLLOUT_SEED],
  }) }];

  for (const army of ownArmies) {
    const options = generateArmyActionOptions(args.state, args.owner, army);
    const nextByKey = new Map<string, FrontierBundleCandidate>();

    for (const beam of beams) {
      for (const option of options) {
        const actions = option ? upsertArmyAction(beam.actions, option) : beam.actions.slice();
        const key = serializeActionBundle(actions);
        const score = evaluateRolloutBundle({
          state: args.state,
          owner: args.owner,
          actions,
          windows: QUICK_ROLLOUT_WINDOWS,
          seeds: [QUICK_ROLLOUT_SEED],
        });
        const existing = nextByKey.get(key);

        if (!existing || score > existing.score) {
          nextByKey.set(key, { actions, score });
        }
      }
    }

    beams = [...nextByKey.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, BEAM_WIDTH);
  }

  const best = beams
    .map((beam) => ({
      actions: beam.actions,
      score: evaluateRolloutBundle({
        state: args.state,
        owner: args.owner,
        actions: beam.actions,
        windows: FINAL_ROLLOUT_WINDOWS,
        seeds: FINAL_ROLLOUT_SEEDS,
      }),
    }))
    .sort((left, right) => right.score - left.score)[0];

  return best?.actions ?? [];
}

export function chooseRuleBasedFrontierActions(args: {
  state: FrontierState;
  owner: FrontierOwner;
}): FrontierAction[] {
  return chooseStaticFrontierActions(args.state, args.owner);
}

function chooseStaticFrontierActions(
  state: FrontierState,
  owner: FrontierOwner,
) {
  const actions: FrontierAction[] = [];

  for (const army of getArmies(state, owner).sort(compareArmiesForControl)) {
    const options = generateArmyActionOptions(state, owner, army);
    const best = options
      .map((option) => ({
        action: option,
        score: evaluateStaticAction(state, owner, option),
      }))
      .sort((left, right) => right.score - left.score)[0];

    if (best?.action) {
      actions.push(best.action);
    }
  }

  return dedupeActions(actions);
}

function generateArmyActionOptions(
  state: FrontierState,
  owner: FrontierOwner,
  army: FrontierArmy,
): Array<FrontierAction | null> {
  const options = new Map<string, FrontierAction | null>();
  const ownBase = getBase(state, owner);
  const enemyBase = getBase(state, getFrontierOpponent(owner));
  const enemyThreats = getEnemyBaseThreats(state, owner);
  const strongestThreat = enemyThreats[0];

  options.set("keep", null);

  if (
    army.soldiers >= BASE_ATTACK_MIN_SOLDIERS &&
    shouldPressEnemyBase(state, owner, army, enemyBase)
  ) {
    options.set(
      `base:${army.id}`,
      { type: "ATTACK", armyId: army.id, targetId: enemyBase.id },
    );
  }

  if (strongestThreat) {
    options.set(
      `defend:${army.id}:${strongestThreat.id}`,
      { type: "ATTACK", armyId: army.id, targetId: strongestThreat.id },
    );
  }

  for (const site of selectSiteTargets(state, owner, army).slice(0, MAX_SITE_OPTIONS)) {
    options.set(
      `site:${army.id}:${site.id}`,
      { type: "ATTACK", armyId: army.id, targetId: site.id },
    );
  }

  for (const enemy of selectEnemyArmyTargets(state, owner, army).slice(0, MAX_ARMY_OPTIONS)) {
    options.set(
      `army:${army.id}:${enemy.id}`,
      { type: "ATTACK", armyId: army.id, targetId: enemy.id },
    );
  }

  if (distance(army, ownBase) > FRONTIER_ENGAGE_DISTANCE) {
    options.set(
      `home:${army.id}`,
      { type: "MOVE", armyId: army.id, x: ownBase.x, y: ownBase.y },
    );
  }

  return [...options.values()];
}

function selectSiteTargets(state: FrontierState, owner: FrontierOwner, army: FrontierArmy) {
  const opponent = getFrontierOpponent(owner);
  const enemyBase = getBase(state, opponent);

  return state.sites
    .filter((site) => site.controller !== owner)
    .map((site) => {
      const distanceToSite = distance(army, site);
      const closestEnemyDistance = getArmies(state, opponent)
        .map((enemy) => distance(enemy, site))
        .sort((left, right) => left - right)[0] ?? Number.POSITIVE_INFINITY;
      const reclaimBonus = site.controller === opponent ? 6 : 0;
      const score =
        40 +
        reclaimBonus +
        Math.max(0, closestEnemyDistance - distanceToSite) * 1.3 -
        distanceToSite -
        distance(site, enemyBase) * 0.1;

      return { site, score };
    })
    .sort((left, right) => right.score - left.score)
    .map((item) => item.site);
}

function selectEnemyArmyTargets(state: FrontierState, owner: FrontierOwner, army: FrontierArmy) {
  const ownBase = getBase(state, owner);
  const opponent = getFrontierOpponent(owner);

  return getArmies(state, opponent)
    .map((enemy) => {
      const attackerBonusApplied = enemy.order.type !== "ATTACK" || enemy.order.targetId !== army.id;
      const winMargin = estimateBattleMargin(army.soldiers, enemy.soldiers, attackerBonusApplied);
      const enemyThreatToBase = Math.max(0, BASE_DANGER_RADIUS - timeToTargetSeconds(enemy, ownBase)) * 3;
      const score =
        winMargin * 8 -
        distance(army, enemy) +
        enemyThreatToBase +
        (enemy.order.type === "ATTACK" && enemy.order.targetId === ownBase.id ? 12 : 0);

      return { enemy, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.enemy);
}

function evaluateRolloutBundle(args: {
  state: FrontierState;
  owner: FrontierOwner;
  actions: FrontierAction[];
  windows: number;
  seeds: number[];
}) {
  let total = 0;

  for (const seed of args.seeds) {
    let simulation = cloneFrontierStateForBot(args.state);
    let ownActions = args.actions;
    let random = createMulberry32(seed);

    for (let windowIndex = 0; windowIndex < args.windows && !simulation.winner; windowIndex += 1) {
      const opponent = getFrontierOpponent(args.owner);
      const enemyActions = chooseStaticFrontierActions(simulation, opponent);

      simulation = applyActionsForBothSides(simulation, args.owner, ownActions, enemyActions);
      simulation = tickFrontierState(simulation, FRONTIER_COMMAND_WINDOW_MS, random).state;

      if (simulation.winner) {
        break;
      }

      ownActions = chooseStaticFrontierActions(simulation, args.owner);
    }

    total += evaluateFrontierState(simulation, args.owner);
  }

  return total / args.seeds.length;
}

function evaluateStaticAction(
  state: FrontierState,
  owner: FrontierOwner,
  action: FrontierAction | null,
) {
  if (!action) {
    return 0;
  }

  const ownBase = getBase(state, owner);
  const enemyBase = getBase(state, getFrontierOpponent(owner));
  const army = state.armies.find((candidate) => candidate.id === action.armyId && candidate.owner === owner);

  if (!army) {
    return Number.NEGATIVE_INFINITY;
  }

  if (action.type === "MOVE") {
    return 12 - distance(army, { x: action.x, y: action.y }) * 0.8;
  }

  if (action.targetId === enemyBase.id) {
    return 70 + army.soldiers * 6 - timeToTargetSeconds(army, enemyBase) * 5 - scoreEnemyDanger(state, owner);
  }

  const site = state.sites.find((candidate) => candidate.id === action.targetId);

  if (site) {
    const reclaimBonus = site.controller === getFrontierOpponent(owner) ? 8 : 0;
    const enemyEta = closestArmyEta(state, getFrontierOpponent(owner), site);
    const ownEta = timeToTargetSeconds(army, site);
    return 40 + reclaimBonus + (enemyEta - ownEta) * 2 - distance(army, site) * 0.4;
  }

  const enemyArmy = state.armies.find(
    (candidate) => candidate.id === action.targetId && candidate.owner !== owner,
  );

  if (enemyArmy) {
    const attackerBonusApplied =
      enemyArmy.order.type !== "ATTACK" || enemyArmy.order.targetId !== army.id;
    const threatBonus =
      enemyArmy.order.type === "ATTACK" && enemyArmy.order.targetId === ownBase.id ? 12 : 0;
    return estimateBattleMargin(army.soldiers, enemyArmy.soldiers, attackerBonusApplied) * 8 + threatBonus - distance(army, enemyArmy);
  }

  return 0;
}

function applyActionsForBothSides(
  state: FrontierState,
  owner: FrontierOwner,
  ownActions: FrontierAction[],
  enemyActions: FrontierAction[],
) {
  const opponent = getFrontierOpponent(owner);
  const ownApplied = applyFrontierCommandActions(state, owner, ownActions).state;
  return applyFrontierCommandActions(ownApplied, opponent, enemyActions).state;
}

function evaluateFrontierState(state: FrontierState, owner: FrontierOwner) {
  const opponent = getFrontierOpponent(owner);
  const ownBase = getBase(state, owner);
  const enemyBase = getBase(state, opponent);
  const ownSoldiers = getArmies(state, owner).reduce((sum, army) => sum + army.soldiers, 0);
  const enemySoldiers = getArmies(state, opponent).reduce((sum, army) => sum + army.soldiers, 0);
  const ownSites = state.sites.filter((site) => site.controller === owner).length;
  const enemySites = state.sites.filter((site) => site.controller === opponent).length;
  const ownIncomeRate = getFrontierIncomePerSecond(state, owner);
  const enemyIncomeRate = getFrontierIncomePerSecond(state, opponent);

  if (state.winner === owner) {
    return 100_000 + ownBase.health * 1_000 + ownSoldiers * 20;
  }

  if (state.winner === opponent) {
    return -100_000 - enemyBase.health * 1_000 - enemySoldiers * 20;
  }

  if (state.winner === "DRAW") {
    return -2_000 + (ownBase.health - enemyBase.health) * 50;
  }

  return (
    (ownBase.health - enemyBase.health) * 700 +
    (ownSoldiers - enemySoldiers) * 22 +
    (ownSites - enemySites) * 90 +
    (ownIncomeRate - enemyIncomeRate) * 80 +
    (state.income[owner] - state.income[opponent]) * 4 +
    scoreBasePressure(state, owner) * 45 -
    scoreBasePressure(state, opponent) * 55 +
    scoreSiteRace(state, owner) * 20 -
    scoreSiteRace(state, opponent) * 20
  );
}

function scoreBasePressure(state: FrontierState, owner: FrontierOwner) {
  const enemyBase = getBase(state, getFrontierOpponent(owner));

  return getArmies(state, owner).reduce((sum, army) => {
    const eta = timeToTargetSeconds(army, enemyBase);
    const killTime = enemyBase.health / Math.max(1, army.soldiers * FRONTIER_BASE_DAMAGE_PER_SOLDIER_PER_SECOND);
    const directAttackBonus =
      army.order.type === "ATTACK" && army.order.targetId === enemyBase.id ? 8 : 0;

    return sum + army.soldiers / (eta + killTime + 1) + directAttackBonus;
  }, 0);
}

function shouldPressEnemyBase(
  state: FrontierState,
  owner: FrontierOwner,
  army: FrontierArmy,
  enemyBase: FrontierBase,
) {
  const opponent = getFrontierOpponent(owner);
  const ownBase = getBase(state, owner);
  const ownSites = state.sites.filter((site) => site.controller === owner).length;
  const enemySites = state.sites.filter((site) => site.controller === opponent).length;
  const ownSoldiers = getArmies(state, owner).reduce((sum, candidate) => sum + candidate.soldiers, 0);
  const enemySoldiers = getArmies(state, opponent).reduce((sum, candidate) => sum + candidate.soldiers, 0);
  const ownIncomeRate = getFrontierIncomePerSecond(state, owner);
  const enemyIncomeRate = getFrontierIncomePerSecond(state, opponent);
  const eta = timeToTargetSeconds(army, enemyBase);
  const killTime =
    enemyBase.health / Math.max(1, army.soldiers * FRONTIER_BASE_DAMAGE_PER_SOLDIER_PER_SECOND);
  const remainingHomeGuard = getArmies(state, owner)
    .filter((candidate) => candidate.id !== army.id)
    .filter((candidate) => timeToTargetSeconds(candidate, ownBase) <= BASE_THREAT_RADIUS)
    .reduce((sum, candidate) => sum + candidate.soldiers, 0);
  const enemyPressure = scoreEnemyDanger(state, owner);
  const immediateLethal =
    eta <= 4 ||
    (enemyBase.health <= army.soldiers * 2 && eta <= 8);
  const stableMapControl =
    ownSites >= enemySites + MIN_STABLE_SITE_ADVANTAGE &&
    ownSoldiers >= enemySoldiers + MIN_STABLE_SOLDIER_ADVANTAGE &&
    ownIncomeRate >= enemyIncomeRate + 1;
  const lateEnoughToConvert = state.elapsedMs >= EARLY_BASE_RUSH_LOCK_MS;
  const safeToCommit =
    remainingHomeGuard >= MIN_HOME_GUARD_SOLDIERS || enemyPressure <= 3;

  if (immediateLethal) {
    return true;
  }

  if (!safeToCommit) {
    return false;
  }

  if (!stableMapControl) {
    return false;
  }

  return lateEnoughToConvert && eta + killTime <= 12;
}

function scoreSiteRace(state: FrontierState, owner: FrontierOwner) {
  const opponent = getFrontierOpponent(owner);

  return state.sites.reduce((sum, site) => {
    if (site.controller === owner) {
      return sum;
    }

    const ownEta = closestArmyEta(state, owner, site);
    const enemyEta = closestArmyEta(state, opponent, site);
    const delta = enemyEta - ownEta;

    if (!Number.isFinite(delta)) {
      return sum;
    }

    return sum + Math.max(-2, Math.min(2, delta / 4));
  }, 0);
}

function scoreEnemyDanger(state: FrontierState, owner: FrontierOwner) {
  const ownBase = getBase(state, owner);

  return getArmies(state, getFrontierOpponent(owner)).reduce((sum, army) => {
    const eta = timeToTargetSeconds(army, ownBase);
    return (
      sum +
      army.soldiers / (eta + 1) +
      (army.order.type === "ATTACK" && army.order.targetId === ownBase.id ? 4 : 0)
    );
  }, 0);
}

function getEnemyBaseThreats(state: FrontierState, owner: FrontierOwner) {
  const ownBase = getBase(state, owner);
  const opponent = getFrontierOpponent(owner);

  return getArmies(state, opponent)
    .filter((army) => {
      return (
        (army.order.type === "ATTACK" && army.order.targetId === ownBase.id) ||
        timeToTargetSeconds(army, ownBase) <= IMMEDIATE_BASE_THREAT_SECONDS
      );
    })
    .sort((left, right) => {
      const leftScore =
        left.soldiers * 3 -
        timeToTargetSeconds(left, ownBase) +
        (left.order.type === "ATTACK" && left.order.targetId === ownBase.id ? 5 : 0);
      const rightScore =
        right.soldiers * 3 -
        timeToTargetSeconds(right, ownBase) +
        (right.order.type === "ATTACK" && right.order.targetId === ownBase.id ? 5 : 0);

      return rightScore - leftScore;
    });
}

function closestArmyEta(state: FrontierState, owner: FrontierOwner, target: { x: number; y: number }) {
  const eta = getArmies(state, owner)
    .map((army) => timeToTargetSeconds(army, target))
    .sort((left, right) => left - right)[0];

  return eta ?? Number.POSITIVE_INFINITY;
}

function getBase(state: FrontierState, owner: FrontierOwner) {
  const base = state.bases.find((candidate) => candidate.owner === owner);

  if (!base) {
    throw new Error(`Missing Frontier base for ${owner}.`);
  }

  return base;
}

function getArmies(state: FrontierState, owner: FrontierOwner) {
  return state.armies.filter((army) => army.owner === owner);
}

function estimateBattleMargin(attackerSoldiers: number, defenderSoldiers: number, attackerBonusApplied: boolean) {
  const attackerStrength = attackerSoldiers * (attackerBonusApplied ? FRONTIER_ATTACKER_BONUS : 1);
  return attackerStrength - defenderSoldiers;
}

function timeToTargetSeconds(source: { x: number; y: number }, target: { x: number; y: number }) {
  return Math.max(0, distance(source, target) - FRONTIER_ENGAGE_DISTANCE) / FRONTIER_ARMY_SPEED;
}

function upsertArmyAction(actions: FrontierAction[], action: FrontierAction) {
  return dedupeActions(
    actions.filter((candidate) => candidate.armyId !== action.armyId).concat(action),
  );
}

function dedupeActions(actions: FrontierAction[]) {
  const byKey = new Map<string, FrontierAction>();

  for (const action of actions) {
    byKey.set(action.armyId, action);
  }

  return [...byKey.values()].sort((left, right) => left.armyId.localeCompare(right.armyId));
}

function serializeActionBundle(actions: FrontierAction[]) {
  return dedupeActions(actions)
    .map((action) => {
      if (action.type === "MOVE") {
        return `MOVE:${action.armyId}:${action.x},${action.y}`;
      }

      return `ATTACK:${action.armyId}:${action.targetId}`;
    })
    .join("|");
}

function compareArmiesForControl(left: FrontierArmy, right: FrontierArmy) {
  return right.soldiers - left.soldiers || left.id.localeCompare(right.id);
}

function cloneFrontierStateForBot(state: FrontierState): FrontierState {
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
      ONE: state.pendingCommands.ONE
        ? {
            windowIndex: state.pendingCommands.ONE.windowIndex,
            actions: state.pendingCommands.ONE.actions.map((action) => ({ ...action })),
          }
        : null,
      TWO: state.pendingCommands.TWO
        ? {
            windowIndex: state.pendingCommands.TWO.windowIndex,
            actions: state.pendingCommands.TWO.actions.map((action) => ({ ...action })),
          }
        : null,
    },
    nextArmySequence: state.nextArmySequence,
    winner: state.winner,
    winnerReason: state.winnerReason,
  };
}

function createMulberry32(seed: number) {
  let current = seed >>> 0;

  return () => {
    current += 0x6d2b79f5;
    let value = Math.imul(current ^ (current >>> 15), 1 | current);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
