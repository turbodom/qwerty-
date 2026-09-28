import { describe, expect, it } from "vitest";
import type { ArmyStack, Battle, BattleEvent, BattleHero, BattleStack, Hex, StatKey, UnitId } from "../src";
import {
  applyBattleAction, autoResolve, baseStats, battleExp, battleSurvivors, canShoot, chooseAiBattleAction, createBattle,
  createRng, damageMultiplier, getStack, hexDistance, hexNeighbors, previewAttack, reachable, stackSpeed, UNIT_IDS, UNITS,
} from "../src";

function bh(stats: Partial<Record<StatKey, number>> = {}, spells: BattleHero["spells"] = ["bolt", "heal", "haste"]): BattleHero {
  return { heroId: "h", name: "Герой", stats: { ...baseStats(), ...stats }, spells };
}

type Spec = [UnitId, number, number, number]; // unit, count, c, r

/** Battle with stacks at fixed positions, no obstacles; stack 0 active, the rest queued in id order. */
function scenario(side0: Spec[], side1: Spec[], heroes: [BattleHero | null, BattleHero | null] = [null, null], seed = 1): Battle {
  const b = createBattle({
    id: "t", seed,
    armies: [side0.map(([unit, count]) => ({ unit, count })), side1.map(([unit, count]) => ({ unit, count }))],
    heroes,
  });
  b.obstacles = [];
  [...side0, ...side1].forEach(([, , c, r], i) => {
    const s = b.stacks[i]!;
    s.c = c;
    s.r = r;
  });
  b.active = 0;
  b.queue = b.stacks.slice(1).map((s) => s.id);
  return b;
}

function setActive(b: Battle, id: number): void {
  b.active = id;
  b.queue = b.stacks.filter((s) => s.id !== id && s.count > 0).map((s) => s.id);
}

const dmgEvents = (ev: BattleEvent[], source?: string) =>
  ev.filter((e): e is Extract<BattleEvent, { type: "damage" }> => e.type === "damage" && (!source || e.source === source));

describe("grid", () => {
  it("hex distance and neighbours on odd-r grid", () => {
    expect(hexDistance([0, 0], [0, 0])).toBe(0);
    expect(hexDistance([3, 4], [3, 5])).toBe(1);
    expect(hexDistance([3, 4], [2, 5])).toBe(1);
    expect(hexDistance([0, 0], [0, 10])).toBe(10);
    for (const [c, r] of hexNeighbors(3, 4)) expect(hexDistance([3, 4], [c, r])).toBe(1);
    for (const [c, r] of hexNeighbors(3, 5)) expect(hexDistance([3, 5], [c, r])).toBe(1);
    expect(hexNeighbors(3, 5)).toHaveLength(6);
    expect(hexNeighbors(0, 0)).toHaveLength(2);
  });
});

describe("createBattle", () => {
  it("deploys like the prototype and places 4 obstacles in rows 3..7", () => {
    const b = createBattle({
      id: "b1", seed: 42,
      armies: [[{ unit: "pike", count: 10 }, { unit: "archer", count: 5 }], [{ unit: "skeleton", count: 20 }, { unit: "wolf", count: 0 }]],
      heroes: [bh(), null],
    });
    expect(b.cols).toBe(8);
    expect(b.rows).toBe(11);
    expect(b.stacks).toHaveLength(3);
    expect(b.stacks.map((s) => [s.side, s.c, s.r])).toEqual([[0, 1, 10], [0, 3, 10], [1, 0, 0]]);
    expect(b.stacks[1]!.shots).toBe(12);
    expect(b.obstacles).toHaveLength(4);
    const keys = new Set(b.obstacles.map(([c, r]) => `${c},${r}`));
    expect(keys.size).toBe(4);
    for (const [c, r] of b.obstacles) {
      expect(r).toBeGreaterThanOrEqual(3);
      expect(r).toBeLessThanOrEqual(7);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(8);
    }
    expect(b.round).toBe(1);
    expect(b.active).not.toBeNull();
    expect(b.over).toBe(false);
    expect(JSON.parse(JSON.stringify(b))).toEqual(b);
  });

  it("does not overlap stacks for armies of more than 5 stacks", () => {
    const army: ArmyStack[] = (["pike", "halberd", "archer", "marksman", "griffin", "royalGriffin"] as UnitId[]).map((unit) => ({ unit, count: 3 }));
    const b = createBattle({ id: "x", seed: 1, armies: [army, army], heroes: [null, null] });
    const pos = new Set(b.stacks.map((s) => `${s.c},${s.r}`));
    expect(pos.size).toBe(12);
  });

  it("same seed gives the same obstacles", () => {
    const mk = (seed: number) => createBattle({ id: "x", seed, armies: [[{ unit: "pike", count: 1 }], [{ unit: "wolf", count: 1 }]], heroes: [null, null] });
    expect(mk(7).obstacles).toEqual(mk(7).obstacles);
  });

  it("queue is ordered by speed incl. hero bonus, side 0 first on ties", () => {
    const armies: [ArmyStack[], ArmyStack[]] = [[{ unit: "pike", count: 5 }, { unit: "griffin", count: 2 }], [{ unit: "skeleton", count: 5 }, { unit: "wolf", count: 5 }]];
    const b = createBattle({ id: "q", seed: 3, armies, heroes: [null, null] });
    // speeds: pike 4, griffin 6, skeleton 4, wolf 6
    expect([b.active, ...b.queue]).toEqual([1, 3, 0, 2]);
    const b2 = createBattle({ id: "q", seed: 3, armies, heroes: [null, bh({ spd: 1 })] });
    // side 1 +1: skeleton 5, wolf 7
    expect([b2.active, ...b2.queue]).toEqual([3, 1, 2, 0]);
    expect(stackSpeed(b2, b2.stacks[3]!)).toBe(7);
  });

  it("an empty side ends the battle at once", () => {
    const b = createBattle({ id: "e", seed: 1, armies: [[{ unit: "pike", count: 3 }], []], heroes: [null, null] });
    expect(b.over).toBe(true);
    expect(b.winnerSide).toBe(0);
    expect(applyBattleAction(b, { type: "defend" }).ok).toBe(false);
  });
});

describe("damage", () => {
  it("melee damage stays within preview bounds (no luck)", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const b = scenario([["pike", 25, 3, 5]], [["skeleton", 500, 3, 4]], [null, null], seed);
      const p = previewAttack(b, 0, 1, false);
      expect(p.minDmg).toBeLessThanOrEqual(p.maxDmg);
      const res = applyBattleAction(b, { type: "attack", target: 1, from: [3, 5] });
      expect(res.ok).toBe(true);
      const d = dmgEvents(res.events, "melee")[0]!;
      expect(d.lucky).toBeUndefined();
      expect(d.amount).toBeGreaterThanOrEqual(p.minDmg);
      expect(d.amount).toBeLessThanOrEqual(p.maxDmg);
      expect(d.killed).toBeGreaterThanOrEqual(p.minKill);
      expect(d.killed).toBeLessThanOrEqual(p.maxKill);
    }
  });

  it("luck doubles damage", () => {
    const b = scenario([["pike", 25, 3, 5]], [["skeleton", 500, 3, 4]], [bh({ luck: 10 }), null]);
    const p = previewAttack(b, 0, 1, false);
    const res = applyBattleAction(b, { type: "attack", target: 1 });
    const d = dmgEvents(res.events, "melee")[0]!;
    expect(d.lucky).toBe(true);
    expect(d.amount).toBeGreaterThanOrEqual(2 * p.minDmg);
    expect(d.amount).toBeLessThanOrEqual(2 * p.maxDmg);
  });

  it("minimum damage is 1", () => {
    const b = scenario([["skeleton", 1, 3, 5]], [["lich", 10, 3, 4]], [bh({ atk: 0 }), bh({ def: 30 })]);
    expect(previewAttack(b, 0, 1, false).minDmg).toBe(1);
    const res = applyBattleAction(b, { type: "attack", target: 1 });
    expect(dmgEvents(res.events, "melee")[0]!.amount).toBeGreaterThanOrEqual(1);
  });

  it("attack/defence multiplier, caps, defending, antiFly, dmgPct, range", () => {
    const b = scenario([["pike", 10, 3, 5], ["archer", 10, 0, 10]], [["griffin", 10, 3, 4], ["skeleton", 10, 0, 0]]);
    const [pike, archer, griffin, skel] = b.stacks as [BattleStack, BattleStack, BattleStack, BattleStack];
    // pike atk 4 vs griffin def 8: 1 - 0.025*4 = 0.9, antiFly x1.5
    expect(damageMultiplier(b, pike, griffin, false)).toBeCloseTo(0.9 * 1.5);
    // archer atk 6 vs skeleton def 4: 1.1; distance 10 > 6 -> half when ranged
    expect(damageMultiplier(b, archer, skel, false)).toBeCloseTo(1.1);
    expect(damageMultiplier(b, archer, skel, true)).toBeCloseTo(0.55);
    skel.defending = true; // def round(4*1.3)=5
    expect(damageMultiplier(b, archer, skel, false)).toBeCloseTo(1.05);
    b.heroes[0] = bh({ atk: 100, dmgPct: 20 });
    expect(damageMultiplier(b, archer, griffin, false)).toBeCloseTo(4 * 1.2);
    b.heroes[1] = bh({ def: 200 });
    b.heroes[0] = null;
    expect(damageMultiplier(b, archer, griffin, false)).toBeCloseTo(0.3);
  });
});

describe("retaliation", () => {
  it("a normal stack retaliates once per round", () => {
    const b = scenario([["pike", 20, 3, 5], ["pike", 20, 2, 4]], [["skeleton", 200, 3, 4]]);
    const r1 = applyBattleAction(b, { type: "attack", target: 2, from: [3, 5] });
    expect(dmgEvents(r1.events, "retaliation")).toHaveLength(1);
    expect(dmgEvents(r1.events, "retaliation")[0]!.stack).toBe(0);
    setActive(b, 1);
    const r2 = applyBattleAction(b, { type: "attack", target: 2, from: [2, 4] });
    expect(dmgEvents(r2.events, "retaliation")).toHaveLength(0);
  });

  it("unlimRetal (griffin) retaliates every time", () => {
    const b = scenario([["pike", 20, 3, 5], ["pike", 20, 2, 4]], [["griffin", 50, 3, 4]]);
    applyBattleAction(b, { type: "attack", target: 2, from: [3, 5] });
    setActive(b, 1);
    const r2 = applyBattleAction(b, { type: "attack", target: 2, from: [2, 4] });
    expect(dmgEvents(r2.events, "retaliation")).toHaveLength(1);
  });

  it("noRetal (ghost) attacks are not answered", () => {
    const b = scenario([["ghost", 10, 3, 5]], [["skeleton", 200, 3, 4]]);
    const r = applyBattleAction(b, { type: "attack", target: 1, from: [3, 5] });
    expect(dmgEvents(r.events, "melee")).toHaveLength(1);
    expect(dmgEvents(r.events, "retaliation")).toHaveLength(0);
  });

  it("shots are not answered and use ammo", () => {
    const b = scenario([["archer", 10, 3, 10]], [["skeleton", 200, 3, 0]]);
    const r = applyBattleAction(b, { type: "shoot", target: 1 });
    expect(r.ok).toBe(true);
    expect(dmgEvents(r.events, "shot")).toHaveLength(1);
    expect(dmgEvents(r.events, "retaliation")).toHaveLength(0);
    expect(b.stacks[0]!.shots).toBe(11);
  });

  it("retaliation resets at the new round", () => {
    const b = scenario([["pike", 100, 3, 5]], [["skeleton", 60, 3, 4]]);
    applyBattleAction(b, { type: "attack", target: 1, from: [3, 5] });
    expect(b.over).toBe(false);
    expect(b.stacks[1]!.retal).toBe(false);
    // skeleton's turn, then new round
    const r = applyBattleAction(b, { type: "defend" });
    expect(r.events).toContainEqual({ type: "round", round: 2 });
    expect(b.stacks[1]!.retal).toBe(true);
  });
});

describe("splash", () => {
  it("lich hits enemies next to the target, not allies or far enemies", () => {
    const b = scenario(
      [["lich", 10, 3, 10], ["pike", 5, 4, 1]],
      [["skeleton", 100, 3, 0], ["skeleton", 100, 2, 1], ["wolf", 100, 7, 5]],
    );
    const r = applyBattleAction(b, { type: "shoot", target: 2 });
    expect(r.ok).toBe(true);
    const splash = dmgEvents(r.events, "splash");
    expect(splash.map((e) => e.stack)).toEqual([3]);
    expect(dmgEvents(r.events).some((e) => e.stack === 1 || e.stack === 4)).toBe(false);
    expect(splash[0]!.amount).toBeGreaterThan(0);
  });
});

describe("shooting and reach", () => {
  it("a shooter next to an enemy cannot shoot but can fight in melee", () => {
    const b = scenario([["archer", 10, 3, 5]], [["skeleton", 10, 3, 4]]);
    expect(canShoot(b, 0)).toBe(false);
    expect(applyBattleAction(b, { type: "shoot", target: 1 }).ok).toBe(false);
    expect(applyBattleAction(b, { type: "attack", target: 1 }).ok).toBe(true);
  });

  it("a shooter that can shoot may not melee; no ammo means no shooting", () => {
    const b = scenario([["archer", 10, 3, 8]], [["skeleton", 10, 3, 5]]);
    expect(canShoot(b, 0)).toBe(true);
    expect(applyBattleAction(b, { type: "attack", target: 1 }).ok).toBe(false);
    b.stacks[0]!.shots = 0;
    expect(canShoot(b, 0)).toBe(false);
    expect(canShoot(b, 1)).toBe(false);
  });

  it("walkers go around obstacles; flyers reach by hex distance over them", () => {
    const b = scenario([["pike", 5, 3, 8], ["griffin", 5, 4, 8]], [["skeleton", 5, 0, 0]]);
    // wall across row 6
    b.obstacles = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => [c, 6] as Hex);
    const walk = reachable(b, 0);
    expect(walk["3,8"]).toBe(0);
    expect(Object.keys(walk).some((k) => Number(k.split(",")[1]) <= 6)).toBe(false);
    expect(walk["4,8"]).toBeUndefined(); // occupied by griffin
    const fly = reachable(b, 1);
    expect(fly["4,5"]).toBe(3);
    expect(fly["4,2"]).toBe(6);
    expect(fly["3,6"]).toBeUndefined(); // obstacle
    for (const [k, d] of Object.entries(fly)) {
      const [c, r] = k.split(",").map(Number) as [number, number];
      expect(d).toBe(hexDistance([4, 8], [c, r]));
      expect(d).toBeLessThanOrEqual(6);
    }
  });

  it("walker steps follow BFS within speed", () => {
    const b = scenario([["pike", 5, 3, 10]], [["skeleton", 5, 0, 0]]);
    const rm = reachable(b, 0);
    for (const d of Object.values(rm)) expect(d).toBeLessThanOrEqual(4);
    expect(rm["3,6"]).toBe(4);
    expect(rm["3,5"]).toBeUndefined();
  });

  it("move validation", () => {
    const b = scenario([["pike", 5, 3, 10]], [["skeleton", 5, 0, 0]]);
    const before = JSON.stringify(b);
    expect(applyBattleAction(b, { type: "move", to: [3, 2] }).ok).toBe(false);
    expect(applyBattleAction(b, { type: "move", to: [3, 10] }).ok).toBe(false);
    expect(applyBattleAction(b, { type: "attack", target: 1 }).ok).toBe(false);
    expect(applyBattleAction(b, { type: "attack", target: 0 }).ok).toBe(false);
    expect(JSON.stringify(b)).toBe(before);
    const r = applyBattleAction(b, { type: "move", to: [3, 7] });
    expect(r.ok).toBe(true);
    expect(r.events[0]).toEqual({ type: "move", stack: 0, to: [3, 7] });
    expect(r.events).toContainEqual({ type: "turn", stack: 1 });
    expect(b.active).toBe(1);
  });

  it("attack moves next to the target first", () => {
    const b = scenario([["pike", 5, 3, 9]], [["skeleton", 50, 3, 6]]);
    const r = applyBattleAction(b, { type: "attack", target: 1 });
    expect(r.ok).toBe(true);
    const s = b.stacks[0]!;
    expect(hexDistance([s.c, s.r], [3, 6])).toBe(1);
    expect(r.events[0]!.type).toBe("move");
    expect(applyBattleAction(scenario([["pike", 5, 3, 10]], [["skeleton", 5, 3, 0]]), { type: "attack", target: 1 }).ok).toBe(false);
  });

  it("defend raises defence until the stack's next turn", () => {
    const b = scenario([["pike", 5, 3, 10]], [["skeleton", 5, 0, 0]]);
    applyBattleAction(b, { type: "defend" });
    expect(b.stacks[0]!.defending).toBe(true);
    applyBattleAction(b, { type: "defend" }); // skeleton; new round, pike's turn again
    expect(b.active).toBe(0);
    expect(b.stacks[0]!.defending).toBe(false);
  });
});

describe("spells", () => {
  it("bolt deals (15+15*pow)*(1+boltX) and does not end the turn", () => {
    const b = scenario([["pike", 5, 3, 10]], [["skeleton", 100, 0, 0]], [bh({ pow: 2, boltX: 1 }), null]);
    const r = applyBattleAction(b, { type: "cast", spell: "bolt", target: 1 });
    expect(r.ok).toBe(true);
    const d = dmgEvents(r.events, "spell")[0]!;
    expect(d.amount).toBe(90);
    expect(d.killed).toBe(15);
    expect(b.active).toBe(0);
    expect(b.spellUsed).toEqual([true, false]);
    expect(applyBattleAction(b, { type: "cast", spell: "bolt", target: 1 }).ok).toBe(false);
    expect(applyBattleAction(b, { type: "cast", spell: "haste", target: 0 }).ok).toBe(false);
    // the stack can still act
    expect(applyBattleAction(b, { type: "defend" }).ok).toBe(true);
  });

  it("spells need a hero that knows them and a valid target", () => {
    const noHero = scenario([["pike", 5, 3, 10]], [["skeleton", 5, 0, 0]]);
    expect(applyBattleAction(noHero, { type: "cast", spell: "bolt", target: 1 }).ok).toBe(false);
    const b = scenario([["pike", 5, 3, 10]], [["skeleton", 5, 0, 0]], [bh({}, ["bolt"]), null]);
    expect(applyBattleAction(b, { type: "cast", spell: "heal", target: 0 }).ok).toBe(false);
    expect(applyBattleAction(b, { type: "cast", spell: "bolt", target: 0 }).ok).toBe(false);
    expect(b.spellUsed).toEqual([false, false]);
  });

  it("one spell per side per round, reset next round", () => {
    const b = scenario([["pike", 5, 3, 10]], [["skeleton", 500, 0, 0]], [bh(), bh()]);
    expect(applyBattleAction(b, { type: "cast", spell: "bolt", target: 1 }).ok).toBe(true);
    applyBattleAction(b, { type: "defend" });
    // side 1 may still cast this round
    expect(applyBattleAction(b, { type: "cast", spell: "bolt", target: 0 }).ok).toBe(true);
    applyBattleAction(b, { type: "defend" });
    expect(b.round).toBe(2);
    expect(b.spellUsed).toEqual([false, false]);
    expect(applyBattleAction(b, { type: "cast", spell: "bolt", target: 1 }).ok).toBe(true);
  });

  it("heal restores 20+20*pow and revives up to the starting count", () => {
    const b = scenario([["pike", 10, 3, 10]], [["skeleton", 5, 0, 0]], [bh({ pow: 1 }), null]);
    const s = b.stacks[0]!;
    s.count = 5;
    s.top = 4; // total 44
    const r = applyBattleAction(b, { type: "cast", spell: "heal", target: 0 });
    expect(r.ok).toBe(true);
    expect(s.count).toBe(9); // 84 hp -> 9 creatures, top 4
    expect(s.top).toBe(4);
    expect(r.events).toContainEqual({ type: "heal", stack: 0, revived: 4 });
    const b2 = scenario([["pike", 10, 3, 10]], [["skeleton", 5, 0, 0]], [bh({ pow: 5 }), null]);
    b2.stacks[0]!.count = 9;
    applyBattleAction(b2, { type: "cast", spell: "heal", target: 0 });
    expect(b2.stacks[0]!.count).toBe(10);
    expect(b2.stacks[0]!.top).toBe(10);
  });

  it("haste gives +2 speed until the end of the round without re-ordering the queue", () => {
    const armies: [ArmyStack[], ArmyStack[]] = [[{ unit: "griffin", count: 2 }, { unit: "pike", count: 5 }], [{ unit: "wolf", count: 5 }]];
    const b = createBattle({ id: "h", seed: 5, armies, heroes: [bh(), null] });
    expect(b.active).toBe(0);
    expect(b.queue).toEqual([2, 1]);
    const pike = b.stacks[1]!;
    const r = applyBattleAction(b, { type: "cast", spell: "haste", target: 1 });
    expect(r.events).toContainEqual({ type: "haste", stack: 1 });
    expect(stackSpeed(b, pike)).toBe(6);
    expect(b.queue).toEqual([2, 1]); // prototype castHaste: turn order of the round is unchanged
    const rm = reachable(b, 1);
    expect(Math.max(...Object.values(rm))).toBe(6);
    applyBattleAction(b, { type: "defend" });
    applyBattleAction(b, { type: "defend" });
    applyBattleAction(b, { type: "defend" });
    expect(b.round).toBe(2);
    expect(pike.haste).toBe(false);
  });

  it("bolt that kills the last enemy ends the battle", () => {
    const b = scenario([["pike", 5, 3, 10]], [["skeleton", 1, 0, 0]], [bh(), null]);
    const r = applyBattleAction(b, { type: "cast", spell: "bolt", target: 1 });
    expect(r.events).toContainEqual({ type: "death", stack: 1 });
    expect(r.events).toContainEqual({ type: "end", winnerSide: 0 });
    expect(b.over).toBe(true);
    expect(b.winnerSide).toBe(0);
    expect(b.active).toBeNull();
  });
});

describe("morale", () => {
  it("gives one extra turn per round", () => {
    const b = scenario([["pike", 5, 3, 10]], [["skeleton", 5, 0, 0]], [bh({ morale: 10 }), null]);
    const r1 = applyBattleAction(b, { type: "move", to: [3, 9] });
    expect(r1.events).toContainEqual({ type: "morale", stack: 0 });
    expect(b.active).toBe(0);
    const r2 = applyBattleAction(b, { type: "move", to: [3, 8] });
    expect(r2.events.some((e) => e.type === "morale")).toBe(false);
    expect(b.active).toBe(1);
  });

  it("defend does not trigger morale", () => {
    const b = scenario([["pike", 5, 3, 10]], [["skeleton", 5, 0, 0]], [bh({ morale: 10 }), null]);
    const r = applyBattleAction(b, { type: "defend" });
    expect(r.events.some((e) => e.type === "morale")).toBe(false);
  });
});

// ================= AI / determinism / auto =================

function randomArmy(rng: ReturnType<typeof createRng>): ArmyStack[] {
  const n = rng.int(1, 5);
  const out: ArmyStack[] = [];
  for (let i = 0; i < n; i++) out.push({ unit: rng.pick(UNIT_IDS), count: rng.int(1, 40) });
  return out;
}

function randomHero(rng: ReturnType<typeof createRng>): BattleHero | null {
  if (rng.next() < 0.3) return null;
  return bh({ atk: rng.int(0, 5), def: rng.int(0, 5), pow: rng.int(0, 3), spd: rng.int(0, 2), luck: rng.int(0, 3), morale: rng.int(0, 3), dmgPct: rng.int(0, 20) },
    rng.next() < 0.5 ? ["bolt"] : ["bolt", "heal", "haste"]);
}

describe("AI and autoResolve", () => {
  it("AI casts bolt first when the hero has power, then acts", () => {
    const b = scenario([["archer", 10, 3, 10]], [["skeleton", 20, 3, 0], ["wolf", 20, 5, 0]], [bh({ pow: 1 }), null]);
    const a1 = chooseAiBattleAction(b);
    expect(a1.type).toBe("cast");
    expect(applyBattleAction(b, a1).ok).toBe(true);
    const a2 = chooseAiBattleAction(b);
    expect(a2.type).toBe("shoot");
  });

  it("AI never casts without the bolt spell or power", () => {
    const b = scenario([["pike", 10, 3, 10]], [["skeleton", 20, 3, 0]], [bh({ pow: 0 }), null]);
    expect(chooseAiBattleAction(b).type).not.toBe("cast");
    const b2 = scenario([["pike", 10, 3, 10]], [["skeleton", 20, 3, 0]], [bh({ pow: 3 }, ["heal"]), null]);
    expect(chooseAiBattleAction(b2).type).not.toBe("cast");
  });

  it("AI attacks when in reach and advances otherwise", () => {
    const near = scenario([["pike", 10, 3, 8]], [["skeleton", 20, 3, 5]]);
    const a = chooseAiBattleAction(near);
    expect(a.type).toBe("attack");
    const far = scenario([["pike", 10, 3, 10]], [["skeleton", 20, 3, 0]]);
    const m = chooseAiBattleAction(far);
    expect(m.type).toBe("move");
    if (m.type === "move") expect(hexDistance(m.to, [3, 0])).toBe(6);
  });

  it("determinism: same seed and actions give the same battle", () => {
    const run = () => {
      const b = createBattle({
        id: "d", seed: 12345,
        armies: [[{ unit: "pike", count: 20 }, { unit: "archer", count: 10 }, { unit: "griffin", count: 3 }], [{ unit: "skeleton", count: 30 }, { unit: "ghost", count: 6 }, { unit: "lich", count: 2 }]],
        heroes: [bh({ luck: 2, morale: 2 }), bh({ luck: 1, morale: 1, pow: 2 })],
      });
      const ev = autoResolve(b);
      return JSON.stringify({ b, ev });
    };
    expect(run()).toBe(run());
  });

  it("autoResolve always terminates with a winner (random armies, many seeds)", () => {
    const gen = createRng(2024);
    for (let seed = 1; seed <= 300; seed++) {
      const armies: [ArmyStack[], ArmyStack[]] = [randomArmy(gen), randomArmy(gen)];
      const b = createBattle({ id: `r${seed}`, seed, armies, heroes: [randomHero(gen), randomHero(gen)] });
      const ev = autoResolve(b);
      expect(b.over).toBe(true);
      expect(b.winnerSide === 0 || b.winnerSide === 1).toBe(true);
      expect(b.active).toBeNull();
      expect(ev.filter((e) => e.type === "end")).toHaveLength(1);
      expect(battleSurvivors(b, b.winnerSide === 0 ? 1 : 0).length === 0 || ev.length > 0).toBe(true);
      for (const s of b.stacks) {
        expect(s.count).toBeGreaterThanOrEqual(0);
        expect(s.count).toBeLessThanOrEqual(s.startCount);
        expect(Number.isInteger(s.count)).toBe(true);
      }
      expect(JSON.parse(JSON.stringify(b))).toEqual(b);
    }
  });

  it("a clearly stronger army wins the vast majority of seeds", () => {
    let wins = 0;
    const N = 100;
    for (let seed = 1; seed <= N; seed++) {
      const b = createBattle({
        id: "s", seed,
        armies: [[{ unit: "pike", count: 30 }, { unit: "archer", count: 15 }, { unit: "griffin", count: 6 }], [{ unit: "skeleton", count: 20 }, { unit: "ghost", count: 3 }]],
        heroes: [bh(), bh()],
      });
      autoResolve(b);
      if (b.winnerSide === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(90);
  });

  it("the stronger side wins also when it is side 1", () => {
    let wins = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const b = createBattle({
        id: "s", seed,
        armies: [[{ unit: "wolf", count: 15 }], [{ unit: "skeleton", count: 40 }, { unit: "lich", count: 3 }]],
        heroes: [null, bh()],
      });
      autoResolve(b);
      if (b.winnerSide === 1) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(90);
  });

  it("survivors and experience", () => {
    const b = createBattle({ id: "x", seed: 9, armies: [[{ unit: "pike", count: 40 }], [{ unit: "wolf", count: 5 }]], heroes: [bh(), null] });
    autoResolve(b);
    expect(b.winnerSide).toBe(0);
    expect(battleExp(b, 0)).toBe(5 * UNITS.wolf.hp);
    const surv = battleSurvivors(b, 0);
    expect(surv).toHaveLength(1);
    expect(surv[0]!.unit).toBe("pike");
    expect(battleSurvivors(b, 1)).toEqual([]);
    expect(getStack(b, 1)!.count).toBe(0);
  });
});
