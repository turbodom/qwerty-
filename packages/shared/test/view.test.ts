import { describe, expect, it } from "vitest";
import { approx, playerView, reveal } from "../src";
import type { ActiveBattle, Battle } from "../src";
import { valleyState } from "./fixtures";

function battle(rngState: number): Battle {
  return {
    id: "b", cols: 8, rows: 11, rngState, round: 1, stacks: [], obstacles: [], queue: [], active: null,
    spellUsed: [false, false], heroes: [null, null], over: false, winnerSide: null,
  };
}

function setup() {
  const s = valleyState();
  reveal(s, "p0");
  reveal(s, "p1");
  return s;
}

describe("approx", () => {
  it("matches the prototype ranges", () => {
    expect(approx(1)).toBe("мало");
    expect(approx(4)).toBe("мало");
    expect(approx(5)).toBe("5–9");
    expect(approx(14)).toBe("10–19");
    expect(approx(25)).toBe("20–49");
    expect(approx(50)).toBe("50+");
  });
});

describe("playerView", () => {
  it("does not mutate the source state and keeps own data intact", () => {
    const s = setup();
    const before = JSON.stringify(s);
    const v = playerView(s, "p0");
    expect(JSON.stringify(s)).toBe(before);
    expect(v.you).toBe("p0");
    expect(v.state.players[0]).toEqual(s.players[0]);
    expect(v.state.heroes["h0"]).toEqual(s.heroes["h0"]);
    const ownCastle = v.state.objects.find((o) => o.id === s.players[0]!.castleId);
    expect(ownCastle).toEqual(s.objects.find((o) => o.id === s.players[0]!.castleId));
  });

  it("hides a fogged enemy hero and fogged objects", () => {
    const s = setup();
    const v = playerView(s, "p0");
    expect(v.state.heroes["h1"]).toBeUndefined();
    // enemy castle (11,1) and far artifacts are fogged for p0
    expect(v.state.objects.find((o) => o.x === 11 && o.y === 1)).toBeUndefined();
    expect(v.state.objects.find((o) => o.x === 8 && o.y === 1)).toBeUndefined();
    // chest near own castle (0,9)? hero at (3,13) radius 4: hypot(3,4) = 5 > 4.5, so fogged
    expect(v.state.objects.find((o) => o.x === 0 && o.y === 9)).toBeUndefined();
    // monster at (4,11) is explored: visible with approximate count
    const m = v.state.objects.find((o) => o.x === 4 && o.y === 11);
    expect(m?.army).toEqual([{ unit: "wolf", count: 0, countHint: "5–9" }]);
    for (const o of v.state.objects) {
      const idx = o.y * s.cols + o.x;
      expect(s.players[0]!.explored[idx] === "1" || o.owner === "p0").toBe(true);
    }
  });

  it("shows a visible enemy hero with approximate army and without bag", () => {
    const s = setup();
    const h1 = s.heroes["h1"]!;
    h1.x = 4;
    h1.y = 12;
    h1.bag = ["crown"];
    h1.army = [{ unit: "skeleton", count: 37 }];
    const v = playerView(s, "p0");
    const eh = v.state.heroes["h1"];
    expect(eh).toBeDefined();
    expect(eh!.bag).toEqual([]);
    expect(eh!.army).toEqual([{ unit: "skeleton", count: 0, countHint: "20–49" }]);
    expect(eh!.equipped).toEqual(h1.equipped);
    expect(eh!.mp).toBe(0);
  });

  it("never contains enemy gold, exploration, or rng state", () => {
    const s = setup();
    s.players[1]!.gold = 77777;
    const ab: ActiveBattle = { battle: battle(4242), sides: ["p0", "neutral"], context: { kind: "monster", heroIds: ["h0"] } };
    const other: ActiveBattle = { battle: battle(999), sides: ["p1", "neutral"], context: { kind: "monster", heroIds: ["h1"] } };
    s.battles = [ab, other];
    const v = playerView(s, "p0");
    const json = JSON.stringify(v);
    expect(json).not.toContain("77777");
    expect(json).not.toContain("987654321");
    expect(v.state.rngState).toBe(0);
    expect(v.state.players[1]!.gold).toBe(0);
    expect(v.state.players[1]!.explored).not.toContain("1");
    expect(v.state.battles.length).toBe(1);
    expect(v.state.battles[0]!.battle.rngState).toBe(0);
    expect(s.battles[0]!.battle.rngState).toBe(4242);
    // own gold kept
    expect(v.state.players[0]!.gold).toBe(s.players[0]!.gold);
  });

  it("hides the garrison size of a visible enemy castle", () => {
    const s = setup();
    s.heroes["h0"]!.x = 11;
    s.heroes["h0"]!.y = 4;
    reveal(s, "p0");
    const v = playerView(s, "p0");
    const castle = v.state.objects.find((o) => o.x === 11 && o.y === 1);
    expect(castle?.garrison).toEqual([
      { unit: "skeleton", count: 0, countHint: "20–49" },
      { unit: "ghost", count: 0, countHint: "мало" },
    ]);
  });

  it("throws for an unknown player", () => {
    expect(() => playerView(setup(), "zzz")).toThrow();
  });
});
