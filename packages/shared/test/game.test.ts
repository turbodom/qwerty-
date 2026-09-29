import { describe, expect, it } from "vitest";
import type {
  ActionResult, ArtifactId, BattleAction, GameAction, GameEvent, GameState, PlayerSetup, Point, Rng, SkillId,
} from "../src";
import {
  ARTIFACT_IDS, BUILDING_IDS, SKILLS, SKILL_IDS, SLOTS, START_GROWTH, UNIT_IDS,
  activeStack, applyAction, battleOf, chooseAiBattleAction, createGame, createRng, eventsForPlayer, forceEndDay,
  getPlayer, heroCastle, humanPlayers, income, isExplored, isInBattle, maxMovement, planAiMove, playerHero,
  playerView, reveal,
} from "../src";

// ================= helpers =================

const HUMAN: PlayerSetup = { id: "p0", name: "Игрок", isAI: false };
const AI0: PlayerSetup = { id: "p0", name: "ИИ-1", isAI: true };
const AI1: PlayerSetup = { id: "p1", name: "ИИ-2", isAI: true };
const HUMAN1: PlayerSetup = { id: "p1", name: "Соперник", isAI: false };

type Mode = "ai" | "passive" | "active" | "pvp";

function newGame(seed = 1, players: [PlayerSetup, PlayerSetup] = [HUMAN, AI1]): GameState {
  return createGame({ id: "g", mapId: "valley", seed, players });
}

/** applyAction that also checks that a rejected action leaves the state untouched. */
function act(s: GameState, pid: string, action: GameAction): ActionResult {
  const before = JSON.stringify(s);
  const r = applyAction(s, pid, action);
  if (!r.ok) {
    expect(typeof r.error).toBe("string");
    expect(r.events).toEqual([]);
    expect(JSON.stringify(s)).toBe(before);
  }
  return r;
}

function must(s: GameState, pid: string, action: GameAction): ActionResult {
  const r = act(s, pid, action);
  if (!r.ok) throw new Error(`${pid} ${JSON.stringify(action)}: ${r.error}`);
  return r;
}

function expectRejected(s: GameState, pid: string, action: GameAction, error: string | RegExp): void {
  const before = JSON.stringify(s);
  const r = applyAction(s, pid, action);
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(error);
  expect(r.events).toEqual([]);
  expect(JSON.stringify(s)).toBe(before);
}

function teleport(s: GameState, heroId: string, x: number, y: number): void {
  const h = s.heroes[heroId]!;
  h.x = x;
  h.y = y;
  reveal(s, h.owner);
}

function player(s: GameState, id: string) {
  const p = getPlayer(s, id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

function expectJsonPlain(s: GameState): void {
  expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
}

/** Lets the AI finish every battle for all humans that take part in it. */
function settleBattles(s: GameState): void {
  for (let i = 0; i < 20 && s.battles.length > 0 && s.winner === null; i++) {
    const ab = s.battles[0]!;
    for (const side of ab.sides) {
      const p = side === "neutral" ? undefined : getPlayer(s, side);
      if (p && !p.isAI && !p.defeated && s.winner === null && s.battles.includes(ab)) must(s, p.id, { type: "autoBattle" });
    }
  }
  expect(s.winner !== null || s.battles.length === 0).toBe(true);
}

/** A scripted "human": settles battles, picks skills, and (when active) shops and walks like the AI would. */
function botTurn(s: GameState, pid: string, active: boolean): void {
  for (let i = 0; i < 40 && s.winner === null; i++) {
    const p = player(s, pid);
    if (p.defeated) return;
    if (isInBattle(s, pid)) {
      settleBattles(s);
      continue;
    }
    while (p.levelChoices.length > 0) must(s, pid, { type: "chooseSkill", index: (i % 2) as 0 | 1 });
    if (!active) return;
    if (heroCastle(s, pid)) {
      for (const b of BUILDING_IDS) act(s, pid, { type: "build", building: b });
      for (const u of UNIT_IDS) act(s, pid, { type: "upgrade", unit: u });
      for (const u of UNIT_IDS) act(s, pid, { type: "hire", unit: u });
    }
    const h = playerHero(s, pid)!;
    for (const a of [...h.bag]) act(s, pid, { type: "equip", artifact: a });
    if (!h.alive || h.mp <= 0) return;
    let target: Point | null = null;
    for (const pt of planAiMove(s, pid)) if (isExplored(s, pid, pt.x, pt.y)) target = pt;
    if (!target || !act(s, pid, { type: "move", to: target }).ok) return;
  }
}

function playDay(s: GameState, mode: Mode): void {
  if (mode === "ai") {
    const p = s.players.find((q) => !q.defeated)!;
    must(s, p.id, { type: "endDay" });
    return;
  }
  for (const p of s.players) {
    if (p.isAI || p.defeated || s.winner !== null) continue;
    botTurn(s, p.id, mode !== "passive");
    if (s.winner !== null || p.defeated) continue;
    settleBattles(s);
    if (s.winner === null && !p.endedDay) must(s, p.id, { type: "endDay" });
  }
}

function simulate(seed: number, mode: Mode, days = 40, from?: GameState): GameState {
  const players: [PlayerSetup, PlayerSetup] =
    mode === "ai" ? [AI0, AI1] : mode === "pvp" ? [HUMAN, HUMAN1] : [HUMAN, AI1];
  const s = from ?? newGame(seed, players);
  for (let d = 0; d < days && s.winner === null; d++) {
    const day = s.day;
    playDay(s, mode);
    if (s.winner === null) expect(s.day).toBe(day + 1);
    for (const p of s.players) if (p.isAI) expect(p.levelChoices).toEqual([]);
  }
  return s;
}

// ================= createGame =================

describe("createGame", () => {
  it("lays out the valley like the prototype", () => {
    const s = newGame(42);
    expect(s.version).toBe(1);
    expect(s.day).toBe(1);
    expect(s.rngState).toBe(42);
    expect(s.winner).toBeNull();
    expect(s.battles).toEqual([]);
    const [p0, p1] = s.players;
    expect(p0).toMatchObject({ id: "p0", seat: 0, faction: "castle", gold: 2500, isAI: false, heroId: "h0", defeated: false });
    expect(p1).toMatchObject({ id: "p1", seat: 1, faction: "necropolis", gold: 2500, isAI: true, heroId: "h1" });
    expect(p0!.growth).toEqual(START_GROWTH.castle);
    expect(p1!.growth).toEqual(START_GROWTH.necropolis);
    const h0 = s.heroes["h0"]!;
    const h1 = s.heroes["h1"]!;
    expect([h0.x, h0.y, h0.mp, h0.level, h0.exp, h0.alive]).toEqual([3, 13, 12, 1, 0, true]);
    expect(h0.army).toEqual([{ unit: "pike", count: 20 }, { unit: "archer", count: 10 }]);
    expect(h1.name).toBe("Моргот");
    expect(h1.equipped).toEqual({ weapon: "ashBlade", shield: "shield" });
    const c0 = s.objects.find((o) => o.id === p0!.castleId)!;
    const c1 = s.objects.find((o) => o.id === p1!.castleId)!;
    expect([c0.x, c0.y, c0.owner]).toEqual([2, 14, "p0"]);
    expect([c1.x, c1.y, c1.owner]).toEqual([11, 1, "p1"]);
    expect(c1.garrison).toEqual([{ unit: "skeleton", count: 20 }, { unit: "ghost", count: 3 }]);
    expect(s.objects.filter((o) => o.kind === "mine").every((o) => o.owner === null)).toBe(true);
    expect(s.objects.filter((o) => o.kind === "monster").length).toBe(7);
    expect(isExplored(s, "p0", 3, 13)).toBe(true);
    expect(isExplored(s, "p0", 11, 1)).toBe(false);
    expect(isExplored(s, "p1", 11, 1)).toBe(true);
    expect(humanPlayers(s).map((p) => p.id)).toEqual(["p0"]);
  });

  it("is deterministic and plain JSON", () => {
    const a = newGame(7);
    const b = newGame(7);
    expect(a).toStrictEqual(b);
    expectJsonPlain(a);
    expect(newGame(8).rngState).not.toBe(a.rngState);
  });

  it("applies loadouts: artifact equipped when the slot is free, bagged otherwise; gold and banner", () => {
    const s = createGame({
      id: "g", mapId: "valley", seed: 1,
      players: [
        { id: "a", name: "A", isAI: false, loadout: { startArtifact: "boots", startGold: 1000, banner: "gold" } },
        { id: "b", name: "B", isAI: false, loadout: { startArtifact: "shield" } },
      ],
    });
    const a = player(s, "a");
    const b = player(s, "b");
    expect(a.gold).toBe(3500);
    expect(a.banner).toBe("gold");
    expect(s.heroes["h0"]!.equipped.feet).toBe("boots");
    expect(s.heroes["h0"]!.mp).toBe(15);
    expect(b.gold).toBe(2500);
    expect(b.banner).toBeUndefined();
    expect("banner" in b).toBe(false);
    expect(s.heroes["h1"]!.bag).toEqual(["shield"]);
    expectJsonPlain(s);
  });

  it("rejects unknown maps and duplicate player ids", () => {
    expect(() => createGame({ id: "g", mapId: "nope", seed: 1, players: [HUMAN, AI1] })).toThrow();
    expect(() => createGame({ id: "g", mapId: "valley", seed: 1, players: [HUMAN, { ...AI1, id: "p0" }] })).toThrow();
  });
});

// ================= validation =================

describe("invalid actions are rejected without mutating the state", () => {
  it("rejects malformed input, unknown players and bad moves", () => {
    const s = newGame(3);
    expectRejected(s, "zz", { type: "endDay" }, /игрока/);
    expectRejected(s, "p0", { type: "fly" } as unknown as GameAction, /Неверное действие/);
    expectRejected(s, "p0", { type: "endDay", extra: 1 } as unknown as GameAction, /Неверное действие/);
    expectRejected(s, "p0", { type: "move", to: { x: 99, y: 0 } }, /Неверная клетка/);
    expectRejected(s, "p0", { type: "move", to: { x: 3, y: 13 } }, /уже здесь/);
    expectRejected(s, "p0", { type: "move", to: { x: 11, y: 1 } }, /туман/);
    expectRejected(s, "p0", { type: "move", to: { x: 6, y: 11 } }, /не пройти/); // water
    s.heroes["h0"]!.mp = 0;
    expectRejected(s, "p0", { type: "move", to: { x: 4, y: 13 } }, /Шаги/);
  });

  it("rejects castle actions outside the castle, without gold, growth, buildings or forge", () => {
    const s = newGame(3);
    expectRejected(s, "p0", { type: "hire", unit: "pike" }, /в своём замке/);
    expectRejected(s, "p0", { type: "build", building: "forge" }, /в своём замке/);
    expectRejected(s, "p0", { type: "upgrade", unit: "pike" }, /в своём замке/);
    teleport(s, "h0", 2, 14);
    const p = player(s, "p0");
    expectRejected(s, "p0", { type: "hire", unit: "griffin" }, /Грифонья башня/);
    expectRejected(s, "p0", { type: "hire", unit: "skeleton" }, /не нанять/);
    expectRejected(s, "p0", { type: "hire", unit: "halberd" }, /не нанять/);
    expectRejected(s, "p0", { type: "upgrade", unit: "pike" }, /Кузница/);
    p.built.forge = true;
    expectRejected(s, "p0", { type: "upgrade", unit: "griffin" }, /нет в армии/);
    expectRejected(s, "p0", { type: "upgrade", unit: "halberd" }, /нельзя улучшить/);
    expectRejected(s, "p0", { type: "build", building: "forge" }, /Уже построено/);
    p.builtToday = true;
    expectRejected(s, "p0", { type: "build", building: "mageGuild" }, /Сегодня уже строили/);
    p.builtToday = false;
    p.growth.pike = 0;
    expectRejected(s, "p0", { type: "hire", unit: "pike" }, /Нет доступных/);
    p.gold = 10;
    expectRejected(s, "p0", { type: "hire", unit: "archer" }, /Не хватает золота/);
    expectRejected(s, "p0", { type: "build", building: "mageGuild" }, /Не хватает золота/);
    expectRejected(s, "p0", { type: "upgrade", unit: "archer" }, /Не хватает золота/);
    p.gold = 100000;
    s.heroes["h0"]!.army = [
      { unit: "pike", count: 1 }, { unit: "halberd", count: 1 }, { unit: "marksman", count: 1 },
      { unit: "griffin", count: 1 }, { unit: "royalGriffin", count: 1 },
    ];
    expectRejected(s, "p0", { type: "hire", unit: "archer" }, /не больше 5/);
  });

  it("does not offer the griffin tower to the necropolis", () => {
    const s = newGame(3, [HUMAN, HUMAN1]);
    teleport(s, "h1", 11, 1);
    expectRejected(s, "p1", { type: "build", building: "griffinTower" }, /недоступна/);
    must(s, "p1", { type: "build", building: "forge" });
  });

  it("rejects hero screen, skill and battle actions that do not apply", () => {
    const s = newGame(3);
    expectRejected(s, "p0", { type: "equip", artifact: "crown" }, /нет в рюкзаке/);
    expectRejected(s, "p0", { type: "unequip", slot: "head" }, /Слот пуст/);
    expectRejected(s, "p0", { type: "chooseSkill", index: 0 }, /Нет навыка/);
    expectRejected(s, "p0", { type: "battle", action: { type: "defend" } }, /не в бою/);
    expectRejected(s, "p0", { type: "autoBattle" }, /не в бою/);
  });

  it("blocks the map while a battle runs and rejects illegal battle moves", () => {
    const s = newGame(3);
    must(s, "p0", { type: "move", to: { x: 4, y: 12 } }); // guarded by the wolves at (4,11)
    expect(isInBattle(s, "p0")).toBe(true);
    expectRejected(s, "p0", { type: "move", to: { x: 3, y: 13 } }, /закончите бой/);
    expectRejected(s, "p0", { type: "endDay" }, /закончите бой/);
    expectRejected(s, "p0", { type: "equip", artifact: "sword" }, /закончите бой/);
    expectRejected(s, "p0", { type: "battle", action: { type: "move", to: [99, 99] } }, /.+/);
    expectRejected(s, "p0", { type: "battle", action: { type: "shoot", target: 12345 } }, /.+/);
    expectRejected(s, "p0", { type: "battle", action: { type: "cast", spell: "heal", target: 0 } }, /заклинания/);
  });

  it("rejects actions after the day was ended, repeated endDay, and opponents' battle turns", () => {
    const s = newGame(3, [HUMAN, HUMAN1]);
    must(s, "p0", { type: "endDay" });
    expect(s.day).toBe(1);
    expectRejected(s, "p0", { type: "endDay" }, /уже завершили/);
    expectRejected(s, "p0", { type: "move", to: { x: 4, y: 13 } }, /завершили день/);
    // p1 attacks p0's hero: the ghosts (speed 5) of p1 move first, so p0 has to wait
    teleport(s, "h1", 4, 14);
    must(s, "p1", { type: "move", to: { x: 3, y: 13 } });
    const ab = battleOf(s, "p0")!;
    expect(ab.sides).toEqual(["p1", "p0"]);
    expect(ab.context.kind).toBe("hero");
    const active = activeStack(ab.battle)!;
    const waiting = ab.sides[active.side] === "p0" ? "p1" : "p0";
    expectRejected(s, waiting, { type: "battle", action: { type: "defend" } }, /противник/);
  });

  it("rejects everything once a player is defeated or the game is over", () => {
    const s = newGame(3);
    player(s, "p1").defeated = true;
    expectRejected(s, "p1", { type: "endDay" }, /выбыли/);
    s.winner = "p0";
    expectRejected(s, "p0", { type: "endDay" }, /окончена/);
  });
});

// ================= map interactions =================

describe("map interactions", () => {
  it("opens a chest: +1000 gold and the chest quest", () => {
    const s = newGame(5);
    teleport(s, "h0", 0, 8);
    const r = must(s, "p0", { type: "move", to: { x: 0, y: 9 } });
    expect(player(s, "p0").gold).toBe(2500 + 1000 + 500);
    expect(player(s, "p0").quests.chest).toBe(true);
    expect(s.objects.find((o) => o.x === 0 && o.y === 9)!.gone).toBe(true);
    expect(r.events[0]).toEqual({ type: "moved", heroId: "h0", path: [{ x: 0, y: 9 }] });
    expect(r.events).toContainEqual({ type: "gold", player: "p0", amount: 1000, reason: "chest" });
    expect(r.events).toContainEqual({ type: "quest", player: "p0", quest: "chest" });
    expect(s.heroes["h0"]!.mp).toBe(11);
  });

  it("captures a mine: income +500 and the mine quest", () => {
    const s = newGame(5);
    teleport(s, "h0", 6, 8);
    const r = must(s, "p0", { type: "move", to: { x: 7, y: 8 } });
    const mine = s.objects.find((o) => o.x === 7 && o.y === 8)!;
    expect(mine.owner).toBe("p0");
    expect(r.events).toContainEqual({ type: "mine", player: "p0", objectId: mine.id });
    expect(player(s, "p0").gold).toBe(3500);
    expect(income(s, "p0")).toBe(1500);
  });

  it("picks up an artifact into a free slot and completes the artifact quest", () => {
    const s = newGame(5);
    teleport(s, "h0", 13, 8);
    const r = must(s, "p0", { type: "move", to: { x: 13, y: 9 } });
    expect(s.heroes["h0"]!.equipped.ring1).toBe("apprenticeRing");
    expect(r.events).toContainEqual({ type: "artifact", player: "p0", artifact: "apprenticeRing" });
    expect(player(s, "p0").quests.artifact).toBe(true);
    expect(player(s, "p0").gold).toBe(3500);
  });

  it("walks only as far as movement points allow", () => {
    const s = newGame(5);
    s.heroes["h0"]!.mp = 2;
    const r = must(s, "p0", { type: "move", to: { x: 7, y: 12 } });
    const moved = r.events[0] as Extract<GameEvent, { type: "moved" }>;
    expect(moved.path.length).toBe(2);
    expect(s.heroes["h0"]!.mp).toBe(0);
    expect([s.heroes["h0"]!.x, s.heroes["h0"]!.y]).toEqual([moved.path[1]!.x, moved.path[1]!.y]);
  });

  it("captures an undefended enemy castle: the owner is defeated", () => {
    const s = newGame(5);
    s.objects.find((o) => o.id === player(s, "p1").castleId)!.garrison = [];
    teleport(s, "h0", 10, 1);
    const r = must(s, "p0", { type: "move", to: { x: 11, y: 1 } });
    expect(s.objects.find((o) => o.x === 11 && o.y === 1)!.owner).toBe("p0");
    expect(player(s, "p1").defeated).toBe(true);
    expect(s.winner).toBe("p0");
    expect(player(s, "p0").quests.conquer).toBe(true);
    expect(r.events).toContainEqual({ type: "defeat", player: "p1" });
    expect(r.events).toContainEqual({ type: "victory", player: "p0" });
  });
});

// ================= battles =================

describe("battles on the map", () => {
  it("a guarded tile starts a monster battle; autoBattle resolves it and removes the monster", () => {
    const s = newGame(11);
    const monster = s.objects.find((o) => o.x === 4 && o.y === 11)!;
    const r = must(s, "p0", { type: "move", to: { x: 4, y: 12 } });
    expect(r.events.some((e) => e.type === "battleStart")).toBe(true);
    const ab = battleOf(s, "p0")!;
    expect(ab.sides).toEqual(["p0", "neutral"]);
    expect(ab.context).toEqual({ kind: "monster", heroIds: ["h0"], objectId: monster.id });
    // the neutral side already played: a human stack is active
    expect(activeStack(ab.battle)!.side).toBe(0);
    expectJsonPlain(s);

    const r2 = must(s, "p0", { type: "autoBattle" });
    expect(s.battles).toEqual([]);
    expect(r2.events).toContainEqual({ type: "battleEnd", battleId: ab.battle.id, winner: "p0", sides: ["p0", "neutral"] });
    expect(monster.gone).toBe(true);
    expect(player(s, "p0").quests.fight).toBe(true);
    const h0 = s.heroes["h0"]!;
    expect(h0.exp).toBe(8 * 6 + 150);
    expect(h0.army.reduce((n, a) => n + a.count, 0)).toBeGreaterThan(0);
    expect(h0.army.reduce((n, a) => n + a.count, 0)).toBeLessThanOrEqual(30);
    expectJsonPlain(s);
  });

  it("the human can play a monster battle stack by stack; the neutrals answer automatically", () => {
    const s = newGame(12);
    must(s, "p0", { type: "move", to: { x: 4, y: 12 } });
    for (let i = 0; i < 300 && isInBattle(s, "p0"); i++) {
      const ab = battleOf(s, "p0")!;
      expect(activeStack(ab.battle)!.side).toBe(0);
      const r = must(s, "p0", { type: "battle", action: chooseAiBattleAction(ab.battle) as BattleAction });
      for (const e of r.events) if (e.type === "battle") expect(e.battleId).toBe(ab.battle.id);
    }
    expect(isInBattle(s, "p0")).toBe(false);
    expect(s.objects.find((o) => o.x === 4 && o.y === 11)!.gone).toBe(true);
  });

  it("level ups queue two distinct skills and chooseSkill applies one", () => {
    const s = newGame(11);
    s.heroes["h0"]!.exp = 290;
    must(s, "p0", { type: "move", to: { x: 4, y: 12 } });
    const r = must(s, "p0", { type: "autoBattle" });
    const h0 = s.heroes["h0"]!;
    const p0 = player(s, "p0");
    expect(h0.level).toBe(2);
    expect(r.events).toContainEqual({ type: "level", player: "p0" });
    expect(p0.levelChoices.length).toBe(1);
    const [a, b] = p0.levelChoices[0]!;
    expect(a).not.toBe(b);
    expect(SKILL_IDS).toContain(a);
    expect(SKILL_IDS).toContain(b);
    const skill = SKILLS[b as SkillId];
    const before = h0.base[skill.stat];
    must(s, "p0", { type: "chooseSkill", index: 1 });
    expect(h0.base[skill.stat]).toBe(before + skill.amount);
    expect(p0.levelChoices).toEqual([]);
    expectRejected(s, "p0", { type: "chooseSkill", index: 0 }, /Нет навыка/);
  });

  it("a hero battle between two humans: the loser dies, its artifacts go to the winner", () => {
    const s = newGame(21, [HUMAN, HUMAN1]);
    s.heroes["h0"]!.army = [{ unit: "royalGriffin", count: 60 }, { unit: "marksman", count: 60 }];
    teleport(s, "h1", 4, 12);
    must(s, "p0", { type: "move", to: { x: 4, y: 12 } });
    const ab = battleOf(s, "p0")!;
    expect(ab.context.kind).toBe("hero");
    expect(ab.sides).toEqual(["p0", "p1"]);
    for (let i = 0; i < 500 && s.battles.length > 0; i++) {
      const b = s.battles[0]!.battle;
      const side = activeStack(b)!.side;
      must(s, s.battles[0]!.sides[side] as string, { type: "battle", action: chooseAiBattleAction(b) });
    }
    expect(s.winner).toBe("p0");
    expect(s.heroes["h1"]!.alive).toBe(false);
    expect(s.heroes["h1"]!.army).toEqual([]);
    expect(s.heroes["h0"]!.bag).toEqual(expect.arrayContaining(["ashBlade", "shield"]));
    expect(player(s, "p1").defeated).toBe(true);
  });

  it("a garrison battle won captures the castle and ends the game", () => {
    const s = newGame(22);
    s.heroes["h0"]!.army = [{ unit: "royalGriffin", count: 60 }, { unit: "marksman", count: 60 }];
    teleport(s, "h0", 10, 1);
    must(s, "p0", { type: "move", to: { x: 11, y: 1 } });
    const ab = battleOf(s, "p0")!;
    expect(ab.context.kind).toBe("garrison");
    expect(ab.sides).toEqual(["p0", "p1"]);
    const r = must(s, "p0", { type: "autoBattle" });
    expect(r.events).toContainEqual({ type: "victory", player: "p0" });
    const castle = s.objects.find((o) => o.x === 11 && o.y === 1)!;
    expect(castle.owner).toBe("p0");
    expect(castle.garrison).toEqual([]);
    expect(s.winner).toBe("p0");
  });

  it("losing to monsters kills the hero and defeats the player", () => {
    const s = newGame(23);
    s.heroes["h0"]!.army = [{ unit: "pike", count: 1 }];
    must(s, "p0", { type: "move", to: { x: 4, y: 12 } });
    must(s, "p0", { type: "autoBattle" });
    expect(s.heroes["h0"]!.alive).toBe(false);
    expect(player(s, "p0").defeated).toBe(true);
    expect(s.winner).toBe("p1");
    const m = s.objects.find((o) => o.x === 4 && o.y === 11)!;
    expect(m.gone).toBeFalsy();
    expect(m.army![0]!.count).toBeGreaterThan(0);
  });

  it("the AI attacks the human hero at the end of day; the human must play the battle", () => {
    const s = createGame({
      id: "g", mapId: "valley", seed: 31,
      players: [{ ...HUMAN, loadout: { startArtifact: "sword" } }, AI1],
    });
    s.day = 5;
    s.heroes["h1"]!.army = [{ unit: "skeleton", count: 300 }];
    teleport(s, "h1", 4, 14);
    const r = must(s, "p0", { type: "endDay" });
    expect(s.day).toBe(6);
    expect(r.events).toContainEqual({ type: "newDay", day: 6 });
    const ab = battleOf(s, "p0")!;
    expect(ab.sides).toEqual(["p1", "p0"]);
    expect(ab.context.kind).toBe("hero");
    expect(activeStack(ab.battle)!.side).toBe(1);
    expectRejected(s, "p0", { type: "move", to: { x: 4, y: 13 } }, /закончите бой/);
    must(s, "p0", { type: "autoBattle" });
    expect(s.heroes["h0"]!.alive).toBe(false);
    expect(s.winner).toBe("p1");
    expect(s.heroes["h1"]!.bag).toContain("sword");
  });

  it("the AI takes an undefended human castle from day 8", () => {
    const s = newGame(32);
    s.day = 8;
    teleport(s, "h0", 13, 4);
    s.heroes["h1"]!.army = [{ unit: "skeleton", count: 100 }];
    teleport(s, "h1", 3, 14);
    const r = must(s, "p0", { type: "endDay" });
    expect(s.objects.find((o) => o.x === 2 && o.y === 14)!.owner).toBe("p1");
    expect(player(s, "p0").defeated).toBe(true);
    expect(s.winner).toBe("p1");
    expect(r.events).toContainEqual({ type: "defeat", player: "p0" });
  });

  it("autoBattle in a battle between humans only hands over the caller's stacks", () => {
    const s = newGame(24, [HUMAN, HUMAN1]);
    teleport(s, "h1", 4, 14);
    must(s, "p1", { type: "move", to: { x: 3, y: 13 } });
    const ab = battleOf(s, "p0")!;
    must(s, "p0", { type: "autoBattle" });
    expect(ab.auto).toEqual([false, true]);
    for (let i = 0; i < 500 && s.battles.length > 0; i++) {
      const b = s.battles[0]!.battle;
      expect(ab.sides[activeStack(b)!.side]).toBe("p1");
      must(s, "p1", { type: "battle", action: chooseAiBattleAction(b) });
    }
    expect(s.battles).toEqual([]);
    expect(s.winner).not.toBeNull();
  });

  it("nobody can join a battle that is already running", () => {
    const s = newGame(25, [HUMAN, HUMAN1]);
    must(s, "p0", { type: "move", to: { x: 4, y: 12 } }); // p0 fights the wolves at (4,11)
    teleport(s, "h1", 6, 13);
    expectRejected(s, "p1", { type: "move", to: { x: 5, y: 12 } }, /идёт бой/); // same wolves
    expectRejected(s, "p1", { type: "move", to: { x: 4, y: 12 } }, /идёт бой/); // p0's hero
    must(s, "p0", { type: "autoBattle" });
    must(s, "p1", { type: "move", to: { x: 4, y: 12 } });
    expect(battleOf(s, "p1")!.context.kind).toBe("hero");
  });

  it("forceEndDay lets the AI finish the player's battle and ends the day", () => {
    const s = newGame(33);
    must(s, "p0", { type: "move", to: { x: 4, y: 12 } });
    const r = forceEndDay(s, "p0");
    expect(r.ok).toBe(true);
    expect(s.battles).toEqual([]);
    expect(s.day).toBe(2);
  });
});

// ================= castle / hero screen =================

describe("castle economy and hero screen", () => {
  it("hire, build and upgrade charge exactly and reward their quests", () => {
    const s = newGame(41);
    teleport(s, "h0", 2, 14);
    const p = player(s, "p0");
    const h = s.heroes["h0"]!;
    let r = must(s, "p0", { type: "hire", unit: "pike" });
    expect(r.events).toContainEqual({ type: "gold", player: "p0", amount: -600, reason: "hire" });
    expect(p.gold).toBe(1900);
    expect(p.growth.pike).toBe(0);
    must(s, "p0", { type: "hire", unit: "archer" });
    expect(p.gold).toBe(1300);
    expect(h.army).toEqual([{ unit: "pike", count: 30 }, { unit: "archer", count: 16 }]);
    must(s, "p0", { type: "build", building: "forge" });
    expect(p.gold).toBe(1300 - 1000 + 500);
    expect(p.built.forge).toBe(true);
    expect(p.quests.build).toBe(true);
    expectRejected(s, "p0", { type: "build", building: "mageGuild" }, /Сегодня уже строили/);
    r = must(s, "p0", { type: "upgrade", unit: "pike" });
    expect(r.events).toContainEqual({ type: "gold", player: "p0", amount: -800, reason: "upgrade" });
    expect(p.gold).toBe(0);
    expect(h.army).toEqual([{ unit: "halberd", count: 20 }, { unit: "pike", count: 10 }, { unit: "archer", count: 16 }]);
    expect(p.quests.upgrade).toBe(true);
    expect(h.exp).toBe(200);
  });

  it("the griffin tower opens griffins right away and every week", () => {
    const s = newGame(42, [HUMAN, HUMAN1]);
    teleport(s, "h0", 2, 14);
    const p = player(s, "p0");
    p.gold = 10000;
    must(s, "p0", { type: "build", building: "griffinTower" });
    expect(p.growth.griffin).toBe(3);
    must(s, "p0", { type: "hire", unit: "griffin" });
    expect(s.heroes["h0"]!.army).toContainEqual({ unit: "griffin", count: 3 });
    for (let d = 0; d < 7; d++) {
      must(s, "p0", { type: "endDay" });
      must(s, "p1", { type: "endDay" });
    }
    expect(s.day).toBe(8);
    expect(p.growth.griffin).toBe(3);
  });

  it("equip/unequip move artifacts between bag and slots and cap movement points", () => {
    const s = newGame(43);
    const h = s.heroes["h0"]!;
    h.bag = ["boots", "mageRing", "apprenticeRing"] as ArtifactId[];
    must(s, "p0", { type: "equip", artifact: "boots" });
    expect(h.equipped.feet).toBe("boots");
    expect(h.mp).toBe(12);
    must(s, "p0", { type: "equip", artifact: "mageRing" });
    must(s, "p0", { type: "equip", artifact: "apprenticeRing" });
    expect(h.equipped).toMatchObject({ ring1: "mageRing", ring2: "apprenticeRing" });
    expect(h.bag).toEqual([]);
    h.mp = maxMovement(h);
    expect(h.mp).toBe(15);
    must(s, "p0", { type: "unequip", slot: "feet" });
    expect(h.bag).toEqual(["boots"]);
    expect(h.mp).toBe(12);
  });
});

// ================= days =================

describe("end of day", () => {
  it("waits for every human, then pays income, resets movement and advances the day", () => {
    const s = newGame(51, [HUMAN, HUMAN1]);
    teleport(s, "h0", 6, 8);
    must(s, "p0", { type: "move", to: { x: 7, y: 8 } }); // mine: +1000 quest
    must(s, "p0", { type: "endDay" });
    expect(s.day).toBe(1);
    expect(player(s, "p0").endedDay).toBe(true);
    const r = must(s, "p1", { type: "endDay" });
    expect(s.day).toBe(2);
    expect(r.events).toContainEqual({ type: "newDay", day: 2 });
    expect(r.events).toContainEqual({ type: "gold", player: "p0", amount: 1500, reason: "income" });
    expect(player(s, "p0").gold).toBe(2500 + 1000 + 1500);
    expect(player(s, "p1").gold).toBe(2500 + 1000);
    expect(s.players.every((p) => !p.endedDay && !p.builtToday)).toBe(true);
    expect(s.heroes["h0"]!.mp).toBe(12);
  });

  it("adds weekly growth at the start of every week", () => {
    const s = newGame(52, [HUMAN, HUMAN1]);
    let newWeek = 0;
    for (let d = 0; d < 7; d++) {
      must(s, "p0", { type: "endDay" });
      const r = must(s, "p1", { type: "endDay" });
      newWeek += r.events.filter((e) => e.type === "newWeek").length;
    }
    expect(s.day).toBe(8);
    expect(newWeek).toBe(1);
    expect(player(s, "p0").growth).toEqual({ pike: 20, archer: 12, griffin: 0 });
    expect(player(s, "p1").growth).toEqual({ skeleton: 20, ghost: 8, lich: 2 });
    expect(player(s, "p0").gold).toBe(2500 + 7 * 1000);
  });

  it("with only AI players every endDay advances the day, and the AI recruits", () => {
    const s = newGame(53, [AI0, AI1]);
    const before = s.heroes["h1"]!.army.reduce((n, a) => n + a.count, 0);
    must(s, "p1", { type: "endDay" });
    expect(s.day).toBe(2);
    expect(s.heroes["h1"]!.army.reduce((n, a) => n + a.count, 0)).toBeGreaterThan(before);
  });
});

// ================= full games =================

describe("full simulations", () => {
  const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

  for (const mode of ["ai", "passive", "active", "pvp"] as const) {
    it(`${mode}: 40 days on 20 seeds never throw, stay plain JSON and are reproducible`, () => {
      let winners = 0;
      for (const seed of SEEDS) {
        const s = simulate(seed, mode);
        expectJsonPlain(s);
        if (s.winner !== null) {
          winners++;
          expect(s.players.filter((p) => p.defeated).length).toBe(1);
          expect(getPlayer(s, s.winner)!.defeated).toBe(false);
          expect(s.battles).toEqual([]);
        }
        for (const h of Object.values(s.heroes)) {
          for (const a of h.army) expect(a.count).toBeGreaterThan(0);
          expect(h.mp).toBeGreaterThanOrEqual(0);
        }
        expect(simulate(seed, mode)).toStrictEqual(s);
      }
      if (mode !== "pvp") expect(winners).toBeGreaterThanOrEqual(10);
    });
  }

  it("different seeds give different games", () => {
    const a = JSON.stringify(simulate(1, "active", 6));
    const b = JSON.stringify(simulate(2, "active", 6));
    expect(a).not.toBe(b);
  });

  it("a JSON round trip mid-game continues identically", () => {
    const s = simulate(5, "active", 3);
    expect(s.winner).toBeNull();
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    expect(copy).toStrictEqual(s);
    simulate(5, "active", 20, s);
    simulate(5, "active", 20, copy);
    expect(copy).toStrictEqual(s);
  });

  it("random (mostly invalid) actions never throw and never corrupt the state", () => {
    const acts = (r: Rng, s: GameState, pid: string): GameAction => {
      const ab = battleOf(s, pid);
      switch (r.int(0, 12)) {
        case 0: case 1: case 2:
          return { type: "move", to: { x: r.int(0, s.cols), y: r.int(0, s.rows) } };
        case 3: return { type: "endDay" };
        case 4: return { type: "hire", unit: r.pick(UNIT_IDS) };
        case 5: return { type: "build", building: r.pick(BUILDING_IDS) };
        case 6: return { type: "upgrade", unit: r.pick(UNIT_IDS) };
        case 7: return { type: "equip", artifact: r.pick(ARTIFACT_IDS) };
        case 8: return { type: "unequip", slot: r.pick(SLOTS).id };
        case 9: return { type: "chooseSkill", index: r.int(0, 1) as 0 | 1 };
        case 10: return ab ? { type: "battle", action: chooseAiBattleAction(ab.battle) } : { type: "autoBattle" };
        case 11: return { type: "battle", action: { type: "attack", target: r.int(0, 8) } };
        default: return { type: "battle", action: { type: "move", to: [r.int(0, 8), r.int(0, 11)] } };
      }
    };
    for (let seed = 1; seed <= 6; seed++) {
      const r = createRng(seed * 7919);
      const s = newGame(seed, seed % 2 ? [HUMAN, HUMAN1] : [HUMAN, AI1]);
      let okCount = 0;
      for (let i = 0; i < 600 && s.winner === null; i++) {
        const humans = s.players.filter((p) => !p.isAI && !p.defeated);
        const p = r.pick(humans);
        if (act(s, p.id, acts(r, s, p.id)).ok) okCount++;
      }
      expect(okCount).toBeGreaterThan(5);
      expectJsonPlain(s);
    }
  });
});

// ================= visibility =================

describe("visibility mid-game", () => {
  it("playerView hides the opponent for each player", () => {
    const s = simulate(5, "pvp", 4);
    expect(s.winner).toBeNull();
    for (const me of s.players) {
      const foe = s.players.find((p) => p.id !== me.id)!;
      const v = playerView(s, me.id).state;
      const json = JSON.stringify(v);
      expect(v.rngState).toBe(0);
      const vf = v.players.find((p) => p.id === foe.id)!;
      expect(vf.gold).toBe(0);
      expect(vf.explored).not.toContain("1");
      expect(vf.levelChoices).toEqual([]);
      expect(v.players.find((p) => p.id === me.id)).toEqual(me);
      expect(v.heroes[me.heroId]).toEqual(s.heroes[me.heroId]);
      const fh = s.heroes[foe.heroId]!;
      const vh = v.heroes[foe.heroId];
      if (isExplored(s, me.id, fh.x, fh.y) && fh.alive) {
        expect(vh).toBeDefined();
        expect(vh!.bag).toEqual([]);
        for (const a of vh!.army) {
          expect(a.count).toBe(0);
          expect(typeof a.countHint).toBe("string");
        }
      } else {
        expect(vh).toBeUndefined();
      }
      for (const o of v.objects) expect(o.owner === me.id || isExplored(s, me.id, o.x, o.y)).toBe(true);
      for (const b of v.battles) expect(b.sides).toContain(me.id);
      expect(json).not.toContain(`"explored":"${foe.explored}"`);
    }
  });

  it("eventsForPlayer keeps private events private", () => {
    const s = newGame(61);
    teleport(s, "h0", 0, 8);
    const r = must(s, "p0", { type: "move", to: { x: 0, y: 9 } });
    expect(eventsForPlayer(s, "p0", r.events)).toEqual(r.events);
    const theirs = eventsForPlayer(s, "p1", r.events);
    expect(theirs.some((e) => e.type === "gold" || e.type === "quest" || e.type === "toast")).toBe(false);
    for (const e of theirs) {
      if (e.type === "moved") for (const pt of e.path) expect(isExplored(s, "p1", pt.x, pt.y)).toBe(true);
    }
    must(s, "p0", { type: "move", to: { x: 1, y: 8 } });
    const r2 = must(s, "p0", { type: "move", to: { x: 2, y: 9 } }); // guarded by the wolves at (3,8)
    const battleEvents = [...r2.events, ...must(s, "p0", { type: "autoBattle" }).events];
    expect(battleEvents.some((e) => e.type === "battle")).toBe(true);
    expect(eventsForPlayer(s, "p1", battleEvents).some((e) => e.type === "battle" || e.type === "battleEnd")).toBe(false);
    expect(eventsForPlayer(s, "p0", battleEvents).some((e) => e.type === "battleEnd")).toBe(true);
  });
});
