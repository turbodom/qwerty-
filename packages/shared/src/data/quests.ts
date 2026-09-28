export type QuestId = "chest" | "mine" | "fight" | "artifact" | "build" | "upgrade" | "level3" | "conquer";

export interface QuestDef { id: QuestId; name: string; gold: number; exp: number }

export const QUESTS: readonly QuestDef[] = [
  { id: "chest", name: "Откройте сундук", gold: 500, exp: 0 },
  { id: "mine", name: "Захватите рудник", gold: 1000, exp: 0 },
  { id: "fight", name: "Победите охрану монстров", gold: 0, exp: 150 },
  { id: "artifact", name: "Найдите артефакт", gold: 1000, exp: 0 },
  { id: "build", name: "Постройте здание в замке", gold: 500, exp: 0 },
  { id: "upgrade", name: "Улучшите отряд в кузнице", gold: 0, exp: 200 },
  { id: "level3", name: "Достигните 3-го уровня", gold: 1500, exp: 0 },
  { id: "conquer", name: "Захватите вражеский замок", gold: 0, exp: 0 },
];
