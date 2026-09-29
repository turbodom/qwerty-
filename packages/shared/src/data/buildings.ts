export type BuildingId = "griffinTower" | "mageGuild" | "forge";

export interface BuildingDef { id: BuildingId; name: string; cost: number; desc: string }

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  griffinTower: { id: "griffinTower", name: "Грифонья башня", cost: 2000, desc: "открывает грифонов, 3 в неделю" },
  mageGuild: { id: "mageGuild", name: "Гильдия магов", cost: 1500, desc: "открывает Лечение и Ускорение" },
  forge: { id: "forge", name: "Кузница", cost: 1000, desc: "позволяет улучшать отряды" },
};

export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];
