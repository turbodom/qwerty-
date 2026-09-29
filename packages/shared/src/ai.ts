import type { GameState, Hero, MapObject, PlayerId, PlayerState, Point } from "./types";
import type { SkillId } from "./data/skills";
import { SKILL_IDS } from "./data/skills";
import type { UnitId } from "./data/units";
import { UNITS } from "./data/units";
import { FACTION_UNITS, HIRE_REQUIRES } from "./data/growth";
import { MAX_ARMY_STACKS } from "./data/rules";
import { findPath, getPlayer, guardOf } from "./map";
import { heroPower, mergeArmy } from "./hero";

// Port of the prototype's aiTurn / aiRecruit. Pure planning lives here; game.ts executes the plan.

/** Target values (gold-like score) before subtracting the path cost. */
export const AI_VALUE = { chest: 1000, mine: 1400, artifact: 1500, monster: 700, castle: 5000, hero: 3000 } as const;
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

  for (const o of state.objects) {
    if (o.gone) continue;
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
        if (castleWorthRushing(state, p, o, myP)) consider(o.x, o.y, AI_VALUE.castle);
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
