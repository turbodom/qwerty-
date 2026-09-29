import type { StatKey } from "./stats";

export type SkillId = "offense" | "armor" | "sorcery" | "pathfinding" | "luck" | "leadership";

export interface SkillDef { id: SkillId; name: string; stat: StatKey; amount: number; desc: string }

export const SKILLS: Record<SkillId, SkillDef> = {
  offense: { id: "offense", name: "Нападение", stat: "atk", amount: 2, desc: "+2 атака" },
  armor: { id: "armor", name: "Оборона", stat: "def", amount: 2, desc: "+2 защита" },
  sorcery: { id: "sorcery", name: "Чародейство", stat: "pow", amount: 1, desc: "+1 магия" },
  pathfinding: { id: "pathfinding", name: "Следопыт", stat: "move", amount: 2, desc: "+2 шага в день" },
  luck: { id: "luck", name: "Удача", stat: "luck", amount: 1, desc: "+1 удача" },
  leadership: { id: "leadership", name: "Лидерство", stat: "morale", amount: 1, desc: "+1 мораль" },
};

/** Skill order as in the prototype; the AI picks from the first three (offense/armor/sorcery). */
export const SKILL_IDS: readonly SkillId[] = ["offense", "armor", "sorcery", "pathfinding", "luck", "leadership"];

/** Experience needed to go from `level` to `level + 1` (prototype: lvl * 300). */
export const EXP_PER_LEVEL = 300;
export function expToNext(level: number): number {
  return level * EXP_PER_LEVEL;
}
