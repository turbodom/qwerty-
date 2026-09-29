import { describe, expect, it } from "vitest";
import type { BattleHero, GameEvent, GameState, MapDef, MapObjectDef, PlayerSetup, RoomJoinOptions, StatKey } from "../src";
import {
  MAPS, applyAction, applyAiBattleAction, applyBattleAction, autoResolve, baseStats, battleOf, chooseAiBattleAction, createBattle,
  createGame, createRng, forceEndDay, getPlayer, heroPower, isInBattle, isRoomJoinOptions, planAiMove, playerView,
  reveal, revealAll,
} from "../src";
import { mkHero, mkState } from "./fixtures";

const HUMAN: PlayerSetup = { id: "p0", name: "Игрок", isAI: false };
const HUMAN1: PlayerSetup = { id: "p1", name: "Соперник", isAI: false };
const AI1: PlayerSetup = { id: "p1", name: "ИИ", isAI: true };

function vsAi(seed: number): GameState {
  return createGame({ id: "g", mapId: "valley", seed, players: [HUMAN, AI1] });
}

function place(s: GameState, heroId: string, x: number, y: number): void {
  const h = s.heroes[heroId]!;
  h.x = x;
  h.y = y;
  reveal(s, h.owner);
}

/** Marks every object gone except castles and the objects on the given tiles. */
function keepOnly(s: GameState, ...tiles: [number, number][]): void {
  for (const o of s.objects) {
    if (o.kind === "castle") continue;
    if (!tiles.some(([x, y]) => o.x === x && o.y === y)) o.gone = true;
  }
}

function bh(stats: Partial<Record<StatKey, number>> = {}): BattleHero {
  return { heroId: "h", name: "Герой", stats: { ...baseStats(), ...stats }, spells: ["bolt", "heal", "haste"] };
}

describe("the AI gets no newbie quests and no monster drops (prototype quest()/monsterBattle)", () => {
  it("an AI hero opening a chest gets only the chest gold", () => {
    const s = vsAi(3);
    keepOnly(s, [13, 6]);
    place(s, "h1", 12, 6);
    const r = applyAction(s, "p0", { type: "endDay" });
    expect(r.ok).toBe(true);
    expect(s.objects.find((o) => o.x === 13 && o.y === 6)!.gone).toBe(true);
    const aiGold = r.events.filter(
      (e): e is Extract<GameEvent, { type: "gold" }> => e.type === "gold" && e.player === "p1" && e.amount > 0,
    );
    expect(aiGold.map((e) => [e.reason, e.amount])).toEqual([["chest", 1000], ["income", 1000]]);
    expect(r.events.some((e) => e.type === "quest")).toBe(false);
    expect(getPlayer(s, "p1")!.quests).toEqual({});
  });

  it("an AI hero beating monsters never completes the fight quest nor rolls a drop", () => {
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = vsAi(seed);
      keepOnly(s, [4, 11]);
      s.heroes["h1"]!.army = [{ unit: "skeleton", count: 200 }];
      s.heroes["h1"]!.equipped = {};
      place(s, "h1", 6, 11);
      const r = applyAction(s, "p0", { type: "endDay" });
      expect(r.ok).toBe(true);
      if (s.objects.find((o) => o.x === 4 && o.y === 11)!.gone) wins++;
      expect(r.events.some((e) => e.type === "artifact" || e.type === "quest")).toBe(false);
      expect(s.heroes["h1"]!.bag).toEqual([]);
      expect(s.heroes["h1"]!.equipped).toEqual({});
      expect(getPlayer(s, "p1")!.quests).toEqual({});
    }
    expect(wins).toBe(20);
  });

  it("people still get the quests", () => {
    const s = vsAi(5);
    place(s, "h0", 0, 8);
    applyAction(s, "p0", { type: "move", to: { x: 0, y: 9 } });
    expect(getPlayer(s, "p0")!.quests.chest).toBe(true);
  });
});

describe("the AI rushes the human castle at 1.2x even when the defender is inside or in the way", () => {
  function castleRush(human: [number, number]): { x: number; y: number }[] {
    const s = vsAi(9);
    s.day = 8;
    keepOnly(s);
    place(s, "h0", human[0], human[1]);
    place(s, "h1", 6, 12);
    const h0 = s.heroes["h0"]!;
    const h1 = s.heroes["h1"]!;
    const target = heroPower(h0.army, h0) * 1.306;
    let n = 1;
    while (heroPower([{ unit: "skeleton", count: n }], h1) < target) n++;
    h1.army = [{ unit: "skeleton", count: n }];
    const ratio = heroPower(h1.army, h1) / heroPower(h0.army, h0);
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.5);
    return planAiMove(s, "p1");
  }

  it.each([[[2, 14]], [[3, 13]], [[4, 14]]] as [[number, number]][])("human hero at %j", (human) => {
    const path = castleRush(human);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual({ x: 2, y: 14 });
  });
});

describe("haste does not change the turn order (prototype castHaste)", () => {
  it("griffin > ghost > pike stays so after hasting the pike", () => {
    const b = createBattle({
      id: "t", seed: 4,
      armies: [[{ unit: "griffin", count: 5 }, { unit: "pike", count: 10 }], [{ unit: "ghost", count: 5 }]],
      heroes: [bh(), null],
    });
    expect(b.active).toBe(0);
    expect(b.queue).toEqual([2, 1]);
    expect(applyBattleAction(b, { type: "cast", spell: "haste", target: 1 }).ok).toBe(true);
    expect(b.stacks[1]!.haste).toBe(true);
    expect(b.queue).toEqual([2, 1]);
  });
});

describe("an AI stack that cannot advance just stays (no defence bonus, morale still rolled)", () => {
  function stuck(): { b: ReturnType<typeof createBattle>; skel: number } {
    const b = createBattle({
      id: "t", seed: 1,
      armies: [[{ unit: "pike", count: 10 }], [{ unit: "skeleton", count: 10 }]],
      heroes: [null, bh({ pow: 0, morale: 10 })],
    });
    const skel = b.stacks.find((s) => s.side === 1)!;
    expect([skel.c, skel.r]).toEqual([0, 0]);
    b.obstacles = [[1, 0], [0, 1]];
    b.queue = [];
    b.active = skel.id;
    return { b, skel: skel.id };
  }

  it("applyAiBattleAction keeps the stack undefended and rolls morale", () => {
    const { b, skel } = stuck();
    const res = applyAiBattleAction(b);
    expect(res.ok).toBe(true);
    const st = b.stacks[skel]!;
    expect(st.defending).toBe(false);
    expect(res.events.some((e) => e.type === "move")).toBe(false);
    expect(res.events).toContainEqual({ type: "morale", stack: skel });
  });

  it("autoResolve uses the same rule; chooseAiBattleAction offers defend as the public fallback", () => {
    const { b, skel } = stuck();
    expect(chooseAiBattleAction(b)).toEqual({ type: "defend" });
    const ev = autoResolve(b);
    expect(ev).toContainEqual({ type: "morale", stack: skel });
  });

  it("the public applyBattleAction does not accept the internal stay choice", () => {
    const { b } = stuck();
    const r = applyBattleAction(b, { type: "stay" } as unknown as Parameters<typeof applyBattleAction>[1]);
    expect(r.ok).toBe(false);
  });
});

describe("friend-room codes", () => {
  it("RoomJoinOptions accepts a bounded code", () => {
    const o: RoomJoinOptions = { token: "t", mode: "pvp", code: "ABCD" };
    expect(isRoomJoinOptions(o)).toBe(true);
    expect(isRoomJoinOptions({ token: "t", mode: "pvp", mapId: "valley", code: "X1" })).toBe(true);
    expect(isRoomJoinOptions({ token: "t", mode: "pvp", code: "" })).toBe(false);
    expect(isRoomJoinOptions({ token: "t", mode: "pvp", code: "A".repeat(17) })).toBe(false);
    expect(isRoomJoinOptions({ token: "t", mode: "pvp", code: 7 })).toBe(false);
  });
});

describe("a MapDef in the documented shape works", () => {
  it("starts without the optional extension fields are filled from the seat", () => {
    // Shape exactly as in ARCHITECTURE.md; must be assignable to the exported MapDef.
    const doc: {
      id: string; name: string; cols: number; rows: number; terrain: string[];
      starts: { hero: { x: number; y: number }; castleIndex: number }[]; objects: MapObjectDef[];
    } = {
      id: "tiny", name: "Малая", cols: 3, rows: 1, terrain: ["..."],
      starts: [{ hero: { x: 0, y: 0 }, castleIndex: 0 }, { hero: { x: 2, y: 0 }, castleIndex: 1 }],
      objects: [{ kind: "castle", x: 0, y: 0, owner: 0 }, { kind: "castle", x: 2, y: 0, owner: 1 }],
    };
    const map: MapDef = doc;
    MAPS["tiny"] = map;
    try {
      const s = createGame({ id: "g", mapId: "tiny", seed: 1, players: [HUMAN, HUMAN1] });
      expect(s.players.map((p) => p.faction)).toEqual(["castle", "necropolis"]);
      expect(s.players.map((p) => p.gold)).toEqual([2500, 2500]);
      expect(s.heroes["h0"]!.army).toEqual([{ unit: "pike", count: 20 }, { unit: "archer", count: 10 }]);
      expect(s.heroes["h1"]!.name).toBe("Моргот");
      expect(s.players[1]!.growth).toEqual({ skeleton: 8, ghost: 3, lich: 0 });
    } finally {
      delete MAPS["tiny"];
    }
  });
});

describe("battle ids and layouts reveal nothing about the rng", () => {
  function startWolves(seed: number): GameState {
    const s = createGame({ id: "g", mapId: "valley", seed, players: [HUMAN, HUMAN1] });
    expect(applyAction(s, "p0", { type: "move", to: { x: 3, y: 12 } }).ok).toBe(true);
    expect(isInBattle(s, "p0")).toBe(true);
    return s;
  }

  it("id and obstacles are the same for any game seed; only the hidden rng differs", () => {
    const a = startWolves(777);
    const b = startWolves(123456);
    const va = playerView(a, "p0").state.battles[0]!.battle;
    const vb = playerView(b, "p0").state.battles[0]!.battle;
    expect(va.id).toBe("b1-h0-o20");
    expect(vb.id).toBe(va.id);
    expect(vb.obstacles).toEqual(va.obstacles);
    expect(va.rngState).toBe(0);
    expect(a.battles[0]!.battle.rngState).not.toBe(b.battles[0]!.battle.rngState);
  });

  it("no battle id or event field carries the combat seed", () => {
    const s = createGame({ id: "g", mapId: "valley", seed: 424242, players: [HUMAN, HUMAN1] });
    const before = createRng(s.rngState);
    const seed = Math.floor(before.next() * 4294967296) >>> 0; // the draw startBattle makes
    const r = applyAction(s, "p0", { type: "move", to: { x: 4, y: 11 } });
    expect(r.ok).toBe(true);
    const json = JSON.stringify([r.events, playerView(s, "p0")]);
    expect(json).not.toContain(seed.toString(36));
    expect(json).not.toContain(String(seed));
  });

  it("createBattle with layoutSeed: obstacles depend only on it, the combat rng only on seed", () => {
    const mk = (seed: number, layoutSeed: number) => createBattle({
      id: "t", seed, layoutSeed,
      armies: [[{ unit: "pike", count: 5 }], [{ unit: "wolf", count: 5 }]], heroes: [null, null],
    });
    expect(mk(1, 50).obstacles).toEqual(mk(2, 50).obstacles);
    expect(mk(1, 50).rngState).toBe(1);
    expect(mk(1, 50).rngState).toBe(mk(1, 51).rngState);
  });
});

describe("autoBattle / forceEndDay also hand over battles that start while they run", () => {
  function doubleGuard(): GameState {
    const wolf = [{ unit: "wolf" as const, count: 1 }];
    const s = mkState(
      [".....", ".....", ".....", "....."],
      [{ kind: "monster", x: 2, y: 0, army: wolf }, { kind: "monster", x: 2, y: 2, army: wolf.map((a) => ({ ...a })) }],
      [mkHero("h0", "p0", 0, 1, { army: [{ unit: "pike", count: 50 }] }), mkHero("h1", "p1", 4, 3)],
    );
    s.players[1]!.isAI = true;
    revealAll(s);
    expect(applyAction(s, "p0", { type: "move", to: { x: 1, y: 1 } }).ok).toBe(true);
    expect(battleOf(s, "p0")!.context.objectId).toBe("o0");
    return s;
  }

  it("autoBattle", () => {
    const s = doubleGuard();
    expect(applyAction(s, "p0", { type: "autoBattle" }).ok).toBe(true);
    expect(isInBattle(s, "p0")).toBe(false);
    expect(s.objects.every((o) => o.gone)).toBe(true);
  });

  it("forceEndDay", () => {
    const s = doubleGuard();
    expect(forceEndDay(s, "p0").ok).toBe(true);
    expect(s.day).toBe(2);
    expect(isInBattle(s, "p0")).toBe(false);
    expect(s.objects.every((o) => o.gone)).toBe(true);
  });
});
