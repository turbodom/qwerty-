import type { BuildingId } from "./buildings";
import type { PlayableFaction, UnitId } from "./units";

export interface GrowthRule {
  unit: UnitId;
  amount: number;
  /** Growth only if this building is built. */
  requires?: BuildingId;
  /** Growth only from this week on (week 1 = days 1..7). */
  fromWeek?: number;
}

/** Units each faction can hire in its castle. */
export const FACTION_UNITS: Record<PlayableFaction, readonly UnitId[]> = {
  castle: ["pike", "archer", "griffin"],
  necropolis: ["skeleton", "ghost", "lich"],
};

/** Building required to hire a unit at all. */
export const HIRE_REQUIRES: Partial<Record<UnitId, BuildingId>> = { griffin: "griffinTower" };

/** Available creatures at game start. */
export const START_GROWTH: Record<PlayableFaction, Partial<Record<UnitId, number>>> = {
  castle: { pike: 10, archer: 6, griffin: 0 },
  necropolis: { skeleton: 8, ghost: 3, lich: 0 },
};

/** Added at the start of every week (prototype weekly tick; differs from START_GROWTH for the necropolis). */
export const WEEKLY_GROWTH: Record<PlayableFaction, readonly GrowthRule[]> = {
  castle: [
    { unit: "pike", amount: 10 },
    { unit: "archer", amount: 6 },
    { unit: "griffin", amount: 3, requires: "griffinTower" },
  ],
  necropolis: [
    { unit: "skeleton", amount: 12 },
    { unit: "ghost", amount: 5 },
    { unit: "lich", amount: 2, fromWeek: 2 },
  ],
};

/** Immediate growth granted when a building is completed (prototype: tower gives 3 griffins right away). */
export const BUILDING_GROWTH: Partial<Record<BuildingId, Partial<Record<UnitId, number>>>> = {
  griffinTower: { griffin: 3 },
};

/** Week number for a day (day 1..7 = week 1). */
export function weekOf(day: number): number {
  return Math.floor((day - 1) / 7) + 1;
}

/** True when `day` is the first day of a new week (8, 15, ...). */
export function isNewWeek(day: number): boolean {
  return day > 1 && (day - 1) % 7 === 0;
}

/** Growth added at the start of `week` given the player's buildings. */
export function weeklyGrowth(
  faction: PlayableFaction,
  week: number,
  built: Partial<Record<BuildingId, true>>,
): Partial<Record<UnitId, number>> {
  const out: Partial<Record<UnitId, number>> = {};
  for (const r of WEEKLY_GROWTH[faction]) {
    if (r.requires && !built[r.requires]) continue;
    if (r.fromWeek !== undefined && week < r.fromWeek) continue;
    out[r.unit] = (out[r.unit] ?? 0) + r.amount;
  }
  return out;
}
