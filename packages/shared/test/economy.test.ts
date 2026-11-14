import { describe, expect, it } from "vitest";
import type { GameState, PlayerState } from "../src";
import {
  AI_LEVEL_RULES, BUILDINGS, HERO_COST, aiWantsHero, isAiLevel, MAX_HEROES, applyAction, createGame, generateMap, getPlayer, heroesOf, income,
  isGameAction, ownedCastles, playerView, resourceIncome, reveal,
} from "../src";

function valley(players: "ai" | "pvp" = "ai"): GameState {
  return createGame({
    id: "g", mapId: "valley", seed: 7,
    players: [{ id: "p0", name: "A", isAI: false }, { id: "p1", name: "B", isAI: players === "ai" }],
  });
}

function me(s: GameState, id = "p0"): PlayerState {
  return getPlayer(s, id)!;
}

/** Puts p0's hero into its castle with plenty of gold and resources. */
function inCastle(s: GameState, gold = 20000): void {
  const p = me(s);
  const home = s.objects.find((o) => o.id === p.castleId)!;
  const h = s.heroes[p.heroId]!;
  h.x = home.x;
  h.y = home.y;
  p.gold = gold;
  p.res = { metal: 50, crystal: 50 };
  reveal(s, "p0");
}

describe("resources", () => {
  it("players start with metal and crystals and one hero", () => {
    const s = valley();
    expect(me(s).res).toEqual({ metal: 5, crystal: 2 });
    expect(me(s).heroIds).toEqual(["h0"]);
  });

  it("metal and crystal mines and the warehouse pay resources every morning", () => {
    const s = valley();
    const mines = s.objects.filter((o) => o.kind === "mine");
    mines[0]!.res = "metal";
    mines[0]!.owner = "p0";
    mines[1]!.res = "crystal";
    mines[1]!.owner = "p0";
    expect(income(s, "p0")).toBe(1000);
    expect(resourceIncome(s, "p0")).toEqual({ metal: 2, crystal: 1 });
    me(s).built.warehouse = true;
    expect(resourceIncome(s, "p0")).toEqual({ metal: 4, crystal: 2 });
    applyAction(s, "p0", { type: "endDay" });
    expect(me(s).res).toEqual({ metal: 9, crystal: 4 });
  });

  it("generated maps have metal and crystal mines", () => {
    for (const seed of [1, 2, 3]) {
      const map = generateMap(seed, "m");
      const kinds = new Set(map.objects.filter((o) => o.kind === "mine").map((o) => o.res ?? "gold"));
      expect([...kinds].sort()).toEqual(["crystal", "gold", "metal"]);
    }
  });

  it("capturing a metal mine says what it yields", () => {
    const s = valley();
    const mine = s.objects.find((o) => o.kind === "mine")!;
    mine.res = "metal";
    const h = s.heroes["h0"]!;
    h.x = mine.x - 1;
    h.y = mine.y;
    for (const o of s.objects) if (o.kind === "monster") o.gone = true;
    reveal(s, "p0");
    const r = applyAction(s, "p0", { type: "move", to: { x: mine.x, y: mine.y } });
    expect(r.ok).toBe(true);
    expect(r.events).toContainEqual({ type: "toast", player: "p0", text: "Рудник ваш: +2 металла в день" });
  });
});

describe("new buildings", () => {
  it("cost metal and crystals and respect their requirement", () => {
    const s = valley();
    inCastle(s);
    me(s).res = { metal: 4, crystal: 0 };
    expect(applyAction(s, "p0", { type: "build", building: "tavern" }).error).toBe("Не хватает ресурсов");
    expect(applyAction(s, "p0", { type: "build", building: "citadel" }).error).toMatch(/Нужна постройка: Форт/);
    me(s).res = { metal: 10, crystal: 0 };
    const r = applyAction(s, "p0", { type: "build", building: "fort" });
    expect(r.ok).toBe(true);
    expect(me(s).res).toEqual({ metal: 0, crystal: 0 });
    expect(r.events).toContainEqual({ type: "gold", player: "p0", amount: -BUILDINGS.fort.cost, reason: "build" });
  });

  it("the fort and the citadel raise weekly growth by half each; the citadel adds income", () => {
    const s = valley("pvp");
    const p = me(s);
    p.built.fort = true;
    p.built.citadel = true;
    expect(income(s, "p0")).toBe(1500);
    s.day = 7;
    p.growth = {};
    applyAction(s, "p0", { type: "endDay" });
    applyAction(s, "p1", { type: "endDay" });
    expect(p.growth).toEqual({ pike: 20, archer: 12 });
  });

  it("with a fort the castle garrison grows twice as fast", () => {
    const s = valley("pvp");
    me(s).built.fort = true;
    const home = s.objects.find((o) => o.id === me(s).castleId)!;
    s.day = 7;
    applyAction(s, "p0", { type: "endDay" });
    applyAction(s, "p1", { type: "endDay" });
    expect(home.garrison).toEqual([{ unit: "pike", count: 10 }]);
  });
});

describe("a second hero", () => {
  it("is hired in the tavern next to the castle, then the player switches between heroes", () => {
    const s = valley();
    inCastle(s);
    expect(applyAction(s, "p0", { type: "hireHero" }).error).toMatch(/Таверна/);
    me(s).built.tavern = true;
    const r = applyAction(s, "p0", { type: "hireHero" });
    expect(r.ok).toBe(true);
    const p = me(s);
    expect(p.gold).toBe(20000 - HERO_COST);
    expect(p.heroIds).toHaveLength(2);
    const second = s.heroes[p.heroIds![1]!]!;
    expect(second).toMatchObject({ owner: "p0", name: "Ратибор", level: 1, alive: true, army: [{ unit: "pike", count: 8 }] });
    const home = s.objects.find((o) => o.id === p.castleId)!;
    expect(Math.max(Math.abs(second.x - home.x), Math.abs(second.y - home.y))).toBe(1);
    expect(p.heroId).toBe("h0");
    expect(applyAction(s, "p0", { type: "hireHero" }).error).toBe(`Героев не больше ${MAX_HEROES}`);

    expect(applyAction(s, "p0", { type: "selectHero", hero: second.id }).ok).toBe(true);
    expect(p.heroId).toBe(second.id);
    expect(applyAction(s, "p0", { type: "selectHero", hero: "h1" }).error).toBe("Нет такого героя");
    // the second hero moves with the player's move action
    const to = { x: second.x, y: second.y - 1 };
    if (s.terrain[to.y]?.[to.x] === ".") {
      expect(applyAction(s, "p0", { type: "move", to }).ok).toBe(true);
      expect([second.x, second.y]).toEqual([to.x, to.y]);
    }
    // both heroes see and get their movement back in the morning
    const view = playerView(s, "p0");
    expect(Object.keys(view.state.heroes)).toEqual(expect.arrayContaining(["h0", second.id]));
    applyAction(s, "p0", { type: "endDay" });
    for (const h of heroesOf(s, p)) expect(h.mp).toBeGreaterThan(0);
  });

  it("losing the active hero switches to the other one, and the player is not out while a hero lives", () => {
    const s = valley();
    inCastle(s);
    me(s).built.tavern = true;
    applyAction(s, "p0", { type: "hireHero" });
    const p = me(s);
    const second = p.heroIds![1]!;
    for (const c of ownedCastles(s, "p0")) c.owner = "p1";
    const h0 = s.heroes["h0"]!;
    h0.army = [{ unit: "pike", count: 1 }];
    const wolves = s.objects.find((o) => o.kind === "monster")!;
    h0.x = wolves.x + 1;
    h0.y = wolves.y;
    reveal(s, "p0");
    const r = applyAction(s, "p0", { type: "move", to: { x: wolves.x, y: wolves.y } });
    if (r.ok && s.battles.length > 0) applyAction(s, "p0", { type: "autoBattle" });
    if (!h0.alive) {
      expect(p.heroId).toBe(second);
      expect(p.defeated).toBe(false);
    }
  });

  it("protocol accepts the new actions", () => {
    expect(isGameAction({ type: "hireHero" })).toBe(true);
    expect(isGameAction({ type: "selectHero", hero: "h0-1" })).toBe(true);
    expect(isGameAction({ type: "selectHero", hero: "" })).toBe(false);
    expect(isGameAction({ type: "selectHero" })).toBe(false);
    expect(isGameAction({ type: "hireHero", extra: 1 })).toBe(false);
  });

  it("the AI builds a tavern and hires a second hero on a random map", () => {
    const s = createGame({
      id: "g", mapId: "random-m", seed: 4,
      players: [{ id: "p0", name: "A", isAI: false }, { id: "p1", name: "B", isAI: true }],
    });
    me(s, "p1").gold = 30000;
    me(s, "p1").res = { metal: 40, crystal: 20 };
    for (let d = 0; d < 6 && s.winner === null; d++) applyAction(s, "p0", { type: "endDay" });
    expect(me(s, "p1").built.tavern).toBe(true);
    expect(me(s, "p1").heroIds).toHaveLength(2);
  });

  it("two heroes of one player never end up on the same tile", () => {
    const s = valley();
    inCastle(s);
    me(s).built.tavern = true;
    applyAction(s, "p0", { type: "hireHero" });
    const p = me(s);
    const second = s.heroes[p.heroIds![1]!]!;
    const h0 = s.heroes["h0"]!;
    expect(applyAction(s, "p0", { type: "selectHero", hero: second.id }).ok).toBe(true);
    // walking onto the friend stops next to it (the second hero starts next to the first)
    applyAction(s, "p0", { type: "move", to: { x: h0.x, y: h0.y } });
    expect([second.x, second.y]).not.toEqual([h0.x, h0.y]);
    const live = Object.values(s.heroes).filter((h) => h.alive).map((h) => `${h.x},${h.y}`);
    expect(new Set(live).size).toBe(live.length);
  });
});

describe("AI difficulty", () => {
  const game = (aiLevel?: "easy" | "normal" | "hard"): GameState =>
    createGame({
      id: "g", mapId: "valley", seed: 7, ...(aiLevel ? { aiLevel } : {}),
      players: [{ id: "p0", name: "A", isAI: false }, { id: "p1", name: "B", isAI: true }],
    });

  it("is stored only when it is not normal and gives the AI its start gold", () => {
    expect(game().aiLevel).toBeUndefined();
    expect(game("normal").aiLevel).toBeUndefined();
    const hard = game("hard");
    expect(hard.aiLevel).toBe("hard");
    expect(me(hard, "p1").gold).toBe(me(game(), "p1").gold + AI_LEVEL_RULES.hard.startGold);
    // the human always plays the plain game
    expect(me(hard, "p0").gold).toBe(me(game(), "p0").gold);
    expect(isAiLevel("hard")).toBe(true);
    expect(isAiLevel("nightmare")).toBe(false);
  });

  it("scales the AI's daily gold, never the human's", () => {
    const incomeOf = (lvl: "easy" | "normal" | "hard", who: string): number => {
      const s = game(lvl);
      const r = applyAction(s, "p0", { type: "endDay" });
      const e = r.events.find((x) => x.type === "gold" && x.player === who && x.reason === "income");
      return e && e.type === "gold" ? e.amount : -1;
    };
    const base = incomeOf("normal", "p1");
    expect(base).toBeGreaterThan(0);
    expect(incomeOf("easy", "p1")).toBe(Math.round(base * AI_LEVEL_RULES.easy.income));
    expect(incomeOf("hard", "p1")).toBe(Math.round(base * AI_LEVEL_RULES.hard.income));
    expect(incomeOf("hard", "p0")).toBe(incomeOf("normal", "p0"));
  });

  it("on easy the AI never hires a second hero", () => {
    const s = game("easy");
    const ai = me(s, "p1");
    ai.built.tavern = true;
    ai.gold = 50000;
    expect(aiWantsHero(s, "p1")).toBeNull();
    const n = game("hard");
    me(n, "p1").built.tavern = true;
    me(n, "p1").gold = 50000;
    expect(aiWantsHero(n, "p1")).not.toBeNull();
  });

  it("survives a JSON round trip and plays on", () => {
    const s = game("hard");
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    expect(copy).toStrictEqual(s);
    for (let d = 0; d < 5; d++) applyAction(copy, "p0", { type: "endDay" });
    expect(copy.aiLevel).toBe("hard");
  });
});
