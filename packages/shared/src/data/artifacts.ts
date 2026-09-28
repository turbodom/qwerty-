import type { StatKey } from "./stats";
import { STAT_NAMES } from "./stats";

export type SlotId = "head" | "neck" | "shoulders" | "torso" | "cloak" | "feet" | "weapon" | "shield" | "ring1" | "ring2";
export type ArtifactSlot = Exclude<SlotId, "ring1" | "ring2"> | "ring";
export type ArtifactId =
  | "sword" | "shield" | "rookieMail" | "apprenticeRing" | "boots" | "windCloak" | "luckAmulet"
  | "valorPauldrons" | "mageRing" | "crown" | "ashHelm" | "ashMail" | "ashBlade" | "stormOrb";
export type SetId = "ash";
export type Rarity = 0 | 1 | 2 | 3;

export interface ArtifactDef {
  id: ArtifactId;
  name: string;
  slot: ArtifactSlot;
  rarity: Rarity;
  set?: SetId;
  fx: Partial<Record<StatKey, number>>;
  desc?: string;
}

export const ARTIFACTS: Record<ArtifactId, ArtifactDef> = {
  sword: { id: "sword", name: "Меч силы", slot: "weapon", rarity: 0, fx: { atk: 2 } },
  shield: { id: "shield", name: "Щит стража", slot: "shield", rarity: 0, fx: { def: 2 } },
  rookieMail: { id: "rookieMail", name: "Кираса новобранца", slot: "torso", rarity: 0, fx: { def: 1, atk: 1 } },
  apprenticeRing: { id: "apprenticeRing", name: "Кольцо ученика", slot: "ring", rarity: 0, fx: { pow: 1 } },
  boots: { id: "boots", name: "Сапоги странника", slot: "feet", rarity: 1, fx: { move: 3 } },
  windCloak: { id: "windCloak", name: "Плащ ветра", slot: "cloak", rarity: 1, fx: { spd: 1 } },
  luckAmulet: { id: "luckAmulet", name: "Амулет удачи", slot: "neck", rarity: 1, fx: { luck: 1 } },
  valorPauldrons: { id: "valorPauldrons", name: "Наплечники доблести", slot: "shoulders", rarity: 1, fx: { morale: 1 } },
  mageRing: { id: "mageRing", name: "Кольцо мага", slot: "ring", rarity: 1, fx: { pow: 2 } },
  crown: { id: "crown", name: "Корона владыки", slot: "head", rarity: 2, fx: { atk: 2, def: 2, pow: 1 } },
  ashHelm: { id: "ashHelm", name: "Шлем пепла", slot: "head", rarity: 2, set: "ash", fx: { atk: 1, def: 1 } },
  ashMail: { id: "ashMail", name: "Кираса пепла", slot: "torso", rarity: 2, set: "ash", fx: { def: 3 } },
  ashBlade: { id: "ashBlade", name: "Клинок пепла", slot: "weapon", rarity: 2, set: "ash", fx: { atk: 3 } },
  stormOrb: {
    id: "stormOrb", name: "Сфера бури", slot: "neck", rarity: 3,
    fx: { boltX: 1, pow: 1 }, desc: "молния бьёт вдвое сильнее",
  },
};

export const ARTIFACT_IDS = Object.keys(ARTIFACTS) as ArtifactId[];

export const SLOTS: readonly { id: SlotId; name: string }[] = [
  { id: "head", name: "Голова" },
  { id: "neck", name: "Шея" },
  { id: "shoulders", name: "Плечи" },
  { id: "torso", name: "Торс" },
  { id: "cloak", name: "Плащ" },
  { id: "feet", name: "Ноги" },
  { id: "weapon", name: "Оружие" },
  { id: "shield", name: "Щит" },
  { id: "ring1", name: "Кольцо" },
  { id: "ring2", name: "Кольцо" },
];

export const RARITY_NAMES: readonly string[] = ["обычный", "редкий", "эпический", "легендарный"];

export const SETS: Record<SetId, { name: string; need: number; fx: Partial<Record<StatKey, number>>; desc: string }> = {
  ash: { name: "Комплект пепла", need: 3, fx: { dmgPct: 20, morale: 1 }, desc: "+20% урона всем отрядам, мораль +1" },
};

/** Artifacts that can drop from defeated neutral monsters. */
export const DROP_POOL: readonly ArtifactId[] = ["windCloak", "valorPauldrons", "mageRing", "rookieMail", "luckAmulet"];

/** Player-facing effect text, e.g. "+2 атака, часть комплекта" (boltX is described by desc). */
export function artifactFxText(a: ArtifactDef): string {
  const parts: string[] = [];
  for (const k of Object.keys(a.fx) as StatKey[]) {
    if (k === "boltX") continue;
    parts.push("+" + String(a.fx[k]) + " " + STAT_NAMES[k]);
  }
  if (a.desc) parts.push(a.desc);
  if (a.set) parts.push("часть комплекта");
  return parts.join(", ");
}
