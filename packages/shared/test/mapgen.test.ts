import { describe, expect, it } from "vitest";
import type { GameState, MapDef } from "../src";
import {
  MAP_SIZES, MAP_SIZE_IDS, aiBuild, applyAction, createGame, findPath, forceEndDay, generateMap, income, isKnownMapId,
  isPassable, ownedCastles, randomMapId, randomMapSize, resolveMap, reveal,
} from "../src";

function reachable(map: MapDef, from: { x: number; y: number }): Set<number> {
  const seen = new Set<number>([from.y * map.cols + from.x]);
  const q = [from];
  for (let head = 0; head < q.length; head++) {
    const c = q[head]!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = c.x + dx;
        const y = c.y + dy;
        const k = y * map.cols + x;
        if (x < 0 || y < 0 || x >= map.cols || y >= map.rows || seen.has(k) || !isPassable(map.terrain, x, y)) continue;
        seen.add(k);
        q.push({ x, y });
      }
    }
  }
  return seen;
}

function randomGame(seed: number, size: "s" | "m" | "l" = "m"): GameState {
  return createGame({
    id: "g", mapId: randomMapId(size), seed,
    players: [{ id: "p0", name: "Игрок", isAI: false }, { id: "p1", name: "ИИ", isAI: true }],
  });
}

describe("procedural maps", () => {
  it("map ids: hand-made and random-<size> are known, anything else is not", () => {
    expect(isKnownMapId("valley")).toBe(true);
    for (const size of MAP_SIZE_IDS) {
      expect(randomMapSize(randomMapId(size))).toBe(size);
      expect(isKnownMapId(randomMapId(size))).toBe(true);
    }
    expect(isKnownMapId("random-xl")).toBe(false);
    expect(isKnownMapId("toString")).toBe(false);
    expect(resolveMap("atlantis", 1)).toBeUndefined();
    expect(resolveMap("valley", 1)?.id).toBe("valley");
  });

  it("is deterministic in the seed and differs between seeds", () => {
    expect(generateMap(7, "m")).toStrictEqual(generateMap(7, "m"));
    expect(JSON.stringify(generateMap(7, "m"))).not.toBe(JSON.stringify(generateMap(8, "m")));
  });

  for (const size of MAP_SIZE_IDS) {
    it(`${size}: symmetric, connected, with every object on a reachable plain tile`, () => {
      for (let seed = 1; seed <= 15; seed++) {
        const map = generateMap(seed, size);
        const { cols, rows } = MAP_SIZES[size];
        expect([map.cols, map.rows]).toEqual([cols, rows]);
        expect(map.terrain).toHaveLength(rows);
        for (const row of map.terrain) expect(row).toMatch(new RegExp(`^[.FMW]{${cols}}$`));
        // point symmetry
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) expect(map.terrain[y]![x]).toBe(map.terrain[rows - 1 - y]![cols - 1 - x]);
        }
        const castle0 = map.objects[map.starts[0]!.castleIndex]!;
        const castle1 = map.objects[map.starts[1]!.castleIndex]!;
        expect([castle1.x, castle1.y]).toEqual([cols - 1 - castle0.x, rows - 1 - castle0.y]);
        const reach = reachable(map, castle0);
        expect(reach.has(castle1.y * cols + castle1.x)).toBe(true);
        const tiles = new Set<number>();
        for (const o of map.objects) {
          const k = o.y * cols + o.x;
          expect(reach.has(k)).toBe(true);
          expect(tiles.has(k)).toBe(false);
          tiles.add(k);
        }
        for (const st of map.starts) expect(reach.has(st.hero.y * cols + st.hero.x)).toBe(true);
        // mirrored content: same number of each kind on both halves (the central relic excepted)
        const kinds = (pred: (o: { x: number; y: number }) => boolean): string =>
          map.objects.filter(pred).map((o) => o.kind).sort().join(",");
        const half = (o: { x: number; y: number }): number => o.y * cols + o.x - (rows * cols - 1) / 2;
        expect(kinds((o) => half(o) < 0)).toBe(kinds((o) => half(o) > 0));
        expect(map.objects.filter((o) => o.kind === "castle" && o.owner === undefined).length % 2).toBe(0);
        expect(map.objects.filter((o) => o.kind === "mine").length).toBeGreaterThanOrEqual(4);
      }
    });
  }

  it("createGame builds the map from the seed and both heroes can walk to the other castle", () => {
    const s = randomGame(3);
    expect(s.mapId).toBe("random-m");
    expect([s.cols, s.rows]).toEqual([39, 39]);
    expect(randomGame(3)).toStrictEqual(s);
    const home0 = s.objects.find((o) => o.id === s.players[0]!.castleId)!;
    const home1 = s.objects.find((o) => o.id === s.players[1]!.castleId)!;
    expect(home0.owner).toBe("p0");
    expect(home1.owner).toBe("p1");
    expect(home0.garrison!.length).toBeGreaterThan(0);
    expect(findPath(s, "h0", { x: home0.x, y: home0.y }).length).toBeGreaterThan(0);
    expect(s.heroes["h0"]!.army).toEqual([{ unit: "pike", count: 20 }, { unit: "archer", count: 10 }]);
  });

  it("a random game against the AI runs 60 days without errors and stays plain JSON", () => {
    for (const seed of [1, 2, 3]) {
      const s = randomGame(seed, "s");
      for (let d = 0; d < 60 && s.winner === null; d++) {
        // the AI may attack the idle hero: then the day timer's forceEndDay settles the battle
        const r = applyAction(s, "p0", { type: "endDay" });
        if (!r.ok) expect(forceEndDay(s, "p0").ok).toBe(true);
      }
      expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
    }
  });
});

describe("castles, garrisons and the AI economy", () => {
  it("every owned castle pays income and adds a week of growth", () => {
    const s = randomGame(5);
    const fort = s.objects.find((o) => o.kind === "castle" && !o.owner)!;
    expect(income(s, "p0")).toBe(1000);
    fort.owner = "p0";
    expect(ownedCastles(s, "p0")).toHaveLength(2);
    expect(income(s, "p0")).toBe(2000);
    s.day = 7;
    const p0 = s.players[0]!;
    p0.growth = {};
    applyAction(s, "p0", { type: "endDay" });
    expect(p0.growth.pike).toBe(20);
    expect(p0.growth.archer).toBe(12);
  });

  it("owned castles gain garrison troops every week", () => {
    const s = randomGame(6);
    const home = s.objects.find((o) => o.id === s.players[0]!.castleId)!;
    const pikes = home.garrison!.find((a) => a.unit === "pike")!.count;
    s.day = 7;
    applyAction(s, "p0", { type: "endDay" });
    expect(home.garrison!.find((a) => a.unit === "pike")!.count).toBe(pikes + 5);
  });

  it("a hero attacked in its own castle fights together with the garrison", () => {
    const s = createGame({
      id: "g", mapId: "valley", seed: 9,
      players: [{ id: "p0", name: "A", isAI: false }, { id: "p1", name: "B", isAI: false }],
    });
    const home1 = s.objects.find((o) => o.id === s.players[1]!.castleId)!;
    const h1 = s.heroes["h1"]!;
    h1.x = home1.x;
    h1.y = home1.y;
    const h0 = s.heroes["h0"]!;
    h0.x = home1.x - 1;
    h0.y = home1.y;
    reveal(s, "p0");
    const r = applyAction(s, "p0", { type: "move", to: { x: home1.x, y: home1.y } });
    expect(r.ok).toBe(true);
    const ab = s.battles[0]!;
    expect(ab.context.kind).toBe("hero");
    // skeletons 20 + 20 and ghosts 3 + 3 from the garrison
    const side1 = ab.battle.stacks.filter((st) => st.side === 1).map((st) => [st.unit, st.count]);
    expect(side1).toEqual([["skeleton", 40], ["ghost", 6]]);
    expect(home1.garrison).toEqual([]);
  });

  it("the AI builds when it can afford it, but not on the first day of a week", () => {
    const s = randomGame(8);
    const ai = s.players[1]!;
    ai.gold = 1200;
    expect(aiBuild(s, "p1")).toBeNull();
    ai.gold = 5000;
    s.day = 8;
    expect(aiBuild(s, "p1")).toBeNull();
    s.day = 9;
    expect(aiBuild(s, "p1")).toEqual({ building: "forge", gold: 1000 });
    expect(ai.built.forge).toBe(true);
    expect(ai.gold).toBe(4000);
    expect(aiBuild(s, "p1")).toBeNull();
  });
});
