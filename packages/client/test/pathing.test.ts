import { describe, expect, it } from "vitest";
import { createGame, findPath, guardOf } from "@korony/shared";
import type { GameState, Hero } from "@korony/shared";
import { firstStop, nextLeg, planMove } from "../src/game/pathing";

function start(): { s: GameState; h: Hero } {
  const s = createGame({
    id: "t", mapId: "valley", seed: 1,
    players: [{ id: "you", name: "A", isAI: false }, { id: "ai", name: "B", isAI: true }],
  });
  const h = Object.values(s.heroes).find((x) => x.owner === "you");
  if (!h) throw new Error("no hero");
  return { s, h };
}

describe("planMove", () => {
  it("walks around a guard zone the engine's route would cut through", () => {
    const { s, h } = start();
    expect([h.x, h.y]).toEqual([3, 13]);
    for (const to of [{ x: 5, y: 13 }, { x: 2, y: 11 }, { x: 6, y: 12 }, { x: 6, y: 13 }]) {
      // the engine's own route stops in the wolves' zone right before the target
      expect(firstStop(s, h, findPath(s, h.id, to)), JSON.stringify(to)).toBeGreaterThanOrEqual(0);
      const plan = planMove(s, h, to);
      expect(plan.detour).toBe(true);
      expect(plan.stopAt).toBe(-1);
      expect(plan.path.at(-1)).toEqual(to);
      for (const p of plan.path) expect(guardOf(s, p.x, p.y), JSON.stringify(p)).toBeUndefined();
    }
  });

  it("keeps the engine's route when it is free, and a monster target stays a fight", () => {
    const { s, h } = start();
    const free = planMove(s, h, { x: 2, y: 14 });
    expect(free.detour).toBe(false);
    expect(free.path).toEqual(findPath(s, h.id, { x: 2, y: 14 }));
    const fight = planMove(s, h, { x: 4, y: 11 });
    expect(fight.path.at(-1)).toEqual({ x: 4, y: 11 });
    expect(fight.stopAt).toBe(-1);
  });

  it("reports the stop when no free route exists", () => {
    const { s, h } = start();
    // monsters two tiles away on each side guard every neighbour of the target, but not the target itself
    const target = { x: 6, y: 12 };
    const ring = [[4, 12], [8, 12], [6, 10], [6, 14]] as const;
    ring.forEach(([x, y], i) => s.objects.push({ id: `m-ring-${i}`, kind: "monster", x, y, army: [{ unit: "wolf", count: 3 }] }));
    expect(guardOf(s, target.x, target.y)).toBeUndefined();
    const plan = planMove(s, h, target);
    expect(plan.path.length).toBeGreaterThan(1);
    expect(plan.detour).toBe(false);
    expect(plan.stopAt).toBe(plan.path.length - 2);
  });

  it("splits a detour into legs the engine follows exactly", () => {
    const { s, h } = start();
    const plan = planMove(s, h, { x: 6, y: 13 });
    let hero = { ...h };
    let rest = plan.path;
    let legs = 0;
    while (rest.length > 0) {
      const k = nextLeg(s, hero, rest);
      const leg = rest[k];
      if (!leg) throw new Error("no leg");
      expect(findPath(s, hero.id, leg)).toEqual(rest.slice(0, k + 1));
      hero = { ...hero, x: leg.x, y: leg.y };
      s.heroes[hero.id] = hero;
      rest = rest.slice(k + 1);
      legs++;
    }
    expect(legs).toBeGreaterThan(0);
    expect(legs).toBeLessThanOrEqual(plan.path.length);
  });
});
