import { describe, expect, it } from "vitest";
import type { WorldState } from "../src";
import {
  BOSS_REWARD, CLAN_CREATE_COST, ENERGY_MAX, WORLD_COLS, WORLD_LAYOUT, WORLD_ROWS, WORLD_START_GOLD,
  applyWorldAction, advanceWorld, bossArmy, createWorld, reachableSectors, sectorId, sectorNeighbors, worldView,
} from "../src";

const DAY = 60_000;

function world(seasonDays = 28): WorldState {
  return createWorld({ seed: 7, now: 0, dayMs: DAY, seasonDays });
}

const alice = { id: "u:alice", name: "Алиса" };
const bob = { id: "u:bob", name: "Боб" };

describe("world layout", () => {
  it("is a 9x9 grid with the Citadel in the centre", () => {
    expect(WORLD_LAYOUT).toHaveLength(WORLD_ROWS);
    for (const row of WORLD_LAYOUT) expect(row).toHaveLength(WORLD_COLS);
    const w = world();
    expect(w.sectors).toHaveLength(WORLD_COLS * WORLD_ROWS);
    expect(w.sectors[sectorId(4, 4)]?.kind).toBe("citadel");
    expect(sectorNeighbors(sectorId(0, 0)).sort((a, b) => a - b)).toEqual([1, 9, 10]);
    expect(sectorNeighbors(sectorId(4, 4))).toHaveLength(8);
  });

  it("starts with raider clans holding a few sectors, and is plain JSON", () => {
    const w = world();
    const bots = Object.values(w.players).filter((p) => p.bot);
    expect(bots.length).toBeGreaterThan(0);
    expect(w.sectors.filter((s) => s.holder).length).toBe(bots.length);
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });

  it("is deterministic for a seed", () => {
    const a = world();
    const b = world();
    advanceWorld(a, DAY * 10);
    advanceWorld(b, DAY * 10);
    expect(a).toEqual(b);
  });
});

describe("joining and attacking", () => {
  it("gives a new player a rim camp, an army, gold and full energy", () => {
    const w = world();
    expect(applyWorldAction(w, alice, { type: "join", faction: "castle" }, 0).ok).toBe(true);
    const p = w.players[alice.id];
    expect(p?.gold).toBe(WORLD_START_GOLD);
    expect(p?.energy).toBe(ENERGY_MAX);
    expect(p?.army.length).toBeGreaterThan(0);
    const camp = w.sectors[p?.camp ?? -1];
    expect(camp && (camp.x === 0 || camp.y === 0 || camp.x === 8 || camp.y === 8)).toBe(true);
    expect(applyWorldAction(w, alice, { type: "join", faction: "castle" }, 0).ok).toBe(false);
  });

  it("only allows attacks next to your land and spends energy", () => {
    const w = world();
    applyWorldAction(w, alice, { type: "join", faction: "castle" }, 0);
    const far = w.sectors.find((s) => !reachableSectors(w, alice.id).includes(s.id));
    expect(far).toBeDefined();
    const r = applyWorldAction(w, alice, { type: "attack", sector: far?.id ?? 0 }, 0);
    expect(r.ok).toBe(false);
    const target = reachableSectors(w, alice.id)[0] ?? 0;
    const ok = applyWorldAction(w, alice, { type: "attack", sector: target }, 0);
    expect(ok.ok).toBe(true);
    expect(ok.report?.sector).toBe(target);
    expect(w.players[alice.id]?.energy).toBe(ENERGY_MAX - 1);
  });

  it("captures a weak neutral sector, leaves a garrison and pays loot", () => {
    const w = world();
    applyWorldAction(w, alice, { type: "join", faction: "castle" }, 0);
    const target = reachableSectors(w, alice.id).find((id) => w.sectors[id]?.kind === "waste" && !w.sectors[id]?.holder) ?? 0;
    const sec = w.sectors[target];
    if (sec) sec.guard = [{ unit: "wolf", count: 1 }];
    const r = applyWorldAction(w, alice, { type: "attack", sector: target }, 0);
    expect(r.report?.won).toBe(true);
    expect(w.sectors[target]?.holder).toBe(alice.id);
    expect(w.sectors[target]?.guard.length).toBeGreaterThan(0);
    expect(w.players[alice.id]?.gold).toBe(WORLD_START_GOLD + (r.report?.gold ?? 0));
    expect(r.report?.gold).toBeGreaterThan(0);
  });

  it("runs out of energy and restores it over time", () => {
    const w = world();
    applyWorldAction(w, alice, { type: "join", faction: "castle" }, 0);
    const p = w.players[alice.id];
    if (p) p.energy = 0;
    const target = reachableSectors(w, alice.id)[0] ?? 0;
    expect(applyWorldAction(w, alice, { type: "attack", sector: target }, 0).error).toMatch(/энерги/);
    const v = worldView(w, alice.id, DAY / 2);
    expect(v.me?.energy).toBeGreaterThan(0);
  });

  it("pays income from held sectors every day and grows recruits", () => {
    const w = world();
    applyWorldAction(w, alice, { type: "join", faction: "castle" }, 0);
    const sec = w.sectors.find((s) => s.kind === "mine" && !s.holder);
    if (sec) sec.holder = alice.id;
    const gold = w.players[alice.id]?.gold ?? 0;
    advanceWorld(w, DAY);
    expect(w.day).toBe(2);
    expect(w.players[alice.id]?.gold).toBeGreaterThan(gold);
    expect(applyWorldAction(w, alice, { type: "hire" }, DAY).ok).toBe(true);
  });
});

describe("clans", () => {
  it("creates, joins, donates and leaves", () => {
    const w = world();
    applyWorldAction(w, alice, { type: "join", faction: "castle" }, 0);
    applyWorldAction(w, bob, { type: "join", faction: "necropolis" }, 0);
    expect(applyWorldAction(w, alice, { type: "createClan", name: "Волки", tag: "vlk" }, 0).ok).toBe(true);
    const clanId = w.players[alice.id]?.clanId ?? "";
    expect(w.clans[clanId]?.tag).toBe("VLK");
    expect(w.players[alice.id]?.gold).toBe(WORLD_START_GOLD - CLAN_CREATE_COST);
    expect(applyWorldAction(w, bob, { type: "createClan", name: "волки", tag: "XX" }, 0).ok).toBe(false);
    expect(applyWorldAction(w, bob, { type: "joinClan", clanId }, 0).ok).toBe(true);
    expect(applyWorldAction(w, bob, { type: "donate", amount: 300 }, 0).ok).toBe(true);
    expect(w.clans[clanId]?.treasury).toBe(300);
    expect(applyWorldAction(w, alice, { type: "leaveClan" }, 0).ok).toBe(true);
    expect(w.clans[clanId]?.leader).toBe(bob.id);
    expect(applyWorldAction(w, bob, { type: "leaveClan" }, 0).ok).toBe(true);
    expect(w.clans[clanId]).toBeUndefined();
  });

  it("lets clan members attack from each other's land but not each other", () => {
    const w = world();
    applyWorldAction(w, alice, { type: "join", faction: "castle" }, 0);
    applyWorldAction(w, bob, { type: "join", faction: "castle" }, 0);
    applyWorldAction(w, alice, { type: "createClan", name: "Волки", tag: "VLK" }, 0);
    applyWorldAction(w, bob, { type: "joinClan", clanId: w.players[alice.id]?.clanId ?? "" }, 0);
    const sec = w.sectors[sectorId(4, 3)];
    if (sec) sec.holder = alice.id;
    expect(reachableSectors(w, bob.id)).toContain(sectorId(4, 4));
    expect(applyWorldAction(w, bob, { type: "attack", sector: sectorId(4, 3) }, 0).ok).toBe(false);
  });

  it("does not let anyone join a raider clan", () => {
    const w = world();
    applyWorldAction(w, alice, { type: "join", faction: "castle" }, 0);
    const bot = Object.values(w.clans).find((c) => c.bot);
    expect(applyWorldAction(w, alice, { type: "joinClan", clanId: bot?.id ?? "" }, 0).ok).toBe(false);
  });
});

describe("events and seasons", () => {
  it("spawns a boss and a supply cache as the days pass", () => {
    const w = world();
    advanceWorld(w, DAY * 2);
    expect(w.events.some((e) => e.kind === "boss")).toBe(true);
    expect(w.events.some((e) => e.kind === "cache")).toBe(true);
    const boss = w.events.find((e) => e.kind === "boss");
    expect(w.sectors[boss?.sector ?? -1]?.guard).toEqual(bossArmy(1));
  });

  it("rewards the player who kills the boss", () => {
    const w = world();
    applyWorldAction(w, alice, { type: "join", faction: "castle" }, 0);
    advanceWorld(w, DAY * 2);
    const boss = w.events.find((e) => e.kind === "boss");
    const sec = w.sectors[boss?.sector ?? -1];
    const p = w.players[alice.id];
    if (!sec || !p || !boss) throw new Error("no boss");
    p.camp = sectorNeighbors(sec.id)[0] ?? p.camp;
    sec.guard = [{ unit: "wolf", count: 1 }];
    const gold = p.gold;
    const r = applyWorldAction(w, alice, { type: "attack", sector: sec.id }, DAY * 2);
    expect(r.report?.bossKilled).toBe(true);
    expect(p.gold).toBeGreaterThanOrEqual(gold + BOSS_REWARD);
    expect(w.events.some((e) => e.id === boss.id)).toBe(false);
  });

  it("ends the season, writes the hall of fame and starts a fresh map with the same players and clans", () => {
    const w = world(3);
    applyWorldAction(w, alice, { type: "join", faction: "castle" }, 0);
    applyWorldAction(w, alice, { type: "createClan", name: "Волки", tag: "VLK" }, 0);
    const citadel = w.sectors[sectorId(4, 4)];
    if (citadel) citadel.holder = alice.id;
    advanceWorld(w, DAY * 3);
    expect(w.season).toBe(2);
    expect(w.day).toBe(1);
    expect(w.hallOfFame[0]).toMatchObject({ season: 1, tag: "VLK", player: "Алиса" });
    expect(w.players[alice.id]?.gold).toBe(WORLD_START_GOLD);
    expect(w.players[alice.id]?.clanId).toBeTruthy();
    expect(w.sectors.some((s) => s.holder === alice.id)).toBe(false);
  });
});

describe("world view", () => {
  it("hides foreign garrison sizes and shows your own", () => {
    const w = world();
    applyWorldAction(w, alice, { type: "join", faction: "castle" }, 0);
    const own = w.sectors[sectorId(2, 0)];
    if (own) {
      own.holder = alice.id;
      own.guard = [{ unit: "pike", count: 7 }];
    }
    const v = worldView(w, alice.id, 0);
    expect(v.sectors[sectorId(2, 0)]?.guard).toEqual([{ unit: "pike", count: 7 }]);
    const foreign = v.sectors.find((s) => s.holder && s.holder !== alice.id);
    expect(foreign?.guard.every((g) => g.count === 0 && typeof g.countHint === "string")).toBe(true);
    expect(v.me?.rank).toBeGreaterThan(0);
    expect(worldView(w, null, 0).me).toBeNull();
  });
});
