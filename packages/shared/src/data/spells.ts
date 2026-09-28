import type { BuildingId } from "./buildings";

export type SpellId = "bolt" | "heal" | "haste";

export interface SpellDef { id: SpellId; name: string; target: "enemy" | "ally"; requires?: BuildingId; desc: string }

export const SPELLS: Record<SpellId, SpellDef> = {
  bolt: { id: "bolt", name: "Молния", target: "enemy", desc: "бьёт вражеский отряд на 15 + 15 × магия урона" },
  heal: {
    id: "heal", name: "Лечение", target: "ally", requires: "mageGuild",
    desc: "восстанавливает 20 + 20 × магия здоровья своему отряду, поднимает павших",
  },
  haste: { id: "haste", name: "Ускорение", target: "ally", requires: "mageGuild", desc: "+2 к скорости своему отряду до конца раунда" },
};

export const SPELL_IDS = Object.keys(SPELLS) as SpellId[];

/** Bolt damage: (15 + 15 * pow) * (1 + boltX). */
export function boltDamage(pow: number, boltX: number): number {
  return (15 + 15 * pow) * (1 + boltX);
}

/** Heal amount in hit points: 20 + 20 * pow. */
export function healAmount(pow: number): number {
  return 20 + 20 * pow;
}

/** Speed bonus from haste. */
export const HASTE_BONUS = 2;
