export type Faction = "castle" | "necropolis" | "neutral";
/** Factions a player can play. */
export type PlayableFaction = Exclude<Faction, "neutral">;
export type UnitId =
  | "pike" | "halberd" | "archer" | "marksman" | "griffin" | "royalGriffin"
  | "skeleton" | "ghost" | "lich" | "wolf";

export interface UnitDef {
  id: UnitId;
  name: string;
  faction: Faction;
  tier: number;
  hp: number;
  atk: number;
  def: number;
  dmg: [number, number];
  spd: number;
  cost: number;
  shots?: number;
  fly?: boolean;
  upgradesTo?: UnitId;
  upgradeCost?: number;
  upgraded?: boolean;
  /** +50% damage against flyers. */
  antiFly?: boolean;
  /** Retaliates against every attack. */
  unlimRetal?: boolean;
  /** The attacked stack does not retaliate. */
  noRetal?: boolean;
  /** Hits enemies adjacent to the target for half damage. */
  splash?: boolean;
  /** Ability description (ru). */
  ability?: string;
}

export const UNITS: Record<UnitId, UnitDef> = {
  pike: {
    id: "pike", name: "Копейщики", faction: "castle", tier: 1,
    hp: 10, atk: 4, def: 5, dmg: [1, 3], spd: 4, cost: 60,
    upgradesTo: "halberd", upgradeCost: 40,
    antiFly: true, ability: "+50% урона летающим",
  },
  halberd: {
    id: "halberd", name: "Алебардщики", faction: "castle", tier: 1,
    hp: 10, atk: 6, def: 5, dmg: [2, 3], spd: 5, cost: 100, upgraded: true,
    antiFly: true, ability: "+50% урона летающим",
  },
  archer: {
    id: "archer", name: "Лучники", faction: "castle", tier: 2,
    hp: 10, atk: 6, def: 3, dmg: [2, 3], spd: 4, cost: 100, shots: 12,
    upgradesTo: "marksman", upgradeCost: 60,
  },
  marksman: {
    id: "marksman", name: "Меткие стрелки", faction: "castle", tier: 2,
    hp: 10, atk: 6, def: 3, dmg: [3, 4], spd: 6, cost: 160, shots: 24, upgraded: true,
  },
  griffin: {
    id: "griffin", name: "Грифоны", faction: "castle", tier: 3,
    hp: 25, atk: 8, def: 8, dmg: [3, 6], spd: 6, cost: 200, fly: true,
    upgradesTo: "royalGriffin", upgradeCost: 100,
    unlimRetal: true, ability: "отвечает на каждую атаку",
  },
  royalGriffin: {
    id: "royalGriffin", name: "Королевские грифоны", faction: "castle", tier: 3,
    hp: 25, atk: 9, def: 9, dmg: [3, 6], spd: 9, cost: 300, fly: true, upgraded: true,
    unlimRetal: true, ability: "отвечает на каждую атаку",
  },
  skeleton: {
    id: "skeleton", name: "Скелеты", faction: "necropolis", tier: 1,
    hp: 6, atk: 5, def: 4, dmg: [1, 3], spd: 4, cost: 60,
  },
  ghost: {
    id: "ghost", name: "Призраки", faction: "necropolis", tier: 2,
    hp: 18, atk: 7, def: 7, dmg: [2, 4], spd: 5, cost: 150, fly: true,
    noRetal: true, ability: "враг не отвечает",
  },
  lich: {
    id: "lich", name: "Личи", faction: "necropolis", tier: 3,
    hp: 30, atk: 13, def: 10, dmg: [11, 13], spd: 6, cost: 550, shots: 12,
    splash: true, ability: "задевает соседних врагов",
  },
  wolf: {
    id: "wolf", name: "Волки", faction: "neutral", tier: 1,
    hp: 6, atk: 5, def: 3, dmg: [1, 4], spd: 6, cost: 0,
  },
};

export const UNIT_IDS = Object.keys(UNITS) as UnitId[];

/** Upgrade table (forge): base unit -> upgraded unit and per-creature price difference. */
export const UPGRADES: Partial<Record<UnitId, { to: UnitId; cost: number }>> = {
  pike: { to: "halberd", cost: 40 },
  archer: { to: "marksman", cost: 60 },
  griffin: { to: "royalGriffin", cost: 100 },
};
