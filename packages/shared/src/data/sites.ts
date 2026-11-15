import type { ArmyStack } from "../types";
import { FACTION_UNITS } from "./growth";
import type { Faction } from "./units";
import { UNITS } from "./units";

// Visitable map sites and weekly events: reasons to explore beyond chests and mines.

export type SiteId = "shrine" | "well" | "camp";
export const SITE_IDS: readonly SiteId[] = ["shrine", "well", "camp"];

export interface SiteDef {
  id: SiteId;
  name: string;
  /** What a visit gives (ru). */
  desc: string;
}

export const SITES: Record<SiteId, SiteDef> = {
  shrine: { id: "shrine", name: "Святилище опыта", desc: "+500 опыта, каждому герою один раз" },
  well: { id: "well", name: "Колодец", desc: "+4 шага, раз в день" },
  camp: { id: "camp", name: "Лагерь наёмников", desc: "отряд стрелков в армию, раз в неделю" },
};

/** Experience a hero gets at a shrine (once per hero). */
export const SHRINE_EXP = 500;
/** Movement points from a well (once per hero per day). */
export const WELL_MP = 4;
/** Gold value of the stack that joins from a mercenary camp (once per week, whoever comes first). */
export const CAMP_VALUE = 600;

export type WeekEventId = "plain" | "plenty" | "gold" | "wolves";
export const WEEK_EVENT_IDS: readonly WeekEventId[] = ["plain", "plenty", "gold", "wolves"];

export interface WeekEventDef {
  id: WeekEventId;
  name: string;
  desc: string;
  /** Relative chance of the event at the start of a week. */
  weight: number;
}

export const WEEK_EVENTS: Record<WeekEventId, WeekEventDef> = {
  plain: { id: "plain", name: "Тихая неделя", desc: "ничего особенного", weight: 4 },
  plenty: { id: "plenty", name: "Неделя изобилия", desc: "прирост войск в замках +50%", weight: 2 },
  gold: { id: "gold", name: "Золотая неделя", desc: "золотые рудники дают вдвое больше", weight: 2 },
  wolves: { id: "wolves", name: "Неделя волков", desc: "дикие отряды на карте выросли на треть", weight: 2 },
};

/** Growth multiplier for castle creatures in a week of plenty. */
export const PLENTY_GROWTH = 1.5;
/** Multiplier of wild monster stacks in a week of wolves. */
export const WOLVES_GROWTH = 4 / 3;

/** Stack that joins from a mercenary camp: the faction's second-tier unit worth about CAMP_VALUE gold. */
export function campStack(faction: Faction): ArmyStack | undefined {
  if (faction === "neutral") return undefined;
  const unit = FACTION_UNITS[faction][1];
  if (!unit) return undefined;
  return { unit, count: Math.max(1, Math.floor(CAMP_VALUE / UNITS[unit].cost)) };
}
