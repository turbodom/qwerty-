import {
  BUILDINGS, FACTION_UNITS, HIRE_REQUIRES, MAX_ARMY_STACKS, UNITS, UPGRADES, buildingAvailable, heroCastle,
} from "@korony/shared";
import type {
  ActiveBattle, BuildingId, GameState, Hero, MapObject, PlayerId, PlayerState, PlayerView, Seat, UnitId,
} from "@korony/shared";
import type { I18nKey, I18nParams } from "../i18n";
import { buildingName } from "../i18n/catalog";

/** A translatable reason why an action is not possible right now. */
export interface Reason {
  key: I18nKey;
  params?: I18nParams;
}

export type OwnerColor = "blue" | "red" | "grey";

export function mePlayer(view: PlayerView): PlayerState | undefined {
  return view.state.players.find((p) => p.id === view.you);
}

export function myHero(view: PlayerView): Hero | undefined {
  const me = mePlayer(view);
  return me ? view.state.heroes[me.heroId] : undefined;
}

/** The first battle the viewer takes part in (views only contain the viewer's battles). */
export function myBattle(view: PlayerView): ActiveBattle | undefined {
  return view.state.battles.find((ab) => ab.sides[0] === view.you || ab.sides[1] === view.you);
}

/** The viewer's side in a battle (0 when not found). */
export function mySide(ab: ActiveBattle, you: PlayerId): Seat {
  return ab.sides[1] === you && ab.sides[0] !== you ? 1 : 0;
}

export function seatOf(state: GameState, playerId: PlayerId | null | undefined): Seat | null {
  if (!playerId) return null;
  const p = state.players.find((x) => x.id === playerId);
  return p ? p.seat : null;
}

/** Map colour of an owner: seat 0 blue, seat 1 red, nobody grey. */
export function ownerColor(state: GameState, owner: PlayerId | null | undefined): OwnerColor {
  const seat = seatOf(state, owner);
  return seat === 0 ? "blue" : seat === 1 ? "red" : "grey";
}

export function bannerOf(state: GameState, owner: PlayerId | null | undefined): string | undefined {
  if (!owner) return undefined;
  return state.players.find((p) => p.id === owner)?.banner;
}

/** Week number and day of week (both from 1). */
export function weekDay(day: number): { week: number; day: number } {
  return { week: Math.floor((day - 1) / 7) + 1, day: ((day - 1) % 7) + 1 };
}

export function objectAtView(state: GameState, x: number, y: number): MapObject | undefined {
  return state.objects.find((o) => !o.gone && o.x === x && o.y === y);
}

// ================= castle actions (mirrors the engine checks for disabled states) =================

function castleReason(view: PlayerView): Reason | null {
  const state = view.state;
  const me = mePlayer(view);
  if (!me) return { key: "reason.gameOver" };
  if (state.winner !== null || me.defeated) return { key: "reason.gameOver" };
  if (myBattle(view)) return { key: "reason.inBattle" };
  if (me.endedDay) return { key: "reason.dayEnded" };
  const hero = myHero(view);
  if (!hero || !hero.alive) return { key: "reason.heroDead" };
  if (!heroCastle(state, view.you)) return { key: "reason.notInCastle" };
  return null;
}

export interface HireInfo {
  available: number;
  /** How many the next hire would buy (0 when not possible). */
  n: number;
  reason: Reason | null;
}

export function hireInfo(view: PlayerView, unit: UnitId): HireInfo {
  const me = mePlayer(view);
  const available = me?.growth[unit] ?? 0;
  const guard = castleReason(view);
  const cost = UNITS[unit].cost;
  const n = me && cost > 0 ? Math.min(available, Math.floor(me.gold / cost)) : 0;
  if (guard) return { available, n: 0, reason: guard };
  if (!me || me.faction === "neutral" || !FACTION_UNITS[me.faction].includes(unit)) {
    return { available, n: 0, reason: { key: "reason.gameOver" } };
  }
  const req = HIRE_REQUIRES[unit];
  if (req && !me.built[req]) return { available, n: 0, reason: { key: "reason.needsBuilding", params: { name: buildingName(req) } } };
  if (available <= 0) return { available, n: 0, reason: { key: "reason.noneAvailable" } };
  if (n <= 0) return { available, n: 0, reason: { key: "reason.noGold" } };
  const hero = myHero(view);
  if (hero && hero.army.length >= MAX_ARMY_STACKS && !hero.army.some((s) => s.unit === unit)) {
    return { available, n: 0, reason: { key: "reason.armyFull", params: { n: MAX_ARMY_STACKS } } };
  }
  return { available, n, reason: null };
}

/** Buildings this faction can have, in catalog order. */
export function factionBuildings(view: PlayerView): BuildingId[] {
  const me = mePlayer(view);
  if (!me) return [];
  return (Object.keys(BUILDINGS) as BuildingId[]).filter((id) => buildingAvailable(me.faction, id));
}

export function buildReason(view: PlayerView, id: BuildingId): Reason | null {
  const me = mePlayer(view);
  const guard = castleReason(view);
  if (guard) return guard;
  if (!me) return { key: "reason.gameOver" };
  if (me.built[id]) return { key: "reason.alreadyBuilt" };
  if (me.builtToday) return { key: "reason.builtToday" };
  if (me.gold < BUILDINGS[id].cost) return { key: "reason.noGold" };
  return null;
}

export interface UpgradeInfo {
  to: UnitId;
  cost: number;
  count: number;
  n: number;
  reason: Reason | null;
}

/** Upgrade option for a stack of the hero's army, or null when the unit cannot be upgraded. */
export function upgradeInfo(view: PlayerView, unit: UnitId): UpgradeInfo | null {
  const up = UPGRADES[unit];
  if (!up) return null;
  const me = mePlayer(view);
  const hero = myHero(view);
  const st = hero?.army.find((s) => s.unit === unit && s.count > 0);
  const count = st?.count ?? 0;
  const n = me ? Math.min(count, Math.floor(me.gold / up.cost)) : 0;
  const base = { to: up.to, cost: up.cost, count };
  const guard = castleReason(view);
  if (guard) return { ...base, n: 0, reason: guard };
  if (!me?.built.forge) return { ...base, n: 0, reason: { key: "reason.needsBuilding", params: { name: buildingName("forge") } } };
  if (n <= 0) return { ...base, n: 0, reason: { key: "reason.noGold" } };
  if (hero && n < count && hero.army.length >= MAX_ARMY_STACKS && !hero.army.some((s) => s.unit === up.to)) {
    return { ...base, n: 0, reason: { key: "reason.armyFull", params: { n: MAX_ARMY_STACKS } } };
  }
  return { ...base, n, reason: null };
}

/** Why the map (movement / end of day) is locked, or null. */
export function mapLockReason(view: PlayerView): Reason | null {
  const me = mePlayer(view);
  if (!me || view.state.winner !== null || me.defeated) return { key: "reason.gameOver" };
  if (myBattle(view)) return { key: "reason.inBattle" };
  if (me.endedDay) return { key: "reason.dayEnded" };
  const hero = myHero(view);
  if (!hero || !hero.alive) return { key: "reason.heroDead" };
  return null;
}
