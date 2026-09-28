export type StatKey = "atk" | "def" | "pow" | "move" | "spd" | "luck" | "morale" | "dmgPct" | "boltX";

export const STAT_KEYS: readonly StatKey[] = ["atk", "def", "pow", "move", "spd", "luck", "morale", "dmgPct", "boltX"];

/** Player-facing stat names used in effect texts (boltX has its own description). */
export const STAT_NAMES: Record<StatKey, string> = {
  atk: "атака",
  def: "защита",
  pow: "магия",
  move: "шагов в день",
  spd: "скорость отрядов",
  luck: "удача",
  morale: "мораль",
  dmgPct: "% урона",
  boltX: "сила молнии",
};

/** Hero base stats on creation: atk, def, pow = 1, everything else 0. */
export function baseStats(): Record<StatKey, number> {
  return { atk: 1, def: 1, pow: 1, move: 0, spd: 0, luck: 0, morale: 0, dmgPct: 0, boltX: 0 };
}
