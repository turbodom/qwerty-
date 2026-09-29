import type { ArtifactId, SlotId } from "./data/artifacts";
import type { PlayableFaction } from "./data/units";
import type { ArmyStack, MapObjectKind, Point, Seat } from "./types";
import { START_GOLD } from "./data/rules";

/** "." plain (passable), "F" forest, "M" mountains, "W" water. */
export type Terrain = "." | "F" | "M" | "W";

export interface MapObjectDef {
  kind: MapObjectKind;
  x: number;
  y: number;
  /** Seat that owns the object at start (castles). */
  owner?: Seat;
  artifact?: ArtifactId;
  army?: ArmyStack[];
  garrison?: ArmyStack[];
}

export interface MapStart {
  hero: Point;
  /** Index into MapDef.objects of this seat's castle. */
  castleIndex: number;
  // Optional extensions beyond ARCHITECTURE.md; when absent, SEAT_DEFAULTS[seat] (the prototype start) is used.
  faction?: PlayableFaction;
  heroName?: string;
  army?: ArmyStack[];
  equipped?: Partial<Record<SlotId, ArtifactId>>;
  gold?: number;
}

/** A start with every optional field filled in. */
export type ResolvedMapStart = Required<MapStart>;

/** Prototype newGame() start per seat: seat 0 castle (Эльмира), seat 1 necropolis (Моргот). */
export const SEAT_DEFAULTS: readonly [Omit<ResolvedMapStart, "hero" | "castleIndex">, Omit<ResolvedMapStart, "hero" | "castleIndex">] = [
  {
    faction: "castle", heroName: "Эльмира",
    army: [{ unit: "pike", count: 20 }, { unit: "archer", count: 10 }], equipped: {}, gold: START_GOLD,
  },
  {
    faction: "necropolis", heroName: "Моргот",
    army: [{ unit: "skeleton", count: 20 }, { unit: "ghost", count: 3 }],
    equipped: { weapon: "ashBlade", shield: "shield" }, gold: START_GOLD,
  },
];

/** The map's start for `seat` with missing fields taken from SEAT_DEFAULTS (fresh copies). Undefined if absent. */
export function mapStart(map: MapDef, seat: Seat): ResolvedMapStart | undefined {
  const s = map.starts[seat];
  if (!s) return undefined;
  const d = SEAT_DEFAULTS[seat];
  return {
    hero: { x: s.hero.x, y: s.hero.y },
    castleIndex: s.castleIndex,
    faction: s.faction ?? d.faction,
    heroName: s.heroName ?? d.heroName,
    army: (s.army ?? d.army).map((a) => ({ unit: a.unit, count: a.count })),
    equipped: { ...(s.equipped ?? d.equipped) },
    gold: s.gold ?? d.gold,
  };
}

export interface MapDef {
  id: string;
  name: string;
  cols: number;
  rows: number;
  terrain: string[];
  /** Indexed by seat. */
  starts: MapStart[];
  objects: MapObjectDef[];
}

const VALLEY_TERRAIN: string[] = [
  "FF....MMM..FFF",
  "F.....MM.....F",
  "..F.......F...",
  "..FF..WW......",
  "......WWW..MM.",
  ".MM....W....M.",
  ".M..F.......F.",
  "....FF..MM....",
  "....F...MM..F.",
  ".F........F...",
  ".FF..WWW......",
  "......WW..FF..",
  "..M.......F...",
  ".MM....FF.....",
  "F.....FF.....F",
  "FFF.......FFFF",
];

const valley: MapDef = {
  id: "valley",
  name: "Долина",
  cols: 14,
  rows: 16,
  terrain: VALLEY_TERRAIN,
  starts: [
    {
      hero: { x: 3, y: 13 }, castleIndex: 0, faction: "castle", heroName: "Эльмира",
      army: [{ unit: "pike", count: 20 }, { unit: "archer", count: 10 }], equipped: {}, gold: START_GOLD,
    },
    {
      hero: { x: 11, y: 2 }, castleIndex: 1, faction: "necropolis", heroName: "Моргот",
      army: [{ unit: "skeleton", count: 20 }, { unit: "ghost", count: 3 }],
      equipped: { weapon: "ashBlade", shield: "shield" }, gold: START_GOLD,
    },
  ],
  objects: [
    { kind: "castle", x: 2, y: 14, owner: 0 },
    { kind: "castle", x: 11, y: 1, owner: 1, garrison: [{ unit: "skeleton", count: 20 }, { unit: "ghost", count: 3 }] },
    { kind: "mine", x: 7, y: 8 },
    { kind: "mine", x: 5, y: 2 },
    { kind: "chest", x: 0, y: 9 },
    { kind: "chest", x: 9, y: 12 },
    { kind: "chest", x: 13, y: 6 },
    { kind: "chest", x: 6, y: 5 },
    { kind: "artifact", x: 3, y: 7, artifact: "sword" },
    { kind: "artifact", x: 11, y: 9, artifact: "ashMail" },
    { kind: "artifact", x: 4, y: 1, artifact: "boots" },
    { kind: "artifact", x: 13, y: 9, artifact: "apprenticeRing" },
    { kind: "artifact", x: 8, y: 1, artifact: "crown" },
    { kind: "artifact", x: 0, y: 3, artifact: "ashHelm" },
    { kind: "artifact", x: 12, y: 12, artifact: "stormOrb" },
    { kind: "monster", x: 8, y: 2, army: [{ unit: "ghost", count: 10 }] },
    { kind: "monster", x: 1, y: 3, army: [{ unit: "wolf", count: 25 }] },
    { kind: "monster", x: 12, y: 13, army: [{ unit: "ghost", count: 14 }] },
    { kind: "monster", x: 3, y: 8, army: [{ unit: "wolf", count: 14 }] },
    { kind: "monster", x: 11, y: 10, army: [{ unit: "skeleton", count: 18 }] },
    { kind: "monster", x: 4, y: 11, army: [{ unit: "wolf", count: 8 }] },
    { kind: "monster", x: 9, y: 5, army: [{ unit: "wolf", count: 20 }] },
  ],
};

export const MAPS: Record<string, MapDef> = { valley };

/** Terrain character at (x, y), or undefined outside the map. */
export function terrainAt(terrain: readonly string[], x: number, y: number): Terrain | undefined {
  const row = terrain[y];
  if (row === undefined || x < 0 || x >= row.length) return undefined;
  return row[x] as Terrain;
}

/** Only plains are passable on the adventure map. */
export function isPassable(terrain: readonly string[], x: number, y: number): boolean {
  return terrainAt(terrain, x, y) === ".";
}
