import type { ArtifactId } from "./data/artifacts";
import { ARTIFACTS, ARTIFACT_IDS } from "./data/artifacts";
import type { PlayableFaction, UnitId } from "./data/units";
import { UNITS } from "./data/units";
import { heroPower } from "./hero";
import type { MapDef, MapObjectDef, Terrain } from "./maps";
import { MAPS, SEAT_DEFAULTS } from "./maps";
import { createRng } from "./rng";
import type { Rng } from "./rng";
import type { ArmyStack, Point } from "./types";

// Procedural adventure maps. A map id "random-<size>" makes createGame build a fresh map from the game
// seed, so every match has a different layout. Maps are point-symmetric (rotated 180 degrees around the
// centre) so both seats get the same distances, treasures and guards: fair against the AI and in PvP.

export type MapSize = "s" | "m" | "l";

export const MAP_SIZE_IDS: readonly MapSize[] = ["s", "m", "l"];

/** Odd sizes, so the map has a centre tile for the central treasure. */
export const MAP_SIZES: Record<MapSize, { cols: number; rows: number; name: string }> = {
  s: { cols: 27, rows: 27, name: "малая" },
  m: { cols: 39, rows: 39, name: "средняя" },
  l: { cols: 51, rows: 51, name: "большая" },
};

export const RANDOM_MAP_PREFIX = "random-";

export function randomMapId(size: MapSize): string {
  return `${RANDOM_MAP_PREFIX}${size}`;
}

/** Size of a procedural map id, or undefined when the id is not one. */
export function randomMapSize(mapId: string): MapSize | undefined {
  if (!mapId.startsWith(RANDOM_MAP_PREFIX)) return undefined;
  const size = mapId.slice(RANDOM_MAP_PREFIX.length);
  return (MAP_SIZE_IDS as readonly string[]).includes(size) ? (size as MapSize) : undefined;
}

/** A hand-made map from MAPS or a procedural "random-<size>" id. */
export function isKnownMapId(mapId: string): boolean {
  return Object.hasOwn(MAPS, mapId) || randomMapSize(mapId) !== undefined;
}

/** The map a game with this id and seed is played on (undefined for unknown ids). */
export function resolveMap(mapId: string, seed: number): MapDef | undefined {
  if (Object.hasOwn(MAPS, mapId)) return MAPS[mapId];
  const size = randomMapSize(mapId);
  return size ? generateMap(seed, size) : undefined;
}

/** Castle garrisons at game start on generated maps. */
const HOME_GARRISON: Record<PlayableFaction, ArmyStack[]> = {
  castle: [{ unit: "pike", count: 25 }, { unit: "archer", count: 10 }],
  necropolis: [{ unit: "skeleton", count: 30 }, { unit: "ghost", count: 8 }],
};

/** Monster types by danger zone (0 near home, 1 middle ground, 2 far side, 3 the centre). */
const ZONE_UNITS: readonly (readonly UnitId[])[] = [
  ["pike", "skeleton", "wolf"],
  ["wolf", "archer", "skeleton", "ghost", "halberd"],
  ["ghost", "griffin", "marksman", "wolf", "halberd"],
  ["lich", "royalGriffin", "griffin", "ghost"],
];

/** Guard strength per zone as a multiple of a starting army's power: [min, max]. */
const ZONE_POWER: readonly [number, number][] = [[0.3, 0.7], [0.9, 1.7], [2, 3.6], [5, 6.5]];

/** Artifact rarity found per zone. */
const ZONE_RARITY: readonly number[] = [0, 1, 2, 3];

type Grid = Terrain[][];

interface Ctx {
  rng: Rng;
  cols: number;
  rows: number;
  g: Grid;
}

function mirror(ctx: Ctx, p: Point): Point {
  return { x: ctx.cols - 1 - p.x, y: ctx.rows - 1 - p.y };
}

function inside(ctx: Ctx, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < ctx.cols && y < ctx.rows;
}

function setCell(ctx: Ctx, x: number, y: number, t: Terrain): void {
  const row = ctx.g[y];
  if (row && x >= 0 && x < ctx.cols) row[x] = t;
}

function cell(ctx: Ctx, x: number, y: number): Terrain | undefined {
  return ctx.g[y]?.[x];
}

function cheb(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Scatters forests, mountain ridges and lakes as random-walk blobs. */
function scatterTerrain(ctx: Ctx): void {
  const { rng } = ctx;
  const blobs = Math.round((ctx.cols * ctx.rows) / 13);
  for (let i = 0; i < blobs; i++) {
    const roll = rng.next();
    const t: Terrain = roll < 0.5 ? "F" : roll < 0.8 ? "M" : "W";
    let x = rng.int(0, ctx.cols - 1);
    let y = rng.int(0, ctx.rows - 1);
    const len = t === "M" ? rng.int(5, 14) : t === "W" ? rng.int(3, 8) : rng.int(4, 12);
    let dx = rng.int(-1, 1);
    let dy = rng.int(-1, 1);
    for (let s = 0; s < len; s++) {
      setCell(ctx, x, y, t);
      // lakes and woods are fat, ridges are thin
      if (t !== "M" || rng.next() < 0.3) setCell(ctx, x + rng.int(-1, 1), y + rng.int(-1, 1), t);
      if (t === "W") setCell(ctx, x + rng.int(-1, 1), y + rng.int(-1, 1), t);
      if (rng.next() < (t === "M" ? 0.25 : 0.5) || (dx === 0 && dy === 0)) {
        dx = rng.int(-1, 1);
        dy = rng.int(-1, 1);
      }
      x = Math.max(0, Math.min(ctx.cols - 1, x + dx));
      y = Math.max(0, Math.min(ctx.rows - 1, y + dy));
    }
  }
}

/** Copies every tile onto its mirror so the map is point-symmetric. */
function symmetrize(ctx: Ctx): void {
  const n = ctx.cols * ctx.rows;
  for (let i = 0; i < n; i++) {
    const x = i % ctx.cols;
    const y = Math.floor(i / ctx.cols);
    const m = mirror(ctx, { x, y });
    if (m.y * ctx.cols + m.x <= i) continue;
    setCell(ctx, m.x, m.y, cell(ctx, x, y) ?? ".");
  }
}

function clearDisc(ctx: Ctx, c: Point, r: number): void {
  for (let y = c.y - r; y <= c.y + r; y++) {
    for (let x = c.x - r; x <= c.x + r; x++) {
      if (inside(ctx, x, y) && Math.hypot(x - c.x, y - c.y) <= r + 0.5) setCell(ctx, x, y, ".");
    }
  }
}

/** Carves a wobbly road from a to b (and its mirror image, so the map stays symmetric). */
function carveRoad(ctx: Ctx, a: Point, b: Point): void {
  const { rng } = ctx;
  let x = a.x;
  let y = a.y;
  for (let guard = 0; guard < ctx.cols * ctx.rows && (x !== b.x || y !== b.y); guard++) {
    for (const p of [{ x, y }, mirror(ctx, { x, y })]) setCell(ctx, p.x, p.y, ".");
    if (rng.next() < 0.25) {
      x = Math.max(0, Math.min(ctx.cols - 1, x + rng.int(-1, 1)));
      y = Math.max(0, Math.min(ctx.rows - 1, y + rng.int(-1, 1)));
    } else {
      x += Math.sign(b.x - x);
      y += Math.sign(b.y - y);
    }
  }
  for (const p of [b, mirror(ctx, b)]) setCell(ctx, p.x, p.y, ".");
}

/** BFS distances over passable tiles (8 directions); -1 where unreachable. */
function distances(ctx: Ctx, from: Point): number[] {
  const { cols, rows } = ctx;
  const d = new Array<number>(cols * rows).fill(-1);
  const start = from.y * cols + from.x;
  d[start] = 0;
  const q = [start];
  for (let head = 0; head < q.length; head++) {
    const cur = q[head] as number;
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if ((dx === 0 && dy === 0) || !inside(ctx, nx, ny) || cell(ctx, nx, ny) !== ".") continue;
        const k = ny * cols + nx;
        if (d[k] !== -1) continue;
        d[k] = (d[cur] as number) + 1;
        q.push(k);
      }
    }
  }
  return d;
}

function unitPower(unit: UnitId): number {
  return heroPower([{ unit, count: 1 }], null);
}

/** A neutral army of about `power`, one or two stacks of the zone's creatures. */
function monsterArmy(rng: Rng, zone: number, power: number): ArmyStack[] {
  const pool = ZONE_UNITS[Math.min(zone, ZONE_UNITS.length - 1)] ?? ["wolf"];
  const first = rng.pick(pool);
  if (power < 900 || rng.next() < 0.5) {
    return [{ unit: first, count: Math.max(2, Math.round(power / unitPower(first))) }];
  }
  let second = rng.pick(pool);
  if (second === first) second = pool[(pool.indexOf(first) + 1) % pool.length] ?? first;
  const share = 0.4 + rng.next() * 0.3;
  return [
    { unit: first, count: Math.max(2, Math.round((power * share) / unitPower(first))) },
    { unit: second, count: Math.max(1, Math.round((power * (1 - share)) / unitPower(second))) },
  ];
}

/**
 * Builds a point-symmetric random map: two home castles in opposite corners, winding roads, forests,
 * ridges and lakes, and treasures whose value and guards grow with the distance from home.
 * Deterministic in `seed`.
 */
export function generateMap(seed: number, size: MapSize): MapDef {
  const { cols, rows, name } = MAP_SIZES[size];
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
  const g: Grid = Array.from({ length: rows }, () => Array.from({ length: cols }, (): Terrain => "."));
  const ctx: Ctx = { rng, cols, rows, g };
  const area = cols * rows;
  const scale = area / (39 * 39);

  scatterTerrain(ctx);
  symmetrize(ctx);

  const castle0: Point = { x: rng.int(3, 5), y: rows - 1 - rng.int(3, 5) };
  const hero0: Point = { x: castle0.x + 1, y: castle0.y - 1 };
  const castle1 = mirror(ctx, castle0);
  const hero1 = mirror(ctx, hero0);
  const centre: Point = { x: (cols - 1) / 2, y: (rows - 1) / 2 };
  for (const c of [castle0, castle1]) clearDisc(ctx, c, 2);
  clearDisc(ctx, centre, 1);

  // Roads: the main one to the centre and a couple of detours through the own half, crossing to the
  // other half through mirrored waypoints, so there are several routes and loops.
  const waypoint = (): Point => ({
    x: rng.int(2, cols - 3),
    y: rng.int(Math.floor(rows / 2), rows - 3),
  });
  carveRoad(ctx, hero0, centre);
  const detours = 2 + Math.round(scale);
  for (let i = 0; i < detours; i++) {
    const w = waypoint();
    carveRoad(ctx, hero0, w);
    carveRoad(ctx, w, rng.next() < 0.5 ? centre : mirror(ctx, waypoint()));
  }

  // Pockets that cannot be reached become forest.
  const d0 = distances(ctx, castle0);
  for (let i = 0; i < area; i++) {
    if (d0[i] === -1 && cell(ctx, i % cols, Math.floor(i / cols)) === ".") setCell(ctx, i % cols, Math.floor(i / cols), "F");
  }
  const distTo = (p: Point, from: 0 | 1): number => {
    const q = from === 0 ? p : mirror(ctx, p);
    return d0[q.y * cols + q.x] ?? -1;
  };
  /** 0 at the own castle, 0.5 on the line between the halves. */
  const zoneT = (p: Point): number => {
    const a = distTo(p, 0);
    const b = distTo(p, 1);
    return a < 0 || b < 0 ? 1 : a / Math.max(1, a + b);
  };
  const zoneOf = (t: number): number => (t < 0.2 ? 0 : t < 0.34 ? 1 : 2);

  // ================= objects =================
  const objects: MapObjectDef[] = [
    { kind: "castle", x: castle0.x, y: castle0.y, owner: 0, garrison: HOME_GARRISON[SEAT_DEFAULTS[0].faction] },
    { kind: "castle", x: castle1.x, y: castle1.y, owner: 1, garrison: HOME_GARRISON[SEAT_DEFAULTS[1].faction] },
  ];
  const taken: Point[] = [castle0, castle1, hero0, hero1];
  const startPower = heroPower(SEAT_DEFAULTS[0].army, null);

  const free = (p: Point, spacing: number): boolean => {
    if (!inside(ctx, p.x, p.y) || cell(ctx, p.x, p.y) !== ".") return false;
    const m = mirror(ctx, p);
    if (cheb(p, m) < 3) return false;
    for (const home of [castle0, hero0, castle1, hero1]) if (cheb(p, home) < 3) return false;
    return taken.every((q) => cheb(p, q) >= spacing && cheb(m, q) >= spacing);
  };
  const add = (def: MapObjectDef): void => {
    const m = mirror(ctx, def);
    objects.push(def, { ...def, x: m.x, y: m.y, ...(def.army ? { army: def.army.map((s) => ({ ...s })) } : {}) });
    taken.push({ x: def.x, y: def.y }, m);
  };
  /** Random free tile of the own half with zone value in [lo, hi). */
  const spot = (lo: number, hi: number, spacing = 2): Point | undefined => {
    for (let tries = 0; tries < 400; tries++) {
      const p = { x: rng.int(0, cols - 1), y: rng.int(0, rows - 1) };
      const t = zoneT(p);
      if (t >= lo && t < hi && free(p, spacing)) return p;
    }
    return undefined;
  };
  const guardPower = (zone: number): number => {
    const [lo, hi] = ZONE_POWER[zone] ?? [1, 1];
    return startPower * (lo + rng.next() * (hi - lo));
  };
  /** Puts a monster next to `p`, on the side facing the own castle. */
  const guard = (p: Point, zone: number): void => {
    const around: Point[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const q = { x: p.x + dx, y: p.y + dy };
        if ((dx !== 0 || dy !== 0) && free(q, 1)) around.push(q);
      }
    }
    around.sort((a, b) => distTo(a, 0) - distTo(b, 0));
    const at = around[0];
    if (at) add({ kind: "monster", x: at.x, y: at.y, army: monsterArmy(rng, zone, guardPower(zone)) });
  };
  const artifactPools: ArtifactId[][] = [0, 1, 2, 3].map((r) => ARTIFACT_IDS.filter((id) => ARTIFACTS[id].rarity === r));
  const artifactOf = (rarity: number): ArtifactId => {
    const pool = artifactPools[rarity] ?? [];
    const fallback = artifactPools[0] ?? ["sword"];
    const list = pool.length > 0 ? pool : fallback;
    const [id] = list.splice(rng.int(0, list.length - 1), 1);
    if (list.length === 0) artifactPools[rarity] = ARTIFACT_IDS.filter((a) => ARTIFACTS[a].rarity === rarity);
    return id ?? "sword";
  };

  // The central relic, guarded from both sides.
  objects.push({ kind: "artifact", x: centre.x, y: centre.y, artifact: artifactOf(ZONE_RARITY[3] ?? 3) });
  taken.push(centre);
  const centreGuard = { x: centre.x - 1, y: centre.y + 1 };
  add({ kind: "monster", x: centreGuard.x, y: centreGuard.y, army: monsterArmy(rng, 3, startPower * (ZONE_POWER[3]?.[0] ?? 5)) });

  // Mines: one near home, more in the middle ground.
  const mines: [number, number][] = [[0.1, 0.22], ...Array.from({ length: 1 + Math.round(scale) }, (): [number, number] => [0.22, 0.46])];
  for (const [lo, hi] of mines) {
    const p = spot(lo, hi, 3);
    if (!p) continue;
    add({ kind: "mine", x: p.x, y: p.y });
    guard(p, zoneOf(zoneT(p)));
  }

  // Neutral fortresses on medium and large maps: extra income and a place to hire.
  const forts = size === "s" ? 0 : size === "m" ? 1 : 2;
  for (let i = 0; i < forts; i++) {
    const p = spot(0.3, 0.47, 4);
    if (!p) continue;
    add({ kind: "castle", x: p.x, y: p.y, garrison: monsterArmy(rng, 2, startPower * (2.4 + rng.next())) });
  }

  // Artifacts: common near home, rarer farther out, always guarded beyond the home zone.
  const artifactZones = [0, 0, 1, 1, ...Array.from({ length: Math.round(2 * scale) }, () => 2)];
  for (const zone of artifactZones) {
    const p = zone === 0 ? spot(0.08, 0.24) : zone === 1 ? spot(0.2, 0.36) : spot(0.34, 0.49);
    if (!p) continue;
    add({ kind: "artifact", x: p.x, y: p.y, artifact: artifactOf(ZONE_RARITY[zone] ?? 0) });
    if (zone > 0 || rng.next() < 0.5) guard(p, zone);
  }

  // Treasure chests, some guarded.
  const chests = Math.round(6 * scale) + 2;
  for (let i = 0; i < chests; i++) {
    const p = spot(0.06, 0.49);
    if (!p) continue;
    add({ kind: "chest", x: p.x, y: p.y });
    const zone = zoneOf(zoneT(p));
    if (zone > 0 && rng.next() < 0.6) guard(p, zone);
  }

  // Roaming monsters that block roads and passes.
  const roamers = Math.round(4 * scale) + 1;
  for (let i = 0; i < roamers; i++) {
    const p = spot(0.16, 0.49);
    if (!p) continue;
    add({ kind: "monster", x: p.x, y: p.y, army: monsterArmy(rng, zoneOf(zoneT(p)), guardPower(zoneOf(zoneT(p)))) });
  }

  return {
    id: randomMapId(size),
    name: `Пустошь (${name} карта)`,
    cols,
    rows,
    terrain: g.map((row) => row.join("")),
    starts: [
      { hero: hero0, castleIndex: 0 },
      { hero: hero1, castleIndex: 1 },
    ],
    objects,
  };
}
