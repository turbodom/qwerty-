import type { ArtifactDef, ArtifactId, SetId, SlotId } from "./data/artifacts";
import { ARTIFACTS, SETS } from "./data/artifacts";
import { BASE_MOVEMENT } from "./data/rules";
import type { StatKey } from "./data/stats";
import { STAT_KEYS } from "./data/stats";
import { UNITS } from "./data/units";
import type { ArmyStack, Hero } from "./types";

/** Number of equipped items per artifact set. */
export function setCounts(hero: Hero): Partial<Record<SetId, number>> {
  const out: Partial<Record<SetId, number>> = {};
  for (const id of Object.values(hero.equipped)) {
    if (!id) continue;
    const set = ARTIFACTS[id].set;
    if (set) out[set] = (out[set] ?? 0) + 1;
  }
  return out;
}

/** Base stat + equipped artifact effects + completed set bonuses. */
export function effectiveStat(hero: Hero | null | undefined, key: StatKey): number {
  if (!hero) return 0;
  let v = hero.base[key] ?? 0;
  for (const id of Object.values(hero.equipped)) {
    if (!id) continue;
    v += ARTIFACTS[id].fx[key] ?? 0;
  }
  const sets = setCounts(hero);
  for (const s of Object.keys(sets) as SetId[]) {
    const def = SETS[s];
    if ((sets[s] ?? 0) >= def.need) v += def.fx[key] ?? 0;
  }
  return v;
}

/** All effective stats at once (e.g. for BattleHero.stats). */
export function effectiveStats(hero: Hero): Record<StatKey, number> {
  const out = {} as Record<StatKey, number>;
  for (const k of STAT_KEYS) out[k] = effectiveStat(hero, k);
  return out;
}

/** Movement points per day: 12 + move. */
export function maxMovement(hero: Hero): number {
  return BASE_MOVEMENT + effectiveStat(hero, "move");
}

/** Slot an artifact would go to: its own slot; rings go to ring1, then ring2, else replace ring1. */
export function slotFor(hero: Hero, def: ArtifactDef): SlotId {
  if (def.slot !== "ring") return def.slot;
  if (!hero.equipped.ring1) return "ring1";
  if (!hero.equipped.ring2) return "ring2";
  return "ring1";
}

/** Equip an artifact (removing one copy from the bag if present); the replaced item goes to the bag. */
export function equip(hero: Hero, id: ArtifactId): SlotId {
  const slot = slotFor(hero, ARTIFACTS[id]);
  const i = hero.bag.indexOf(id);
  if (i >= 0) hero.bag.splice(i, 1);
  const prev = hero.equipped[slot];
  if (prev) hero.bag.push(prev);
  hero.equipped[slot] = id;
  return slot;
}

/** Move the item in `slot` to the bag. Returns the artifact, or null if the slot was empty. */
export function unequip(hero: Hero, slot: SlotId): ArtifactId | null {
  const id = hero.equipped[slot];
  if (!id) return null;
  hero.bag.push(id);
  delete hero.equipped[slot];
  return id;
}

/** Found artifact: equip if its slot is free, otherwise into the bag. */
export function pickUp(hero: Hero, id: ArtifactId): SlotId | "bag" {
  const slot = slotFor(hero, ARTIFACTS[id]);
  if (!hero.equipped[slot]) {
    hero.equipped[slot] = id;
    return slot;
  }
  hero.bag.push(id);
  return "bag";
}

/** Rough strength estimate of an army (optionally led by a hero), as in the prototype AI. */
export function heroPower(army: readonly ArmyStack[], hero: Hero | null | undefined): number {
  const heroAtkDef = hero ? effectiveStat(hero, "atk") + effectiveStat(hero, "def") : 0;
  let p = 0;
  for (const s of army) {
    const u = UNITS[s.unit];
    p += s.count * u.hp * (1 + (u.atk + u.def + heroAtkDef) / 12) * (u.shots ? 1.3 : 1);
  }
  return p * (1 + (hero ? effectiveStat(hero, "dmgPct") : 0) / 200);
}

/** Merge stacks of the same unit and drop empty ones (order of first appearance kept). */
export function mergeArmy(list: readonly ArmyStack[]): ArmyStack[] {
  const out: ArmyStack[] = [];
  for (const s of list) {
    if (s.count <= 0) continue;
    const e = out.find((o) => o.unit === s.unit);
    if (e) e.count += s.count;
    else out.push({ unit: s.unit, count: s.count });
  }
  return out;
}
