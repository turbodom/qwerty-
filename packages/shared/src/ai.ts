import type { GameState, Hero, MapObject, PlayerId, PlayerState, Point } from "./types";
import type { SkillId } from "./data/skills";
import { SKILL_IDS } from "./data/skills";
import type { UnitId } from "./data/units";
import { UNITS, UPGRADES } from "./data/units";
import type { BuildingId } from "./data/buildings";
import { BUILDINGS } from "./data/buildings";
import { BUILDING_GROWTH, FACTION_UNITS, HIRE_REQUIRES, isNewWeek } from "./data/growth";
import { MAX_ARMY_STACKS } from "./data/rules";
import { findPath, getPlayer, guardOf, ownedCastles, terrainOk } from "./map";
import { heroPower, maxMovement, mergeArmy } from "./hero";

// Port of the prototype's aiTurn / aiRecruit. Pure planning lives here; game.ts executes the plan.

/** Target values (gold-like score) before subtracting the path cost. */
export const AI_VALUE = {
  chest: 1000, mine: 1400, artifact: 1500, monster: 700, castle: 5000, hero: 3000, neutralCastle: 4000, retreat: 2600,
} as const;
/** Score lost per step of the path. */
export const AI_STEP_COST = 60;
/** Skip a guarded non-monster target when guard power * margin exceeds the AI's power. */
export const AI_GUARD_MARGIN = 1.3;
/** Attack a monster only when the AI is this many times stronger. */
export const AI_MONSTER_MARGIN = 1.5;
/** Attack the enemy hero from this day on, when this many times stronger. */
export const AI_HERO_DAY = 5;
export const AI_HERO_MARGIN = 1.5;
/** Rush the enemy castle from this day on. */
export const AI_CASTLE_DAY = 8;
/** ...when the defending hero is dead, weaker by this margin, or farther than AI_CASTLE_NEAR from home. */
export const AI_CASTLE_MARGIN = 1.2;
export const AI_CASTLE_NEAR = 6;
/** Stay out of reach of an enemy hero that is this many times stronger (it would catch and beat us). */
export const AI_DANGER_MARGIN = 1.5;
/** Gold kept after building so the AI can still hire (except on the first day of a week, when it only hires). */
export const AI_BUILD_RESERVE = 500;
/** The AI levels up only these skills (prototype: the first three: offense, armor, sorcery). */
export const AI_SKILL_POOL: readonly SkillId[] = SKILL_IDS.slice(0, 3);

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function heroOfPlayer(state: GameState, p: PlayerState | undefined): Hero | undefined {
  return p ? state.heroes[p.heroId] : undefined;
}

/**
 * Best path for the player's hero according to the prototype's AI scoring
 * (value - 60 per step): chests, mines, artifacts, weaker monsters, the enemy castle
 * (from day 8) and the enemy hero (from day 5, when much stronger).
 * Returns the full path (not cut to the hero's movement points), or [] when nothing is worth it.
 * The AI plans with full knowledge of the map, as in the prototype.
 */
export function planAiMove(state: GameState, playerId: PlayerId): Point[] {
  const p = getPlayer(state, playerId);
  const h = heroOfPlayer(state, p);
  if (!p || !h || !h.alive) return [];
  const myP = heroPower(h.army, h);
  const best: { path: Point[]; score: number } = { path: [], score: -Infinity };
  // As in the prototype, a target is not dropped because an enemy hero stands on it or on the way:
  // walking into that hero starts the hero battle, which is exactly what the prototype AI does
  // (e.g. rushing the castle at 1.2x power while its defender sits inside).
  const consider = (x: number, y: number, value: number): void => {
    const path = findPath(state, h.id, { x, y });
    if (path.length === 0) return;
    const score = value - path.length * AI_STEP_COST;
    if (score > best.score) {
      best.path = path;
      best.score = score;
    }
  };

  // Enemy heroes that would beat ours: targets within their reach tomorrow are skipped, and when our hero
  // stands within that reach it falls back to the nearest own castle, whose garrison joins the defence.
  const threats: { dist: number[]; reach: number }[] = [];
  for (const q of state.players) {
    if (q.id === p.id || q.defeated) continue;
    const e = heroOfPlayer(state, q);
    if (e && e.alive && heroPower(e.army, e) > myP * AI_DANGER_MARGIN) {
      threats.push({ dist: terrainDistances(state, e, maxMovement(e)), reach: maxMovement(e) });
    }
  }
  const unsafe = (x: number, y: number): boolean => {
    const k = y * state.cols + x;
    return threats.some((t) => (t.dist[k] ?? -1) >= 0 && (t.dist[k] ?? 0) <= t.reach);
  };
  const home = ownedCastles(state, p.id);
  if (unsafe(h.x, h.y) && home.length > 0) {
    for (const c of home) {
      if (c.x === h.x && c.y === h.y) return [];
      consider(c.x, c.y, AI_VALUE.retreat);
    }
    if (best.path.length > 0) return best.path;
  }

  for (const o of state.objects) {
    if (o.gone) continue;
    if (threats.length > 0 && unsafe(o.x, o.y) && !(o.kind === "castle" && o.owner === p.id)) continue;
    const g = guardOf(state, o.x, o.y);
    if (g && o.kind !== "monster" && heroPower(g.army ?? [], null) * AI_GUARD_MARGIN > myP) continue;
    switch (o.kind) {
      case "chest":
        consider(o.x, o.y, AI_VALUE.chest);
        break;
      case "mine":
        if (o.owner !== p.id) consider(o.x, o.y, AI_VALUE.mine);
        break;
      case "artifact":
        consider(o.x, o.y, AI_VALUE.artifact);
        break;
      case "monster":
        if (myP > heroPower(o.army ?? [], null) * AI_MONSTER_MARGIN) consider(o.x, o.y, AI_VALUE.monster);
        break;
      case "castle":
        if (!o.owner) {
          if (heroPower(mergeArmy(o.garrison ?? []), null) * AI_MONSTER_MARGIN < myP) consider(o.x, o.y, AI_VALUE.neutralCastle);
        } else if (castleWorthRushing(state, p, o, myP)) {
          consider(o.x, o.y, AI_VALUE.castle);
        }
        break;
    }
  }

  if (state.day >= AI_HERO_DAY) {
    for (const q of state.players) {
      if (q.id === p.id || q.defeated) continue;
      const e = heroOfPlayer(state, q);
      if (e && e.alive && myP > heroPower(e.army, e) * AI_HERO_MARGIN) consider(e.x, e.y, AI_VALUE.hero);
    }
  }
  return best.path;
}

/** Steps over passable terrain from `from` (objects ignored), up to `limit`; -1 beyond it or unreachable. */
function terrainDistances(state: GameState, from: Point, limit: number): number[] {
  const { cols, rows } = state;
  const d = new Array<number>(cols * rows).fill(-1);
  const start = from.y * cols + from.x;
  d[start] = 0;
  const q = [start];
  for (let head = 0; head < q.length; head++) {
    const cur = q[head] as number;
    const dc = d[cur] as number;
    if (dc >= limit) continue;
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if ((dx === 0 && dy === 0) || !terrainOk(state, nx, ny)) continue;
        const k = ny * cols + nx;
        if (d[k] !== -1) continue;
        d[k] = dc + 1;
        q.push(k);
      }
    }
  }
  return d;
}

function castleWorthRushing(state: GameState, p: PlayerState, o: MapObject, myP: number): boolean {
  if (!o.owner || o.owner === p.id || state.day < AI_CASTLE_DAY) return false;
  // Extension over the prototype (whose AI never met a garrison): do not attack a much stronger garrison.
  if (heroPower(mergeArmy(o.garrison ?? []), null) * AI_CASTLE_MARGIN > myP) return false;
  const defender = heroOfPlayer(state, getPlayer(state, o.owner));
  return (
    !defender || !defender.alive ||
    myP > heroPower(defender.army, defender) * AI_CASTLE_MARGIN ||
    chebyshev(defender, o) > AI_CASTLE_NEAR
  );
}

/**
 * Prototype aiRecruit: buys as many creatures as gold allows, most expensive tier first,
 * straight into the hero's army (wherever the hero is). Mutates the state and returns what was hired.
 */
export function aiRecruit(state: GameState, playerId: PlayerId): { unit: UnitId; count: number; gold: number }[] {
  const out: { unit: UnitId; count: number; gold: number }[] = [];
  const p = getPlayer(state, playerId);
  const h = heroOfPlayer(state, p);
  if (!p || !h || !h.alive || p.faction === "neutral") return out;
  const units = [...FACTION_UNITS[p.faction]].reverse();
  for (const unit of units) {
    const req = HIRE_REQUIRES[unit];
    if (req && !p.built[req]) continue;
    const cost = UNITS[unit].cost;
    if (cost <= 0) continue;
    const avail = p.growth[unit] ?? 0;
    const n = Math.min(avail, Math.floor(p.gold / cost));
    if (n <= 0) continue;
    if (h.army.length >= MAX_ARMY_STACKS && !h.army.some((s) => s.unit === unit)) continue;
    p.growth[unit] = avail - n;
    p.gold -= n * cost;
    h.army = mergeArmy([...h.army, { unit, count: n }]);
    out.push({ unit, count: n, gold: n * cost });
  }
  return out;
}

/** Buildings the AI wants, most useful first. */
const AI_BUILD_ORDER: readonly BuildingId[] = ["griffinTower", "forge", "mageGuild"];

/**
 * Builds the first missing building of AI_BUILD_ORDER the faction can use, when the gold allows it and
 * leaves AI_BUILD_RESERVE (never on the first day of a week: then the gold goes to the new creatures).
 * Mutates the state; returns what was built.
 */
export function aiBuild(state: GameState, playerId: PlayerId): { building: BuildingId; gold: number } | null {
  const p = getPlayer(state, playerId);
  if (!p || p.defeated || p.faction === "neutral" || p.builtToday || isNewWeek(state.day)) return null;
  if (ownedCastles(state, p.id).length === 0) return null;
  const units = FACTION_UNITS[p.faction];
  for (const id of AI_BUILD_ORDER) {
    if (p.built[id]) continue;
    const grows = Object.keys(BUILDING_GROWTH[id] ?? {}) as UnitId[];
    if (!grows.every((u) => units.includes(u))) continue;
    const cost = BUILDINGS[id].cost;
    if (p.gold < cost + AI_BUILD_RESERVE) return null;
    p.gold -= cost;
    p.built[id] = true;
    p.builtToday = true;
    for (const [unit, n] of Object.entries(BUILDING_GROWTH[id] ?? {}) as [UnitId, number][]) {
      p.growth[unit] = (p.growth[unit] ?? 0) + n;
    }
    return { building: id, gold: cost };
  }
  return null;
}

/** With a forge, upgrades the hero's stacks with the gold left after hiring (strongest tier first). Returns gold spent. */
export function aiUpgrade(state: GameState, playerId: PlayerId): number {
  const p = getPlayer(state, playerId);
  const h = heroOfPlayer(state, p);
  if (!p || !h || !h.alive || !p.built.forge) return 0;
  let spent = 0;
  const order = h.army.map((s) => s.unit).sort((a, b) => UNITS[b].tier - UNITS[a].tier);
  for (const unit of order) {
    const st = h.army.find((s) => s.unit === unit);
    const up = UPGRADES[unit];
    if (!st) continue;
    if (!up) continue;
    const n = Math.min(st.count, Math.floor(p.gold / up.cost));
    if (n <= 0) continue;
    if (n < st.count && h.army.length >= MAX_ARMY_STACKS && !h.army.some((s) => s.unit === up.to)) continue;
    p.gold -= n * up.cost;
    spent += n * up.cost;
    h.army = mergeArmy(h.army.flatMap((s) => (s === st ? [{ unit: up.to, count: n }, { unit: s.unit, count: s.count - n }] : [s])));
  }
  return spent;
}
