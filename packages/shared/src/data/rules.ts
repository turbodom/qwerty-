/** Global economy and movement constants from the prototype. */
export const START_GOLD = 2500;
export const CASTLE_INCOME = 1000;
export const MINE_INCOME = 500;
export const BASE_MOVEMENT = 12;
export const DAYS_PER_WEEK = 7;
/** Chance that a defeated monster drops an artifact from DROP_POOL. */
export const DROP_CHANCE = 0.5;

/** Approximate army size shown for unseen/foreign stacks. */
export function approxCount(n: number): string {
  return n < 5 ? "мало" : n < 10 ? "5–9" : n < 20 ? "10–19" : n < 50 ? "20–49" : "50+";
}
export const CHEST_GOLD = 1000;
/** Maximum number of stacks in a hero's army (hiring a new unit type is refused beyond it). */
export const MAX_ARMY_STACKS = 5;
