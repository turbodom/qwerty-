import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findPath } from "@korony/shared";
import type { GameEvent, PlayerView } from "@korony/shared";
import { LOCAL_AI_ID, LOCAL_HUMAN_ID, LocalGame, randomSeed } from "../src/net/local";
import { STORAGE_KEYS, memoryStorage } from "../src/storage";

type Mem = ReturnType<typeof memoryStorage>;
const g = globalThis as { localStorage?: unknown };
let mem: Mem;

beforeEach(() => {
  mem = memoryStorage();
  g.localStorage = mem;
});

afterEach(() => {
  delete g.localStorage;
});

function hero(view: PlayerView) {
  const me = view.state.players.find((p) => p.id === view.you);
  if (!me) throw new Error("no player");
  const h = view.state.heroes[me.heroId];
  if (!h) throw new Error("no hero");
  return { me, h };
}

describe("LocalGame", () => {
  it("creates a game with the human at seat 0 and the AI at seat 1, and saves it", () => {
    const game = LocalGame.create({ seed: 12345, mapId: "valley" });
    const view = game.view;
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.you).toBe(LOCAL_HUMAN_ID);
    const seats = Object.fromEntries(view.state.players.map((p) => [p.id, p.seat]));
    expect(seats).toEqual({ [LOCAL_HUMAN_ID]: 0, [LOCAL_AI_ID]: 1 });
    expect(view.state.players.find((p) => p.id === LOCAL_AI_ID)?.isAI).toBe(true);
    expect(view.state.day).toBe(1);
    // the view is fogged: the opponent's gold and the game rng are hidden
    expect(view.state.rngState).toBe(0);
    expect(view.state.players.find((p) => p.id === LOCAL_AI_ID)?.gold).toBe(0);
    expect(mem.getItem(STORAGE_KEYS.localSave)).not.toBeNull();
    expect(LocalGame.savedDay()).toBe(1);
  });

  it("plays a fresh random map by default", () => {
    const a = LocalGame.create({ seed: 1 }).snapshot();
    const b = LocalGame.create({ seed: 2 }).snapshot();
    expect(a.mapId).toBe("random-m");
    expect([a.cols, a.rows]).toEqual([39, 39]);
    expect(JSON.stringify(a.terrain)).not.toBe(JSON.stringify(b.terrain));
  });

  it("uses crypto for seeds", () => {
    const a = randomSeed();
    const b = randomSeed();
    expect(Number.isInteger(a) && a >= 0 && a <= 0xffffffff).toBe(true);
    expect(a === b && a === randomSeed()).toBe(false);
  });

  it("moves the hero, notifies subscribers and persists after the action", async () => {
    const game = LocalGame.create({ seed: 7, mapId: "valley" });
    const seen: { view: PlayerView; events: GameEvent[] }[] = [];
    const unsub = game.subscribe((view, events) => seen.push({ view, events }));
    expect(seen).toHaveLength(1); // current view right away
    const before = game.view as PlayerView;
    const { h } = hero(before);
    expect({ x: h.x, y: h.y }).toEqual({ x: 3, y: 13 });
    const to = { x: 5, y: 14 };
    const path = findPath(before.state, h.id, to);
    expect(path.length).toBe(2);

    const res = await game.send({ type: "move", to });
    expect(res.ok).toBe(true);
    const moved = res.events?.find((e) => e.type === "moved");
    expect(moved && moved.type === "moved" ? moved.path : []).toEqual(path);
    expect(seen).toHaveLength(2);
    const after = hero(game.view as PlayerView).h;
    expect({ x: after.x, y: after.y, mp: after.mp }).toEqual({ x: 5, y: 14, mp: h.mp - 2 });

    const saved = LocalGame.load();
    expect(saved).not.toBeNull();
    expect(hero(saved?.view as PlayerView).h).toMatchObject({ x: 5, y: 14 });
    unsub();
  });

  it("rejects illegal actions without touching the state or the save", async () => {
    const game = LocalGame.create({ seed: 99, mapId: "valley" });
    const raw = mem.getItem(STORAGE_KEYS.localSave);
    const res = await game.send({ type: "build", building: "forge" }); // hero is not in the castle
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe("string");
    expect(mem.getItem(STORAGE_KEYS.localSave)).toBe(raw);
  });

  it("endDay advances the day, runs the AI and gives income", async () => {
    const game = LocalGame.create({ seed: 2024, mapId: "valley" });
    const gold0 = hero(game.view as PlayerView).me.gold;
    await game.send({ type: "move", to: { x: 5, y: 14 } });
    const res = await game.send({ type: "endDay" });
    expect(res.ok).toBe(true);
    const view = game.view as PlayerView;
    expect(view.state.day).toBe(2);
    expect(res.events?.some((e) => e.type === "newDay" && e.day === 2)).toBe(true);
    const { me, h } = hero(view);
    expect(me.gold).toBe(gold0 + 1000);
    expect(me.endedDay).toBe(false);
    expect(h.mp).toBe(12);
    expect(LocalGame.savedDay()).toBe(2);
  });

  it("save/load round trip restores the exact state", async () => {
    const game = LocalGame.create({ seed: 31337, mapId: "valley" });
    await game.send({ type: "move", to: { x: 5, y: 14 } });
    await game.send({ type: "endDay" });
    const snap = game.snapshot();
    game.leave();

    const loaded = LocalGame.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.snapshot()).toEqual(snap);
    expect(loaded?.view).toEqual(game.view);

    // the loaded game keeps playing deterministically from the same state
    const again = LocalGame.load();
    const r1 = await loaded?.send({ type: "endDay" });
    const r2 = await again?.send({ type: "endDay" });
    expect(r1?.ok).toBe(true);
    expect(loaded?.snapshot()).toEqual(again?.snapshot());
    expect(r2?.events).toEqual(r1?.events);
  });

  it("ignores missing or corrupt saves", () => {
    expect(LocalGame.load()).toBeNull();
    mem.setItem(STORAGE_KEYS.localSave, "{not json");
    expect(LocalGame.load()).toBeNull();
    mem.setItem(STORAGE_KEYS.localSave, JSON.stringify({ v: 1, state: { version: 2 } }));
    expect(LocalGame.load()).toBeNull();
    expect(LocalGame.savedDay()).toBeNull();
  });

  it("walking into a guarded tile starts a battle that autoBattle finishes", async () => {
    const game = LocalGame.create({ seed: 5, mapId: "valley" });
    // (4,12) is next to the wolves at (4,11)
    const res = await game.send({ type: "move", to: { x: 4, y: 12 } });
    expect(res.ok).toBe(true);
    expect(res.events?.some((e) => e.type === "battleStart")).toBe(true);
    let view = game.view as PlayerView;
    expect(view.state.battles).toHaveLength(1);
    const auto = await game.send({ type: "autoBattle" });
    expect(auto.ok).toBe(true);
    expect(auto.events?.some((e) => e.type === "battleEnd")).toBe(true);
    view = game.view as PlayerView;
    expect(view.state.battles).toHaveLength(0);
  });
});
