import { describe, expect, it } from "vitest";
import type { GameState, MapObject, PlayerState } from "../src";
import {
  SHRINE_EXP, WELL_MP, applyAction, campStack, createGame, generateMap, getPlayer, guardOf, income, planAiMove, playerView, reveal,
} from "../src";

function valley(): GameState {
  return createGame({
    id: "g", mapId: "valley", seed: 7,
    players: [{ id: "p0", name: "A", isAI: false }, { id: "p1", name: "B", isAI: true }],
  });
}

function me(s: GameState, id = "p0"): PlayerState {
  return getPlayer(s, id)!;
}

/** Puts a site on a free, unguarded plain tile next to p0's hero and returns it. */
function siteNearHero(s: GameState, site: "shrine" | "well" | "camp"): MapObject {
  const h = s.heroes[me(s).heroId]!;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
    const x = h.x + dx;
    const y = h.y + dy;
    if (s.terrain[y]?.[x] !== ".") continue;
    if (guardOf(s, x, y) || s.objects.some((o) => !o.gone && o.x === x && o.y === y)) continue;
    const o: MapObject = { id: `site-${site}`, kind: "site", x, y, site, visits: {}, ...(site === "camp" ? { stock: 1 } : {}) };
    s.objects.push(o);
    reveal(s, "p0");
    return o;
  }
  throw new Error("no free tile near the hero");
}

describe("map sites", () => {
  it("a shrine gives experience once per hero", () => {
    const s = valley();
    const o = siteNearHero(s, "shrine");
    const h = s.heroes["h0"]!;
    const [h0x, h0y] = [h.x, h.y];
    const before = h.exp + h.level * 1000;
    expect(applyAction(s, "p0", { type: "move", to: { x: o.x, y: o.y } }).ok).toBe(true);
    expect([h.x, h.y]).toEqual([o.x, o.y]);
    expect(h.exp + h.level * 1000).toBeGreaterThan(before);
    expect(o.visits?.["h0"]).toBe(s.day);
    const lvl = h.level;
    const exp = h.exp;
    // stepping off and back gives nothing more
    const back = { x: 2 * o.x - h0x, y: 2 * o.y - h0y };
    if (s.terrain[back.y]?.[back.x] === "." && !guardOf(s, back.x, back.y)) {
      applyAction(s, "p0", { type: "move", to: back });
      applyAction(s, "p0", { type: "move", to: { x: o.x, y: o.y } });
      expect([h.level, h.exp]).toEqual([lvl, exp]);
    }
    expect(SHRINE_EXP).toBeGreaterThan(0);
  });

  it("a well adds movement once a day", () => {
    const s = valley();
    const o = siteNearHero(s, "well");
    const h = s.heroes["h0"]!;
    const mp = h.mp;
    applyAction(s, "p0", { type: "move", to: { x: o.x, y: o.y } });
    expect(h.mp).toBe(mp - 1 + WELL_MP);
    expect(o.visits?.["h0"]).toBe(s.day);
  });

  it("a mercenary camp hands one stack a week to whoever comes first", () => {
    const s = valley();
    const o = siteNearHero(s, "camp");
    const h = s.heroes["h0"]!;
    const st = campStack("castle")!;
    expect(st).toEqual({ unit: "archer", count: 6 });
    expect(campStack("necropolis")).toEqual({ unit: "ghost", count: 4 });
    const before = h.army.find((a) => a.unit === st.unit)?.count ?? 0;
    applyAction(s, "p0", { type: "move", to: { x: o.x, y: o.y } });
    expect(h.army.find((a) => a.unit === st.unit)?.count).toBe(before + st.count);
    expect(o.stock).toBe(0);
    // refilled at the start of the next week
    for (let d = 0; d < 7 && s.winner === null; d++) applyAction(s, "p0", { type: "endDay" });
    expect(s.day).toBe(8);
    expect(o.stock).toBe(1);
  });

  it("generated maps place sites symmetrically and the AI goes for shrines", () => {
    for (const size of ["s", "m", "l"] as const) {
      const map = generateMap(11, size);
      const sites = map.objects.filter((o) => o.kind === "site");
      expect(sites.length).toBeGreaterThanOrEqual(4);
      for (const kind of ["shrine", "well", "camp"] as const) expect(sites.some((o) => o.site === kind)).toBe(true);
      for (const o of sites) {
        const m = { x: map.cols - 1 - o.x, y: map.rows - 1 - o.y };
        expect(sites.some((q) => q.x === m.x && q.y === m.y && q.site === o.site)).toBe(true);
      }
    }
    const s = createGame({
      id: "g", mapId: "random-m", seed: 3,
      players: [{ id: "p0", name: "A", isAI: true }, { id: "p1", name: "B", isAI: true }],
    });
    for (let d = 0; d < 30 && s.winner === null; d++) applyAction(s, "p0", { type: "endDay" });
    const used = s.objects.filter((o) => o.kind === "site" && Object.keys(o.visits ?? {}).length > 0);
    expect(used.length).toBeGreaterThan(0);
    expect(planAiMove(s, "p0")).toBeDefined();
  });
});

describe("weekly events", () => {
  it("a new week picks an event, stays plain JSON and shows in the view", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = createGame({
        id: "g", mapId: "valley", seed,
        players: [{ id: "p0", name: "A", isAI: false }, { id: "p1", name: "B", isAI: true }],
      });
      for (let d = 0; d < 7 && s.winner === null; d++) applyAction(s, "p0", { type: "endDay" });
      seen.add(s.week ?? "plain");
      expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
      expect(playerView(s, "p0").state.week).toBe(s.week);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("a golden week doubles gold mine income", () => {
    const s = valley();
    const mine = s.objects.find((o) => o.kind === "mine" && !o.res)!;
    mine.owner = "p0";
    const plain = income(s, "p0");
    s.week = "gold";
    expect(income(s, "p0")).toBeGreaterThan(plain);
  });
});

describe("AI with two heroes", () => {
  it("never aims at a tile held by its other hero (they used to wait for each other forever)", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = createGame({
        id: "g", mapId: "random-s", seed,
        players: [{ id: "p0", name: "A", isAI: true }, { id: "p1", name: "B", isAI: true }],
      });
      for (let d = 0; d < 40 && s.winner === null; d++) {
        applyAction(s, "p0", { type: "endDay" });
        for (const p of s.players) {
          const mine = Object.values(s.heroes).filter((h) => h.owner === p.id && h.alive);
          for (const h of mine) {
            const path = planAiMove(s, p.id, h.id);
            const end = path[path.length - 1];
            if (!end) continue;
            expect(mine.some((o) => o.id !== h.id && o.x === end.x && o.y === end.y)).toBe(false);
          }
        }
      }
    }
  });
});
