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
/** Days a player whose hero lives on may stay without a castle before losing. */
export const HOMELESS_DAYS = 7;
/** Creatures added to the garrison of every castle a player owns at the start of each week (tier 1 of the owner). */
export const GARRISON_WEEKLY: Record<"castle" | "necropolis", { unit: "pike" | "skeleton"; count: number }> = {
  castle: { unit: "pike", count: 5 },
  necropolis: { unit: "skeleton", count: 6 },
};
/** Army a fallen hero returns with to one of the player's castles the next morning. */
export const REVIVE_ARMY: Record<"castle" | "necropolis", { unit: "pike" | "skeleton"; count: number }> = {
  castle: { unit: "pike", count: 8 },
  necropolis: { unit: "skeleton", count: 10 },
};

/** Resources besides gold: metal (for buildings) and crystals (for the strongest buildings). */
export type ResourceId = "metal" | "crystal";
export const RESOURCE_IDS: readonly ResourceId[] = ["metal", "crystal"];
export const RESOURCE_NAMES: Record<ResourceId, string> = { metal: "металл", crystal: "кристаллы" };
/** Resources each player starts with. */
export const START_RESOURCES: Record<ResourceId, number> = { metal: 5, crystal: 2 };
/** Daily yield of a metal or crystal mine (a gold mine gives MINE_INCOME gold). */
export const MINE_YIELD: Record<ResourceId, number> = { metal: 2, crystal: 1 };
/** Player-facing yield of a mine, as in "Рудник ваш: +2 металла в день". */
export const MINE_YIELD_TEXT: Record<ResourceId, string> = { metal: "+2 металла", crystal: "+1 кристалл" };
/** Daily resources from the warehouse building. */
export const WAREHOUSE_YIELD: Record<ResourceId, number> = { metal: 2, crystal: 1 };
/** Extra daily gold from the citadel building. */
export const CITADEL_INCOME = 500;
/** Gold for a new hero in the tavern; a player leads at most MAX_HEROES heroes. */
export const HERO_COST = 2500;
export const MAX_HEROES = 2;
/** Names of the heroes the tavern offers, per faction. */
export const HERO_NAMES: Record<"castle" | "necropolis", readonly string[]> = {
  castle: ["Ратибор", "Велена", "Ярослав"],
  necropolis: ["Сайрус", "Нера", "Кадавр"],
};

// ================= AI difficulty =================

export type AiLevel = "easy" | "normal" | "hard";
export const AI_LEVELS: readonly AiLevel[] = ["easy", "normal", "hard"];

export interface AiLevelRule {
  /** Multiplier for the AI's daily gold. */
  income: number;
  /** Multiplier for the AI's weekly creature growth. */
  growth: number;
  /** Extra gold for the AI at the start. */
  startGold: number;
  /** Day from which the AI hunts enemy heroes. */
  heroDay: number;
  /** Whether the AI hires a second hero in the tavern. */
  secondHero: boolean;
}

/**
 * "normal" is the plain game. Picked from sims of a greedy scripted player against the AI on random maps
 * (36 games each): the bot won about 55% on easy, 20% on normal and 3% on hard.
 */
export const AI_LEVEL_RULES: Record<AiLevel, AiLevelRule> = {
  easy: { income: 0.5, growth: 0.55, startGold: 0, heroDay: 15, secondHero: false },
  normal: { income: 1, growth: 1, startGold: 0, heroDay: 5, secondHero: true },
  hard: { income: 1.35, growth: 1.3, startGold: 2000, heroDay: 3, secondHero: true },
};

export function isAiLevel(x: unknown): x is AiLevel {
  return typeof x === "string" && (AI_LEVELS as readonly string[]).includes(x);
}
