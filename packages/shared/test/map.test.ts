import { describe, expect, it } from "vitest";
import type { GameState, Point } from "../src";
import { findPath, guardOf, income, isExplored, isStopper, reveal, revealDisc, terrainOk } from "../src";
import { mkHero, mkState, valleyState } from "./fixtures";

function assertValidPath(s: GameState, from: Point, path: Point[]): void {
  let prev = from;
  for (const p of path) {
    expect(Math.max(Math.abs(p.x - prev.x), Math.abs(p.y - prev.y))).toBe(1);
    expect(terrainOk(s, p.x, p.y)).toBe(true);
    prev = p;
  }
}

describe("findPath", () => {
  it("goes around water and mountains", () => {
    const terrain = [
      "..W..",
      "..M..",
      "..W..",
      "..W..",
      ".....",
    ];
    const s = mkState(terrain, [], [mkHero("h0", "p0", 0, 0)]);
    const path = findPath(s, "h0", { x: 4, y: 0 });
    expect(path.length).toBe(8);
    expect(path[path.length - 1]).toEqual({ x: 4, y: 0 });
    expect(path).toContainEqual({ x: 2, y: 4 });
    assertValidPath(s, { x: 0, y: 0 }, path);
  });

  it("returns [] for unreachable, impassable or own tile", () => {
    const terrain = [
      "..M..",
      "..M..",
      "..W..",
    ];
    const s = mkState(terrain, [], [mkHero("h0", "p0", 0, 0)]);
    expect(findPath(s, "h0", { x: 4, y: 0 })).toEqual([]);
    expect(findPath(s, "h0", { x: 2, y: 0 })).toEqual([]);
    expect(findPath(s, "h0", { x: 0, y: 0 })).toEqual([]);
    expect(findPath(s, "h0", { x: -1, y: 0 })).toEqual([]);
    expect(findPath(s, "nope", { x: 1, y: 0 })).toEqual([]);
  });

  it("detours around a monster's guard zone", () => {
    const terrain = [".......", ".......", ".......", ".......", "......."];
    const s = mkState(terrain, [{ kind: "monster", x: 3, y: 2, army: [{ unit: "wolf", count: 10 }] }], [
      mkHero("h0", "p0", 0, 2),
    ]);
    const path = findPath(s, "h0", { x: 6, y: 2 });
    expect(path.length).toBeGreaterThan(0);
    assertValidPath(s, { x: 0, y: 2 }, path);
    for (const p of path) expect(guardOf(s, p.x, p.y)).toBeUndefined();
  });

  it("guard zone stops movement: a corridor through it is blocked", () => {
    const s = mkState(["......."], [{ kind: "monster", x: 3, y: 0, army: [{ unit: "wolf", count: 10 }] }], [
      mkHero("h0", "p0", 0, 0),
    ]);
    expect(findPath(s, "h0", { x: 6, y: 0 })).toEqual([]);
    expect(findPath(s, "h0", { x: 4, y: 0 })).toEqual([]);
    // the guarded neighbour itself is a valid target
    expect(findPath(s, "h0", { x: 2, y: 0 })).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
  });

  it("reaches the monster tile through its guarded neighbour", () => {
    const s = mkState(["......."], [{ kind: "monster", x: 3, y: 0, army: [{ unit: "wolf", count: 10 }] }], [
      mkHero("h0", "p0", 0, 0),
    ]);
    expect(findPath(s, "h0", { x: 3, y: 0 })).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
  });

  it("the start tile is never a stopper", () => {
    const s = mkState(["......."], [{ kind: "monster", x: 3, y: 0, army: [{ unit: "wolf", count: 10 }] }], [
      mkHero("h0", "p0", 2, 0),
    ]);
    expect(findPath(s, "h0", { x: 1, y: 0 })).toEqual([{ x: 1, y: 0 }]);
    expect(findPath(s, "h0", { x: 3, y: 0 })).toEqual([{ x: 3, y: 0 }]);
  });

  it("gone monsters do not guard", () => {
    const s = mkState(["......."], [{ kind: "monster", x: 3, y: 0, gone: true }], [mkHero("h0", "p0", 0, 0)]);
    expect(guardOf(s, 2, 0)).toBeUndefined();
    expect(findPath(s, "h0", { x: 6, y: 0 }).length).toBe(6);
  });

  it("own castle is passable, other objects and heroes stop", () => {
    const own = mkState([".....", "MMMMM"], [{ kind: "castle", x: 2, y: 0, owner: "p0" }], [mkHero("h0", "p0", 0, 0)]);
    expect(findPath(own, "h0", { x: 4, y: 0 }).length).toBe(4);

    const enemy = mkState([".....", "MMMMM"], [{ kind: "castle", x: 2, y: 0, owner: "p1" }], [mkHero("h0", "p0", 0, 0)]);
    expect(findPath(enemy, "h0", { x: 4, y: 0 })).toEqual([]);
    expect(findPath(enemy, "h0", { x: 2, y: 0 }).length).toBe(2);

    const chest = mkState([".....", "MMMMM"], [{ kind: "chest", x: 2, y: 0 }], [mkHero("h0", "p0", 0, 0)]);
    expect(findPath(chest, "h0", { x: 4, y: 0 })).toEqual([]);
    expect(isStopper(chest, chest.heroes["h0"]!, 2, 0)).toBe(true);

    const hero = mkState([".....", "MMMMM"], [], [mkHero("h0", "p0", 0, 0), mkHero("h1", "p1", 2, 0)]);
    expect(findPath(hero, "h0", { x: 4, y: 0 })).toEqual([]);
    expect(findPath(hero, "h0", { x: 2, y: 0 }).length).toBe(2);
    hero.heroes["h1"]!.alive = false;
    expect(findPath(hero, "h0", { x: 4, y: 0 }).length).toBe(4);
  });

  it("works on the valley map", () => {
    const s = valleyState();
    const path = findPath(s, "h0", { x: 0, y: 9 }); // chest near the blue castle
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual({ x: 0, y: 9 });
    assertValidPath(s, { x: 3, y: 13 }, path);
    for (const p of path.slice(0, -1)) expect(isStopper(s, s.heroes["h0"]!, p.x, p.y)).toBe(false);
    // water tile is not a destination
    expect(findPath(s, "h0", { x: 6, y: 10 })).toEqual([]);
  });

  it("guardOf covers the monster tile and 8 neighbours", () => {
    const s = valleyState();
    const m = s.objects.find((o) => o.kind === "monster" && o.x === 9 && o.y === 5)!;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) expect(guardOf(s, 9 + dx, 5 + dy)).toBe(m);
    expect(guardOf(s, 11, 5)).toBeUndefined();
  });
});

describe("exploration", () => {
  it("revealDisc uses radius + 0.5", () => {
    const ex = revealDisc("0".repeat(100), 10, 10, 0, 0, 2);
    expect(ex[2]).toBe("1"); // (2,0)
    expect(ex[3]).toBe("0"); // (3,0)
    expect(ex[1 * 10 + 2]).toBe("1"); // (2,1): hypot 2.24 <= 2.5
    expect(ex[2 * 10 + 2]).toBe("0"); // (2,2): hypot 2.83
  });

  it("reveals around own hero (4), castle (3) and mines (2)", () => {
    const s = valleyState();
    reveal(s, "p0");
    expect(isExplored(s, "p0", 3, 13)).toBe(true);
    expect(isExplored(s, "p0", 3, 9)).toBe(true); // hero +4
    expect(isExplored(s, "p0", 3, 8)).toBe(false); // hero +5
    expect(isExplored(s, "p0", 2, 11)).toBe(true); // castle (2,14) +3
    expect(isExplored(s, "p0", 7, 8)).toBe(false);
    expect(isExplored(s, "p1", 3, 13)).toBe(false);
    const mine = s.objects.find((o) => o.kind === "mine" && o.x === 7 && o.y === 8)!;
    mine.owner = "p0";
    reveal(s, "p0");
    expect(isExplored(s, "p0", 7, 6)).toBe(true);
    expect(isExplored(s, "p0", 7, 5)).toBe(false);
    // exploration is permanent
    s.heroes["h0"]!.x = 12;
    s.heroes["h0"]!.y = 5;
    reveal(s, "p0");
    expect(isExplored(s, "p0", 3, 9)).toBe(true);
    expect(s.players[0]!.explored.length).toBe(14 * 16);
  });
});

describe("income", () => {
  it("castle 1000 plus 500 per owned mine", () => {
    const s = valleyState();
    expect(income(s, "p0")).toBe(1000);
    for (const o of s.objects) if (o.kind === "mine") o.owner = "p0";
    expect(income(s, "p0")).toBe(2000);
    expect(income(s, "p1")).toBe(1000);
  });
});
