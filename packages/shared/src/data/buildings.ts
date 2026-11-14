import type { ResourceId } from "./rules";

export type BuildingId = "griffinTower" | "mageGuild" | "forge" | "tavern" | "warehouse" | "fort" | "citadel";

export interface BuildingDef {
  id: BuildingId;
  name: string;
  /** Gold cost. */
  cost: number;
  /** Extra resource cost (metal, crystal). */
  res?: Partial<Record<ResourceId, number>>;
  /** Building that must stand first. */
  requires?: BuildingId;
  desc: string;
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  griffinTower: { id: "griffinTower", name: "Грифонья башня", cost: 2000, desc: "открывает грифонов, 3 в неделю" },
  mageGuild: { id: "mageGuild", name: "Гильдия магов", cost: 1500, desc: "открывает Лечение и Ускорение" },
  forge: { id: "forge", name: "Кузница", cost: 1000, desc: "позволяет улучшать отряды" },
  tavern: { id: "tavern", name: "Таверна", cost: 1000, res: { metal: 5 }, desc: "можно нанять второго героя" },
  warehouse: { id: "warehouse", name: "Склад", cost: 2000, res: { metal: 5 }, desc: "+2 металла и +1 кристалл в день" },
  fort: { id: "fort", name: "Форт", cost: 2500, res: { metal: 10 }, desc: "+50% прироста войск, гарнизон растёт вдвое быстрее" },
  citadel: {
    id: "citadel", name: "Цитадель", cost: 5000, res: { metal: 10, crystal: 5 }, requires: "fort",
    desc: "ещё +50% прироста войск и +500 золота в день",
  },
};

export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];
