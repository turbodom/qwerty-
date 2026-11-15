import { createRng } from "./rng";
import type { Rng } from "./rng";
import type {
  ActionResult, ActiveBattle, ArmyStack, BattleAction, BattleEvent, BattleHero, BattleSide, GameAction, GameEvent,
  GameState, Hero, MapObject, PlayerId, PlayerSetup, PlayerState, Point, Seat,
} from "./types";
import type { ArtifactId, SlotId } from "./data/artifacts";
import { ARTIFACTS, DROP_POOL, RARITY_NAMES, artifactFxText } from "./data/artifacts";
import type { BuildingId } from "./data/buildings";
import { BUILDINGS } from "./data/buildings";
import { BUILDING_GROWTH, FACTION_UNITS, HIRE_REQUIRES, START_GROWTH, isNewWeek, weekOf, weeklyGrowth } from "./data/growth";
import type { QuestId } from "./data/quests";
import { QUESTS } from "./data/quests";
import {
  CHEST_GOLD, DAYS_PER_WEEK, DROP_CHANCE, GARRISON_WEEKLY, HERO_COST, HERO_NAMES, HOMELESS_DAYS, MAX_ARMY_STACKS, MAX_HEROES,
  AI_LEVEL_RULES, MINE_INCOME, MINE_YIELD_TEXT, RESOURCE_IDS, REVIVE_ARMY, START_RESOURCES, isAiLevel,
} from "./data/rules";
import type { AiLevel, AiLevelRule, ResourceId } from "./data/rules";
import {
  PLENTY_GROWTH, SHRINE_EXP, WEEK_EVENTS, campStack, WEEK_EVENT_IDS, WELL_MP, WOLVES_GROWTH,
} from "./data/sites";
import type { WeekEventId } from "./data/sites";
import type { SkillId } from "./data/skills";
import { SKILLS, SKILL_IDS, expToNext } from "./data/skills";
import type { SpellId } from "./data/spells";
import { SPELLS, SPELL_IDS } from "./data/spells";
import { baseStats } from "./data/stats";
import type { UnitId } from "./data/units";
import { UNITS, UPGRADES } from "./data/units";
import { mapStart } from "./maps";
import { resolveMap } from "./mapgen";
import { effectiveStats, equip, maxMovement, mergeArmy, pickUp, unequip } from "./hero";
import {
  emptyExplored, findPath, getPlayer, guardOf, heroAt, heroesOf, income, isExplored, objectAt, ownedCastles, playerHeroIds,
  resourceIncome, resourceOf, reveal, revealAll, terrainOk,
} from "./map";
import {
  AUTO_RESOLVE_LIMIT, activeStack, applyAiBattleAction, applyBattleAction, autoResolve, battleExp, battleLayoutSeed,
  battleSurvivors, createBattle,
} from "./battle";
import { AI_SKILL_POOL, aiBuild, aiRecruit, aiUpgrade, aiWantsHero, planAiMove } from "./ai";
import { isGameAction } from "./protocol";

/** Log lines kept in GameState.log (oldest dropped first). */
export const LOG_LIMIT = 100;

export interface CreateGameOptions {
  id: string;
  mapId: string;
  seed: number;
  players: [PlayerSetup, PlayerSetup];
  /** Difficulty of the AI players (default "normal"). */
  aiLevel?: AiLevel;
}

/** Difficulty rules for a player: the AI follows the game's level, humans always play the plain game. */
export function aiRule(state: GameState, p: PlayerState): AiLevelRule {
  return AI_LEVEL_RULES[p.isAI && state.aiLevel ? state.aiLevel : "normal"];
}

/** Mutable context of one applyAction call: the game rng is persisted only when the action succeeds. */
interface Ctx { state: GameState; rng: Rng; events: GameEvent[] }

// ================= small helpers =================

function copyArmy(army: readonly ArmyStack[]): ArmyStack[] {
  return army.map((s) => ({ unit: s.unit, count: s.count }));
}

/** Fresh uint32 seed drawn from the game rng. */
function nextSeed(rng: Rng): number {
  return Math.floor(rng.next() * 4294967296) >>> 0;
}

function pushLog(state: GameState, line: string): void {
  state.log.push(line);
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

function toast(ctx: Ctx, text: string, player?: PlayerId): void {
  ctx.events.push(player === undefined ? { type: "toast", text } : { type: "toast", player, text });
}

function addGold(ctx: Ctx, p: PlayerState, amount: number, reason: string): void {
  if (amount === 0) return;
  p.gold += amount;
  ctx.events.push({ type: "gold", player: p.id, amount, reason });
}

function formatGold(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function otherSide(side: Seat): Seat {
  return side === 0 ? 1 : 0;
}

/** Players controlled by people (whatever their state). */
export function humanPlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.isAI);
}

/** The player's hero (alive or not). */
export function playerHero(state: GameState, playerId: PlayerId): Hero | undefined {
  const p = getPlayer(state, playerId);
  return p ? state.heroes[p.heroId] : undefined;
}

/** First active battle the player takes part in. */
export function battleOf(state: GameState, playerId: PlayerId): ActiveBattle | undefined {
  return state.battles.find((ab) => ab.sides[0] === playerId || ab.sides[1] === playerId);
}

export function isInBattle(state: GameState, playerId: PlayerId): boolean {
  return battleOf(state, playerId) !== undefined;
}

/** The own castle the player's hero is standing in (hire/build/upgrade happen there). */
export function heroCastle(state: GameState, playerId: PlayerId): MapObject | undefined {
  const h = playerHero(state, playerId);
  if (!h || !h.alive) return undefined;
  const o = objectAt(state, h.x, h.y);
  return o && o.kind === "castle" && o.owner === playerId ? o : undefined;
}

/** True when the AI plays this side of the battle (neutrals, AI players, autoBattle, defeated players). */
export function isAutoSide(state: GameState, ab: ActiveBattle, side: Seat): boolean {
  const who = ab.sides[side];
  if (who === "neutral" || ab.auto?.[side]) return true;
  const p = getPlayer(state, who);
  return !p || p.isAI || p.defeated;
}

/** Spells a hero can cast: bolt always, heal/haste need the owner's mage guild. */
export function heroSpells(state: GameState, hero: Hero): SpellId[] {
  const owner = getPlayer(state, hero.owner);
  return SPELL_IDS.filter((id) => {
    const req = SPELLS[id].requires;
    return !req || !!owner?.built[req];
  });
}

function battleHero(state: GameState, hero: Hero | null): BattleHero | null {
  if (!hero) return null;
  return { heroId: hero.id, name: hero.name, stats: effectiveStats(hero), spells: heroSpells(state, hero) };
}

function objectInBattle(state: GameState, objectId: string): boolean {
  return state.battles.some((ab) => ab.context.objectId === objectId);
}

function enemyHeroAt(state: GameState, hero: Hero, x: number, y: number): Hero | undefined {
  return Object.values(state.heroes).find((h) => h.alive && h.owner !== hero.owner && h.x === x && h.y === y);
}

function hasGarrison(o: MapObject): boolean {
  return (o.garrison ?? []).some((s) => s.count > 0);
}

/** Entering (x, y) would start a battle against someone already fighting elsewhere. */
function tileBusy(state: GameState, hero: Hero, x: number, y: number): boolean {
  const eh = enemyHeroAt(state, hero, x, y);
  if (eh) return isInBattle(state, eh.owner);
  const g = guardOf(state, x, y);
  if (g) return objectInBattle(state, g.id);
  const o = objectAt(state, x, y);
  if (o && o.kind === "castle" && o.owner !== hero.owner && hasGarrison(o)) {
    return objectInBattle(state, o.id) || (!!o.owner && isInBattle(state, o.owner));
  }
  return false;
}

function ownedAnywhere(state: GameState, id: ArtifactId): boolean {
  for (const h of Object.values(state.heroes)) {
    if (h.bag.includes(id)) return true;
    if (Object.values(h.equipped).includes(id)) return true;
  }
  return state.objects.some((o) => o.kind === "artifact" && !o.gone && o.artifact === id);
}

function clampMp(hero: Hero): void {
  hero.mp = Math.max(0, Math.min(hero.mp, maxMovement(hero)));
}

// ================= creation =================

/**
 * New game on MAPS[mapId] or on a fresh procedural map for a "random-<size>" id (built from the seed):
 * seat 0 plays the castle faction, seat 1 the necropolis.
 * Loadouts: startArtifact is equipped when its slot is free (bag otherwise), startGold added, banner kept.
 */
export function createGame(opts: CreateGameOptions): GameState {
  const map = resolveMap(opts.mapId, opts.seed);
  if (!map) throw new Error(`unknown map ${opts.mapId}`);
  const setups = opts.players;
  if (setups.length !== 2 || !setups[0].id || !setups[1].id || setups[0].id === setups[1].id) {
    throw new Error("createGame needs two players with distinct non-empty ids");
  }
  if (map.starts.length < 2) throw new Error(`map ${map.id} has fewer than 2 starts`);
  const ids: [PlayerId, PlayerId] = [setups[0].id, setups[1].id];

  const objects: MapObject[] = map.objects.map((d, i) => {
    const o: MapObject = { id: `o${i}`, kind: d.kind, x: d.x, y: d.y };
    if (d.kind === "castle" || d.kind === "mine") o.owner = d.owner === undefined ? null : ids[d.owner];
    if (d.artifact) o.artifact = d.artifact;
    if (d.army) o.army = copyArmy(d.army);
    if (d.garrison) o.garrison = copyArmy(d.garrison);
    if (d.res) o.res = d.res;
    if (d.site) {
      o.site = d.site;
      o.visits = {};
      if (d.site === "camp") o.stock = 1;
    }
    return o;
  });

  const heroes: Record<string, Hero> = {};
  const players: PlayerState[] = setups.map((setup, i) => {
    const seat = i as Seat;
    const start = mapStart(map, seat);
    const castle = start ? objects[start.castleIndex] : undefined;
    if (!start || !castle) throw new Error(`map ${map.id}: bad start for seat ${seat}`);
    const heroId = `h${seat}`;
    const hero: Hero = {
      id: heroId, owner: setup.id, name: start.heroName, x: start.hero.x, y: start.hero.y, mp: 0,
      level: 1, exp: 0, alive: true, base: baseStats(), equipped: { ...start.equipped }, bag: [],
      army: copyArmy(start.army),
    };
    const lo = setup.loadout;
    if (lo?.startArtifact && ARTIFACTS[lo.startArtifact]) pickUp(hero, lo.startArtifact);
    hero.mp = maxMovement(hero);
    heroes[heroId] = hero;
    const bonus = lo?.startGold !== undefined && Number.isFinite(lo.startGold) && lo.startGold > 0
      ? Math.floor(lo.startGold) : 0;
    const level = setup.isAI && isAiLevel(opts.aiLevel) ? opts.aiLevel : "normal";
    const p: PlayerState = {
      id: setup.id, name: setup.name, seat, isAI: !!setup.isAI, faction: start.faction,
      gold: start.gold + bonus + AI_LEVEL_RULES[level].startGold, res: { ...START_RESOURCES }, heroId, heroIds: [heroId], castleId: castle.id, explored: emptyExplored(map.cols, map.rows),
      growth: { ...START_GROWTH[start.faction] }, built: {}, builtToday: false, quests: {}, levelChoices: [],
      endedDay: false, defeated: false,
    };
    if (lo?.banner) p.banner = lo.banner;
    return p;
  });

  const state: GameState = {
    version: 1, id: opts.id, mapId: map.id, cols: map.cols, rows: map.rows, terrain: [...map.terrain],
    day: 1, rngState: opts.seed >>> 0, players, heroes, objects, battles: [], winner: null,
    log: [`${map.name}: партия началась`],
  };
  if (isAiLevel(opts.aiLevel) && opts.aiLevel !== "normal") state.aiLevel = opts.aiLevel;
  revealAll(state);
  return state;
}

// ================= quests / experience / defeat =================

function applySkill(hero: Hero, id: SkillId): void {
  const sk = SKILLS[id];
  hero.base[sk.stat] = (hero.base[sk.stat] ?? 0) + sk.amount;
  if (sk.stat === "move") hero.mp += sk.amount;
}

/** Two distinct skills drawn with the game rng. */
function skillChoice(rng: Rng): SkillId[] {
  const pool = [...SKILL_IDS];
  const out: SkillId[] = [];
  while (out.length < 2 && pool.length > 0) {
    const [id] = pool.splice(rng.int(0, pool.length - 1), 1);
    if (id) out.push(id);
  }
  return out;
}

function gainExp(ctx: Ctx, hero: Hero, xp: number): void {
  const p = getPlayer(ctx.state, hero.owner);
  const add = Math.round(xp);
  if (!p || p.defeated || !hero.alive || !(add > 0)) return;
  hero.exp += add;
  let leveled = false;
  while (hero.exp >= expToNext(hero.level)) {
    hero.exp -= expToNext(hero.level);
    hero.level++;
    leveled = true;
    if (p.isAI) applySkill(hero, AI_SKILL_POOL[ctx.rng.int(0, AI_SKILL_POOL.length - 1)] ?? "offense");
    else p.levelChoices.push(skillChoice(ctx.rng));
    ctx.events.push({ type: "level", player: p.id });
  }
  if (leveled && hero.level >= 3) completeQuest(ctx, p.id, "level3");
}

/** Newbie quests reward people only: as in the prototype (quest() credits blue), the AI never gets them. */
function completeQuest(ctx: Ctx, playerId: PlayerId, id: QuestId): void {
  const p = getPlayer(ctx.state, playerId);
  const q = QUESTS.find((x) => x.id === id);
  if (!p || !q || p.isAI || p.quests[id] || p.defeated) return;
  p.quests[id] = true;
  ctx.events.push({ type: "quest", player: p.id, quest: id });
  let text = `Задание выполнено: ${q.name}`;
  if (q.gold) text += `. +${formatGold(q.gold)} золота`;
  if (q.exp) text += `. +${q.exp} опыта`;
  toast(ctx, text, p.id);
  if (q.gold) addGold(ctx, p, q.gold, "quest");
  if (q.exp) {
    const h = ctx.state.heroes[p.heroId];
    if (h) gainExp(ctx, h, q.exp);
  }
}

function defeat(ctx: Ctx, playerId: PlayerId, why: string): void {
  const { state } = ctx;
  const p = getPlayer(state, playerId);
  if (!p || p.defeated) return;
  p.defeated = true;
  p.levelChoices = [];
  ctx.events.push({ type: "defeat", player: p.id });
  pushLog(state, `${p.name}: поражение. ${why}`);
  const left = state.players.filter((q) => !q.defeated);
  const last = left[0];
  if (left.length === 1 && last && state.winner === null) {
    state.winner = last.id;
    state.battles = [];
    ctx.events.push({ type: "victory", player: last.id });
    pushLog(state, `${last.name}: победа!`);
  }
}

/**
 * A player is out once they have neither a castle nor a living hero. A fallen hero of a player who
 * still holds a castle returns there the next morning (see reviveHeroes).
 */
function checkDefeat(ctx: Ctx, playerId: PlayerId, why: string): void {
  const p = getPlayer(ctx.state, playerId);
  if (!p || p.defeated) return;
  const anyAlive = heroesOf(ctx.state, p).some((h) => h.alive);
  if (ownedCastles(ctx.state, p.id).length === 0 && !anyAlive) defeat(ctx, p.id, why);
}

function killHero(ctx: Ctx, hero: Hero, why: string): void {
  if (!hero.alive) return;
  hero.alive = false;
  hero.army = [];
  hero.mp = 0;
  const p = getPlayer(ctx.state, hero.owner);
  if (p && !p.defeated && ownedCastles(ctx.state, p.id).length > 0) {
    pushLog(ctx.state, `${p.name}: ${hero.name} отступает в замок`);
    toast(ctx, `${hero.name} разбит и вернётся в замок завтра с отрядом ополчения.`, p.id);
  }
  // the player keeps moving with another living hero, if there is one
  if (p && p.heroId === hero.id) {
    const other = heroesOf(ctx.state, p).find((h) => h.alive);
    if (other) p.heroId = other.id;
  }
  checkDefeat(ctx, hero.owner, why);
}

/** Morning: fallen heroes of players who still hold a castle return there with a small militia. */
function reviveHeroes(ctx: Ctx): void {
  const { state } = ctx;
  for (const p of state.players) {
    if (p.defeated || p.faction === "neutral" || isInBattle(state, p.id)) continue;
    const castles = ownedCastles(state, p.id);
    const order = [castles.find((o) => o.id === p.castleId), ...castles].filter((o): o is MapObject => !!o);
    for (const hero of heroesOf(state, p)) {
      if (hero.alive) continue;
      let spot: Point | undefined;
      for (const c of order) {
        spot = freeTileAt(state, c);
        if (spot) break;
      }
      if (!spot) continue;
      const militia = REVIVE_ARMY[p.faction];
      hero.alive = true;
      hero.x = spot.x;
      hero.y = spot.y;
      hero.army = [{ unit: militia.unit, count: militia.count }];
      hero.mp = maxMovement(hero);
      const active = state.heroes[p.heroId];
      if (!active || !active.alive) p.heroId = hero.id;
      reveal(state, p.id);
      toast(ctx, `${hero.name} вернулся в замок и снова готов к походу.`, p.id);
    }
  }
}

/** The castle tile when no hero stands there, else a free plain tile next to it (no hero, object or guard). */
function freeTileAt(state: GameState, castle: MapObject): Point | undefined {
  if (!heroAt(state, castle.x, castle.y)) return { x: castle.x, y: castle.y };
  return freeTileNear(state, castle);
}

function freeTileNear(state: GameState, c: Point): Point | undefined {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = c.x + dx;
      const y = c.y + dy;
      if ((dx === 0 && dy === 0) || !terrainOk(state, x, y)) continue;
      if (heroAt(state, x, y) || objectAt(state, x, y) || guardOf(state, x, y)) continue;
      return { x, y };
    }
  }
  return undefined;
}

/** Losing the last castle starts a countdown; after HOMELESS_DAYS without one the player is out. */
function checkHomeless(ctx: Ctx): void {
  const { state } = ctx;
  for (const p of state.players) {
    if (p.defeated || state.winner !== null) continue;
    if (ownedCastles(state, p.id).length > 0) {
      delete p.homelessSince;
      continue;
    }
    const since = p.homelessSince ?? state.day;
    p.homelessSince = since;
    const left = HOMELESS_DAYS - (state.day - since);
    if (left <= 0) defeat(ctx, p.id, `${HOMELESS_DAYS} дней без замка.`);
    else toast(ctx, `Без замка! Дней, чтобы отбить замок: ${left}.`, p.id);
  }
}

/** Found artifact (map or monster drop): equipped when its slot is free, else bagged; counts for the artifact quest. */
function giveArtifact(ctx: Ctx, hero: Hero, id: ArtifactId): void {
  pickUp(hero, id);
  const a = ARTIFACTS[id];
  const rar = RARITY_NAMES[a.rarity] ?? "";
  ctx.events.push({ type: "artifact", player: hero.owner, artifact: id });
  toast(ctx, `${rar.charAt(0).toUpperCase()}${rar.slice(1)} артефакт: ${a.name} (${artifactFxText(a)})`, hero.owner);
  completeQuest(ctx, hero.owner, "artifact");
}

function capture(ctx: Ctx, newOwner: PlayerId, castle: MapObject): void {
  const { state } = ctx;
  const prev = castle.owner ?? null;
  const p = getPlayer(state, newOwner);
  castle.owner = newOwner;
  castle.garrison = [];
  reveal(state, newOwner);
  if (p) pushLog(state, `${p.name} захватывает замок`);
  toast(ctx, p ? `${p.name} захватывает замок!` : "Замок захвачен!");
  completeQuest(ctx, newOwner, "conquer");
  if (p) {
    delete p.homelessSince;
    // a player who lost the home castle makes the captured one the new home
    if (!ownedCastles(state, p.id).some((o) => o.id === p.castleId)) p.castleId = castle.id;
  }
  const prevPlayer = prev ? getPlayer(state, prev) : undefined;
  if (!prevPlayer || prevPlayer.defeated) return;
  const left = ownedCastles(state, prevPlayer.id);
  const next = left[0];
  if (prevPlayer.castleId === castle.id && next) prevPlayer.castleId = next.id;
  checkDefeat(ctx, prevPlayer.id, "Замок захвачен.");
  if (!prevPlayer.defeated && left.length === 0) {
    prevPlayer.homelessSince = state.day;
    toast(ctx, `Последний замок потерян! У вас ${HOMELESS_DAYS} дней, чтобы захватить замок.`, prevPlayer.id);
  }
}

// ================= battles =================

function pushBattleEvents(ctx: Ctx, ab: ActiveBattle, evs: readonly BattleEvent[]): void {
  for (const ev of evs) ctx.events.push({ type: "battle", battleId: ab.battle.id, ev });
}

function startBattle(
  ctx: Ctx, kind: ActiveBattle["context"]["kind"], sides: [BattleSide, BattleSide],
  armies: [ArmyStack[], ArmyStack[]], heroes: [Hero | null, Hero | null], objectId?: string,
): void {
  const { state } = ctx;
  // The id is built from public data only (day, attacker, opponent), never from an rng output: a battle
  // ends with the loser's hero dead or the monster/garrison gone, so the triple does not repeat.
  let id = `b${state.day}-${heroes[0]?.id ?? "x"}-${objectId ?? heroes[1]?.id ?? "x"}`;
  while (state.battles.some((b) => b.battle.id === id)) id += "x";
  const merged: [ArmyStack[], ArmyStack[]] = [mergeArmy(armies[0]), mergeArmy(armies[1])];
  const battle = createBattle({
    id, seed: nextSeed(ctx.rng), armies: merged,
    heroes: [battleHero(state, heroes[0]), battleHero(state, heroes[1])],
    // Prototype makeBattle: the obstacle layout comes from public data, so it reveals nothing about the rolls.
    layoutSeed: battleLayoutSeed(state.day, merged[0].length, merged[1].length),
  });
  const heroIds = heroes.filter((h): h is Hero => h !== null).map((h) => h.id);
  const context: ActiveBattle["context"] = { kind, heroIds };
  if (objectId !== undefined) context.objectId = objectId;
  const ab: ActiveBattle = { battle, sides: [sides[0], sides[1]], context, auto: [false, false] };
  state.battles.push(ab);
  ctx.events.push({ type: "battleStart", battleId: id, sides: [sides[0], sides[1]] });
  driveBattle(ctx, ab);
}

/** Plays AI-controlled stacks until a human-controlled stack is active or the battle ends; applies the result. */
function driveBattle(ctx: Ctx, ab: ActiveBattle): void {
  const { state } = ctx;
  if (!state.battles.includes(ab)) return;
  const b = ab.battle;
  if (!b.over && isAutoSide(state, ab, 0) && isAutoSide(state, ab, 1)) {
    pushBattleEvents(ctx, ab, autoResolve(b));
  } else {
    for (let i = 0; !b.over && i < AUTO_RESOLVE_LIMIT; i++) {
      const s = activeStack(b);
      if (!s || !isAutoSide(state, ab, s.side)) break;
      const res = applyAiBattleAction(b);
      pushBattleEvents(ctx, ab, res.events);
      if (!res.ok) break;
    }
    const s = activeStack(b);
    // Safety net (never expected): an AI side that could not finish its turns hands the battle to autoResolve.
    if (!b.over && (!s || isAutoSide(state, ab, s.side))) pushBattleEvents(ctx, ab, autoResolve(b));
  }
  if (b.over) finishBattle(ctx, ab);
}

function finishBattle(ctx: Ctx, ab: ActiveBattle): void {
  const { state } = ctx;
  const b = ab.battle;
  const idx = state.battles.indexOf(ab);
  if (idx < 0) return;
  state.battles.splice(idx, 1);
  const w: Seat = b.winnerSide ?? 1;
  const l = otherSide(w);
  ctx.events.push({ type: "battleEnd", battleId: b.id, winner: ab.sides[w], sides: [ab.sides[0], ab.sides[1]] });

  const heroes: (Hero | undefined)[] = ([0, 1] as const).map((s) => {
    const id = b.heroes[s]?.heroId;
    return id === undefined ? undefined : state.heroes[id];
  });
  ([0, 1] as const).forEach((s) => {
    const h = heroes[s];
    if (h) h.army = battleSurvivors(b, s);
  });
  const winnerHero = heroes[w];
  const loserHero = heroes[l];
  const obj = ab.context.objectId === undefined ? undefined : state.objects.find((o) => o.id === ab.context.objectId);

  if (winnerHero && winnerHero.alive) gainExp(ctx, winnerHero, battleExp(b, w));

  switch (ab.context.kind) {
    case "monster":
      if (w === 0) {
        if (obj) obj.gone = true;
        if (winnerHero && winnerHero.alive) {
          completeQuest(ctx, winnerHero.owner, "fight");
          // Prototype monsterBattle: only the human side rolls for a monster drop.
          const wp = getPlayer(state, winnerHero.owner);
          const pool = DROP_POOL.filter((id) => !ownedAnywhere(state, id));
          if (wp && !wp.isAI && pool.length > 0 && ctx.rng.next() < DROP_CHANCE) {
            giveArtifact(ctx, winnerHero, ctx.rng.pick(pool));
          }
        }
      } else if (obj) {
        obj.army = battleSurvivors(b, 1);
      }
      break;
    case "garrison":
      if (w === 0) {
        if (obj && winnerHero) capture(ctx, winnerHero.owner, obj);
      } else if (obj) {
        obj.garrison = battleSurvivors(b, 1);
      }
      break;
    case "hero":
      if (winnerHero && loserHero) {
        for (const id of Object.values(loserHero.equipped)) if (id) winnerHero.bag.push(id);
        for (const id of loserHero.bag) winnerHero.bag.push(id);
        loserHero.equipped = {};
        loserHero.bag = [];
        pushLog(state, `${winnerHero.name} побеждает героя ${loserHero.name}`);
        toast(ctx, `${loserHero.name} повержен! Артефакты достаются победителю.`);
      }
      break;
  }

  if (loserHero) killHero(ctx, loserHero, ab.context.kind === "monster" ? "Армия героя разбита." : "Герой пал.");

  // The attacker who won stays on the tile: collect what is there (prototype re-runs arrive after a win).
  if (w === 0 && ab.context.kind !== "garrison" && winnerHero && winnerHero.alive && state.winner === null) {
    const p = getPlayer(state, winnerHero.owner);
    if (p && !p.defeated) arrive(ctx, p, winnerHero);
  }
}

// ================= movement =================

/**
 * A hero attacked inside its own castle is joined by the garrison (stacks that fit into the army);
 * whoever survives stays with the hero.
 */
function joinGarrison(ctx: Ctx, defender: Hero): void {
  const o = objectAt(ctx.state, defender.x, defender.y);
  if (!o || o.kind !== "castle" || o.owner !== defender.owner || !hasGarrison(o)) return;
  let army = mergeArmy(defender.army);
  const rest: ArmyStack[] = [];
  for (const s of mergeArmy(o.garrison ?? [])) {
    if (army.length < MAX_ARMY_STACKS || army.some((a) => a.unit === s.unit)) army = mergeArmy([...army, s]);
    else rest.push(s);
  }
  defender.army = army;
  o.garrison = rest;
  toast(ctx, "Гарнизон замка встаёт на защиту вместе с героем!", defender.owner);
}

/** Handles what the hero finds on its tile. Returns true when the move must stop here. */
function arrive(ctx: Ctx, p: PlayerState, hero: Hero): boolean {
  const { state } = ctx;
  const { x, y } = hero;
  if (tileBusy(state, hero, x, y)) {
    toast(ctx, "Там уже идёт бой.", p.id);
    return true;
  }
  const eh = enemyHeroAt(state, hero, x, y);
  if (eh) {
    joinGarrison(ctx, eh);
    startBattle(ctx, "hero", [p.id, eh.owner], [hero.army, eh.army], [hero, eh]);
    return true;
  }
  const g = guardOf(state, x, y);
  if (g) {
    startBattle(ctx, "monster", [p.id, "neutral"], [hero.army, g.army ?? []], [hero, null], g.id);
    return true;
  }
  const o = objectAt(state, x, y);
  if (!o) return false;
  switch (o.kind) {
    case "chest":
      o.gone = true;
      addGold(ctx, p, CHEST_GOLD, "chest");
      toast(ctx, `+${formatGold(CHEST_GOLD)} золота`, p.id);
      completeQuest(ctx, p.id, "chest");
      return false;
    case "mine":
      if (o.owner !== p.id) {
        o.owner = p.id;
        ctx.events.push({ type: "mine", player: p.id, objectId: o.id });
        toast(ctx, o.res ? `Рудник ваш: ${MINE_YIELD_TEXT[o.res]} в день` : `Рудник ваш: +${MINE_INCOME} золота в день`, p.id);
        reveal(state, p.id);
        completeQuest(ctx, p.id, "mine");
      }
      return false;
    case "artifact":
      o.gone = true;
      if (o.artifact) giveArtifact(ctx, hero, o.artifact);
      return false;
    case "castle": {
      if (o.owner === p.id) return false;
      const gar = mergeArmy(o.garrison ?? []);
      if (gar.length > 0) {
        o.garrison = gar;
        startBattle(ctx, "garrison", [p.id, o.owner ?? "neutral"], [hero.army, gar], [hero, null], o.id);
        return true;
      }
      capture(ctx, p.id, o);
      return true;
    }
    case "monster":
      return true;
    case "site":
      visitSite(ctx, p, hero, o);
      return false;
  }
}

/** A shrine, a well or a mercenary camp. */
function visitSite(ctx: Ctx, p: PlayerState, hero: Hero, o: MapObject): void {
  const { state } = ctx;
  const visits = (o.visits ??= {});
  switch (o.site) {
    case "shrine":
      if (visits[hero.id] !== undefined) {
        toast(ctx, `${hero.name} уже молился в этом святилище.`, p.id);
        return;
      }
      visits[hero.id] = state.day;
      toast(ctx, `Святилище: +${SHRINE_EXP} опыта`, p.id);
      gainExp(ctx, hero, SHRINE_EXP);
      return;
    case "well":
      if (visits[hero.id] === state.day) {
        toast(ctx, "Сегодня герой уже пил из этого колодца.", p.id);
        return;
      }
      visits[hero.id] = state.day;
      hero.mp += WELL_MP;
      toast(ctx, `Колодец: +${WELL_MP} шага`, p.id);
      return;
    case "camp": {
      const st = campStack(p.faction);
      if (!st || (o.stock ?? 0) <= 0) {
        toast(ctx, "Лагерь пуст. Новые наёмники придут в начале недели.", p.id);
        return;
      }
      if (hero.army.length >= MAX_ARMY_STACKS && !hero.army.some((s) => s.unit === st.unit)) {
        toast(ctx, `В армии нет места: не больше ${MAX_ARMY_STACKS} отрядов.`, p.id);
        return;
      }
      o.stock = 0;
      visits[hero.id] = state.day;
      hero.army = mergeArmy([...hero.army, st]);
      toast(ctx, `Наёмники присоединились: ${st.count} ${UNITS[st.unit].name.toLowerCase()}`, p.id);
      return;
    }
  }
}

/** Picks the event of a new week (weighted by WEEK_EVENTS) and applies its one-off part. */
function startWeekEvent(ctx: Ctx): WeekEventId {
  const { state } = ctx;
  const total = WEEK_EVENT_IDS.reduce((n, id) => n + WEEK_EVENTS[id].weight, 0);
  let roll = ctx.rng.next() * total;
  let ev: WeekEventId = "plain";
  for (const id of WEEK_EVENT_IDS) {
    roll -= WEEK_EVENTS[id].weight;
    if (roll < 0) {
      ev = id;
      break;
    }
  }
  if (ev === "plain") delete state.week;
  else state.week = ev;
  for (const o of state.objects) {
    if (o.gone) continue;
    if (o.kind === "site" && o.site === "camp") o.stock = 1;
    if (ev === "wolves" && o.kind === "monster" && o.army && !objectInBattle(state, o.id)) {
      o.army = o.army.map((s) => ({ unit: s.unit, count: Math.ceil(s.count * WOLVES_GROWTH) }));
    }
  }
  if (ev !== "plain") {
    const def = WEEK_EVENTS[ev];
    toast(ctx, `${def.name}: ${def.desc}.`);
    pushLog(state, `${def.name}: ${def.desc}`);
  }
  return ev;
}

/** Walks the given steps while movement points last, stopping at the first interaction that halts the move. */
function walk(ctx: Ctx, p: PlayerState, hero: Hero, path: readonly Point[]): void {
  const { state } = ctx;
  const outer = ctx.events;
  const inner: GameEvent[] = [];
  const taken: Point[] = [];
  ctx.events = inner;
  for (const st of path) {
    if (hero.mp <= 0 || !hero.alive || state.winner !== null) break;
    if (tileBusy(state, hero, st.x, st.y)) {
      toast(ctx, "Там уже идёт бой.", p.id);
      break;
    }
    // two heroes of one player never share a tile: stop next to the friend
    if (Object.values(state.heroes).some((h) => h.id !== hero.id && h.alive && h.owner === hero.owner && h.x === st.x && h.y === st.y)) break;
    hero.x = st.x;
    hero.y = st.y;
    hero.mp--;
    taken.push({ x: st.x, y: st.y });
    reveal(state, p.id);
    if (arrive(ctx, p, hero)) break;
  }
  ctx.events = outer;
  if (taken.length > 0) outer.push({ type: "moved", heroId: hero.id, path: taken });
  for (const e of inner) outer.push(e);
}

// ================= end of day =================

function aiMapTurn(ctx: Ctx, p: PlayerState): void {
  for (const hero of heroesOf(ctx.state, p)) {
    if (!hero.alive || hero.mp <= 0 || isInBattle(ctx.state, p.id) || ctx.state.winner !== null || p.defeated) continue;
    const path = planAiMove(ctx.state, p.id, hero.id);
    if (path.length > 0) walk(ctx, p, hero, path.slice(0, hero.mp));
  }
}

/** AI turns, day++, income, weekly growth, AI recruiting, reset of movement / builtToday / endedDay. */
function endOfDay(ctx: Ctx): void {
  const { state } = ctx;
  for (const p of state.players) {
    if (state.winner !== null) return;
    if (p.isAI && !p.defeated) aiMapTurn(ctx, p);
  }
  if (state.winner !== null) return;

  state.day++;
  const live = state.players.filter((p) => !p.defeated);
  // the week's event comes first: a golden week already pays this morning
  const ev = isNewWeek(state.day) ? startWeekEvent(ctx) : undefined;
  for (const p of live) {
    addGold(ctx, p, Math.round(income(state, p.id) * aiRule(state, p).income), "income");
    const add = resourceIncome(state, p.id);
    const res = { ...(p.res ?? {}) };
    for (const r of RESOURCE_IDS) res[r] = (res[r] ?? 0) + add[r];
    p.res = res;
  }
  if (isNewWeek(state.day)) {
    const week = weekOf(state.day);
    for (const p of live) {
      if (p.faction === "neutral") continue;
      // every castle the player holds adds a week of creatures (a captured fortress doubles the growth)
      // the fort and the citadel add +50% each
      const castles = ownedCastles(state, p.id).length;
      const mult = (1 + (p.built.fort ? 0.5 : 0) + (p.built.citadel ? 0.5 : 0)) * aiRule(state, p).growth
        * (ev === "plenty" ? PLENTY_GROWTH : 1);
      const add = weeklyGrowth(p.faction, week, p.built);
      for (const [unit, n] of Object.entries(add) as [UnitId, number][]) {
        p.growth[unit] = (p.growth[unit] ?? 0) + Math.round(n * castles * mult);
      }
    }
    for (const o of state.objects) {
      const owner = o.kind === "castle" && !o.gone && o.owner ? getPlayer(state, o.owner) : undefined;
      if (!owner || owner.defeated || owner.faction === "neutral" || objectInBattle(state, o.id)) continue;
      const add = GARRISON_WEEKLY[owner.faction];
      const count = add.count * (owner.built.fort ? 2 : 1);
      o.garrison = mergeArmy([...(o.garrison ?? []), { unit: add.unit, count }]);
    }
    ctx.events.push({ type: "newWeek" });
    toast(ctx, "Новая неделя! В замке новые войска.");
  }
  checkHomeless(ctx);
  if (state.winner !== null) return;
  reviveHeroes(ctx);
  for (const p of live) {
    // An AI hero still fighting a human keeps its pre-battle army until the battle ends: no recruiting then.
    if (!p.isAI || p.defeated || isInBattle(state, p.id)) continue;
    const built = aiBuild(state, p.id);
    if (built) ctx.events.push({ type: "gold", player: p.id, amount: -built.gold, reason: "build" });
    const tavern = aiWantsHero(state, p.id);
    const at = tavern ? freeTileNear(state, tavern) : undefined;
    if (at) {
      p.gold -= HERO_COST;
      newHero(state, p, at);
      reveal(state, p.id);
      ctx.events.push({ type: "gold", player: p.id, amount: -HERO_COST, reason: "hero" });
    }
    for (const hired of aiRecruit(state, p.id)) ctx.events.push({ type: "gold", player: p.id, amount: -hired.gold, reason: "hire" });
    const upgraded = aiUpgrade(state, p.id);
    if (upgraded > 0) ctx.events.push({ type: "gold", player: p.id, amount: -upgraded, reason: "upgrade" });
  }
  for (const p of state.players) {
    p.builtToday = false;
    p.endedDay = false;
    for (const h of heroesOf(state, p)) if (h.alive) h.mp = maxMovement(h);
  }
  ctx.events.push({ type: "newDay", day: state.day });
  pushLog(state, `Неделя ${weekOf(state.day)}, день ${((state.day - 1) % DAYS_PER_WEEK) + 1}`);
}

/** Runs the end of day once every human who is still playing has ended theirs (always, when there are no humans). */
function maybeEndOfDay(ctx: Ctx): void {
  const waiting = ctx.state.players.some((q) => !q.isAI && !q.defeated && !q.endedDay);
  if (!waiting && ctx.state.winner === null) endOfDay(ctx);
}

// ================= actions =================

type Handler = (ctx: Ctx, p: PlayerState) => string | null;

/** Common checks for actions on the adventure map. */
function mapGuard(state: GameState, p: PlayerState, allowEnded = false): string | null {
  if (isInBattle(state, p.id)) return "Сначала закончите бой";
  if (!allowEnded && p.endedDay) return "Вы уже завершили день. Дождитесь соперника";
  const h = state.heroes[p.heroId];
  if (!h || !h.alive) return "Ваш герой погиб";
  return null;
}

function castleGuard(state: GameState, p: PlayerState): string | null {
  return mapGuard(state, p) ?? (heroCastle(state, p.id) ? null : "Герой должен быть в своём замке");
}

function actMove(to: Point): Handler {
  return (ctx, p) => {
    const { state } = ctx;
    const err = mapGuard(state, p);
    if (err) return err;
    const hero = state.heroes[p.heroId] as Hero;
    if (to.x >= state.cols || to.y >= state.rows) return "Неверная клетка";
    if (to.x === hero.x && to.y === hero.y) return "Герой уже здесь";
    if (!isExplored(state, p.id, to.x, to.y)) return "Там туман. Подойдите ближе";
    if (hero.mp <= 0) return "Шаги на сегодня кончились. Завершите день";
    const path = findPath(state, hero.id, to);
    const first = path[0];
    if (!first) return "Туда не пройти";
    if (tileBusy(state, hero, first.x, first.y)) return "Там уже идёт бой";
    walk(ctx, p, hero, path);
    return null;
  };
}

function actHire(unit: UnitId): Handler {
  return (ctx, p) => {
    const { state } = ctx;
    const err = castleGuard(state, p);
    if (err) return err;
    const hero = state.heroes[p.heroId] as Hero;
    if (p.faction === "neutral" || !FACTION_UNITS[p.faction].includes(unit)) return "В этом замке такой отряд не нанять";
    const req = HIRE_REQUIRES[unit];
    if (req && !p.built[req]) return `Нужна постройка: ${BUILDINGS[req].name}`;
    const avail = p.growth[unit] ?? 0;
    if (avail <= 0) return "Нет доступных отрядов. Ждите новой недели";
    const cost = UNITS[unit].cost;
    const n = Math.min(avail, Math.floor(p.gold / cost));
    if (n <= 0) return "Не хватает золота";
    if (hero.army.length >= MAX_ARMY_STACKS && !hero.army.some((s) => s.unit === unit)) {
      return `В армии не больше ${MAX_ARMY_STACKS} отрядов`;
    }
    p.growth[unit] = avail - n;
    addGold(ctx, p, -n * cost, "hire");
    hero.army = mergeArmy([...hero.army, { unit, count: n }]);
    return null;
  };
}

/** A building is offered to a faction unless it only grows creatures of another faction (griffin tower for necropolis). */
export function buildingAvailable(faction: PlayerState["faction"], id: BuildingId): boolean {
  if (faction === "neutral") return false;
  const units = Object.keys(BUILDING_GROWTH[id] ?? {}) as UnitId[];
  return units.every((u) => FACTION_UNITS[faction].includes(u));
}

function actBuild(id: BuildingId): Handler {
  return (ctx, p) => {
    const err = castleGuard(ctx.state, p);
    if (err) return err;
    const def = BUILDINGS[id];
    if (!buildingAvailable(p.faction, id)) return "Эта постройка недоступна вашей фракции";
    if (p.built[id]) return "Уже построено";
    if (p.builtToday) return "Сегодня уже строили";
    if (def.requires && !p.built[def.requires]) return `Нужна постройка: ${BUILDINGS[def.requires].name}`;
    if (p.gold < def.cost) return "Не хватает золота";
    if (!canPayResources(p, def.res)) return "Не хватает ресурсов";
    p.built[id] = true;
    p.builtToday = true;
    payResources(p, def.res);
    addGold(ctx, p, -def.cost, "build");
    for (const [unit, n] of Object.entries(BUILDING_GROWTH[id] ?? {}) as [UnitId, number][]) {
      p.growth[unit] = (p.growth[unit] ?? 0) + n;
    }
    toast(ctx, `Построено: ${def.name}`, p.id);
    completeQuest(ctx, p.id, "build");
    return null;
  };
}

/** True when the player has at least the given metal and crystals. */
export function canPayResources(p: PlayerState, cost: Partial<Record<ResourceId, number>> | undefined): boolean {
  return RESOURCE_IDS.every((r) => resourceOf(p, r) >= (cost?.[r] ?? 0));
}

function payResources(p: PlayerState, cost: Partial<Record<ResourceId, number>> | undefined): void {
  if (!cost) return;
  const res = { ...(p.res ?? {}) };
  for (const r of RESOURCE_IDS) res[r] = (res[r] ?? 0) - (cost[r] ?? 0);
  p.res = res;
}

/** A new hero of the player standing at `at`: level 1 with a militia, named from HERO_NAMES. */
export function newHero(state: GameState, p: PlayerState, at: Point): Hero {
  const ids = playerHeroIds(p);
  const faction = p.faction === "neutral" ? "castle" : p.faction;
  const names = HERO_NAMES[faction];
  const name = names[(ids.length - 1) % names.length] ?? "Герой";
  let n = ids.length;
  while (state.heroes[`h${p.seat}-${n}`]) n++;
  const militia = REVIVE_ARMY[faction];
  const hero: Hero = {
    id: `h${p.seat}-${n}`, owner: p.id, name, x: at.x, y: at.y, mp: 0, level: 1, exp: 0, alive: true,
    base: baseStats(), equipped: {}, bag: [], army: [{ unit: militia.unit, count: militia.count }],
  };
  hero.mp = maxMovement(hero);
  state.heroes[hero.id] = hero;
  p.heroIds = [...ids, hero.id];
  return hero;
}

const actHireHero: Handler = (ctx, p) => {
  const { state } = ctx;
  const err = castleGuard(state, p);
  if (err) return err;
  if (!p.built.tavern) return `Нужна постройка: ${BUILDINGS.tavern.name}`;
  if (playerHeroIds(p).length >= MAX_HEROES) return `Героев не больше ${MAX_HEROES}`;
  if (p.gold < HERO_COST) return "Не хватает золота";
  const castle = heroCastle(state, p.id) as MapObject;
  const at = freeTileNear(state, castle);
  if (!at) return "У замка нет свободного места";
  addGold(ctx, p, -HERO_COST, "hero");
  const hero = newHero(state, p, at);
  reveal(state, p.id);
  toast(ctx, `В таверне нанят герой ${hero.name}. Он ждёт у замка.`, p.id);
  return null;
};

function actSelectHero(id: string): Handler {
  return (ctx, p) => {
    if (isInBattle(ctx.state, p.id)) return "Сначала закончите бой";
    const hero = ctx.state.heroes[id];
    if (!hero || hero.owner !== p.id || !playerHeroIds(p).includes(id)) return "Нет такого героя";
    if (!hero.alive) return "Этот герой разбит и вернётся утром";
    p.heroId = id;
    return null;
  };
}

function actUpgrade(unit: UnitId): Handler {
  return (ctx, p) => {
    const { state } = ctx;
    const err = castleGuard(state, p);
    if (err) return err;
    const hero = state.heroes[p.heroId] as Hero;
    const up = UPGRADES[unit];
    if (!up) return "Этот отряд нельзя улучшить";
    if (!p.built.forge) return `Нужна постройка: ${BUILDINGS.forge.name}`;
    const st = hero.army.find((s) => s.unit === unit && s.count > 0);
    if (!st) return "Такого отряда нет в армии";
    const n = Math.min(st.count, Math.floor(p.gold / up.cost));
    if (n <= 0) return "Не хватает золота";
    if (n < st.count && hero.army.length >= MAX_ARMY_STACKS && !hero.army.some((s) => s.unit === up.to)) {
      return `В армии не больше ${MAX_ARMY_STACKS} отрядов`;
    }
    addGold(ctx, p, -n * up.cost, "upgrade");
    hero.army = mergeArmy(
      hero.army.flatMap((s) => (s === st ? [{ unit: up.to, count: n }, { unit: s.unit, count: s.count - n }] : [s])),
    );
    completeQuest(ctx, p.id, "upgrade");
    return null;
  };
}

function actEquip(id: ArtifactId): Handler {
  return (ctx, p) => {
    const err = mapGuard(ctx.state, p, true);
    if (err) return err;
    const hero = ctx.state.heroes[p.heroId] as Hero;
    if (!hero.bag.includes(id)) return "Этого артефакта нет в рюкзаке";
    equip(hero, id);
    clampMp(hero);
    return null;
  };
}

function actUnequip(slot: SlotId): Handler {
  return (ctx, p) => {
    const err = mapGuard(ctx.state, p, true);
    if (err) return err;
    const hero = ctx.state.heroes[p.heroId] as Hero;
    if (!hero.equipped[slot]) return "Слот пуст";
    unequip(hero, slot);
    clampMp(hero);
    return null;
  };
}

function actChooseSkill(index: 0 | 1): Handler {
  return (ctx, p) => {
    const choice = p.levelChoices[0];
    if (!choice) return "Нет навыка для выбора";
    const id = choice[index];
    if (!id || !SKILLS[id]) return "Нет такого варианта";
    // a fallen hero keeps its level and returns, so the choice can still be made
    const hero = ctx.state.heroes[p.heroId];
    if (!hero) return "Ваш герой погиб";
    p.levelChoices.shift();
    applySkill(hero, id);
    toast(ctx, `Навык: ${SKILLS[id].name} (${SKILLS[id].desc})`, p.id);
    return null;
  };
}

function actBattle(action: BattleAction): Handler {
  return (ctx, p) => {
    const { state } = ctx;
    const mine = state.battles.filter((ab) => ab.sides[0] === p.id || ab.sides[1] === p.id);
    if (mine.length === 0) return "Вы не в бою";
    const ab = mine.find((x) => {
      const s = activeStack(x.battle);
      return !!s && x.sides[s.side] === p.id && !isAutoSide(state, x, s.side);
    });
    if (!ab) return "Сейчас ходит противник";
    const res = applyBattleAction(ab.battle, action);
    if (!res.ok) return res.error ?? "Так нельзя";
    pushBattleEvents(ctx, ab, res.events);
    driveBattle(ctx, ab);
    return null;
  };
}

function setAuto(ab: ActiveBattle, side: Seat): void {
  const auto: [boolean, boolean] = ab.auto ? [ab.auto[0], ab.auto[1]] : [false, false];
  auto[side] = true;
  ab.auto = auto;
}

/** Upper bound on battles autoAll hands over in one call (each one removes a monster, garrison or hero). */
const AUTO_ALL_LIMIT = 64;

/**
 * Hands every battle of the player to the AI and plays until a human's stack is active or the battles end.
 * Battles that start while this runs (a won fight re-runs arrive, which may meet another guard or a
 * garrison) are handed over too.
 */
function autoAll(ctx: Ctx, p: PlayerState): void {
  const { state } = ctx;
  for (let guard = 0; guard < AUTO_ALL_LIMIT && state.winner === null; guard++) {
    const ab = state.battles.find((x) => ([0, 1] as const).some((side) => x.sides[side] === p.id && !x.auto?.[side]));
    if (!ab) break;
    for (const side of [0, 1] as const) if (ab.sides[side] === p.id) setAuto(ab, side);
    driveBattle(ctx, ab);
  }
}

const actAutoBattle: Handler = (ctx, p) => {
  if (!isInBattle(ctx.state, p.id)) return "Вы не в бою";
  autoAll(ctx, p);
  return null;
};

const actEndDay: Handler = (ctx, p) => {
  const { state } = ctx;
  if (p.endedDay) return "Вы уже завершили день";
  const playing = state.battles.some((ab) =>
    ([0, 1] as const).some((side) => ab.sides[side] === p.id && !isAutoSide(state, ab, side)));
  if (playing) return "Сначала закончите бой";
  p.endedDay = true;
  maybeEndOfDay(ctx);
  return null;
};

function handlerFor(action: GameAction): Handler {
  switch (action.type) {
    case "move": return actMove(action.to);
    case "endDay": return actEndDay;
    case "hire": return actHire(action.unit);
    case "build": return actBuild(action.building);
    case "upgrade": return actUpgrade(action.unit);
    case "equip": return actEquip(action.artifact);
    case "unequip": return actUnequip(action.slot);
    case "chooseSkill": return actChooseSkill(action.index);
    case "battle": return actBattle(action.action);
    case "autoBattle": return actAutoBattle;
    case "hireHero": return actHireHero;
    case "selectHero": return actSelectHero(action.hero);
  }
}

function run(state: GameState, player: PlayerId, action: GameAction | null): ActionResult {
  const fail = (error: string): ActionResult => ({ ok: false, error, events: [] });
  if (action !== null && !isGameAction(action)) return fail("Неверное действие");
  if (state.winner !== null) return fail("Игра окончена");
  const p = getPlayer(state, player);
  if (!p) return fail("Нет такого игрока");
  if (p.defeated) return fail("Вы выбыли из игры");
  const ctx: Ctx = { state, rng: createRng(state.rngState), events: [] };
  if (action === null) {
    // forced end of day: the AI finishes the player's battles, then the day is ended for them
    autoAll(ctx, p);
    if (state.winner === null && !p.defeated && !p.endedDay) {
      p.endedDay = true;
      maybeEndOfDay(ctx);
    }
  } else {
    // Handlers validate everything before their first mutation, so an error leaves the state untouched.
    const err = handlerFor(action)(ctx, p);
    if (err !== null) return fail(err);
  }
  state.rngState = ctx.rng.state;
  return { ok: true, events: ctx.events };
}

/**
 * Validates and applies one player action. Mutates `state` on success; on error returns
 * { ok: false, error } (Russian) and leaves the state unchanged.
 */
export function applyAction(state: GameState, player: PlayerId, action: GameAction): ActionResult {
  return run(state, player, action);
}

/**
 * For the server's day timer: the AI finishes the player's battles (autoBattle) and the day is
 * ended for them even if a battle against another human is still running.
 */
export function forceEndDay(state: GameState, player: PlayerId): ActionResult {
  return run(state, player, null);
}
