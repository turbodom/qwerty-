import type { GameState, Hero, MapObject, MapObjectDef, PlayerState } from "../src";
import { MAPS, baseStats, mapStart } from "../src";

export function mkHero(id: string, owner: string, x: number, y: number, extra: Partial<Hero> = {}): Hero {
  return {
    id, owner, name: id, x, y, mp: 12, level: 1, exp: 0, alive: true,
    base: baseStats(), equipped: {}, bag: [], army: [{ unit: "pike", count: 20 }], ...extra,
  };
}

function mkPlayer(id: string, seat: 0 | 1, cols: number, rows: number, castleId: string): PlayerState {
  return {
    id, name: id, seat, isAI: false, faction: seat === 0 ? "castle" : "necropolis", gold: 2500,
    heroId: `h${seat}`, castleId, explored: "0".repeat(cols * rows), growth: { pike: 10 }, built: {},
    builtToday: false, quests: {}, levelChoices: [], endedDay: false, defeated: false,
  };
}

/** Small hand-made state: two players p0/p1, heroes h0/h1 (h1 placed far away / off unless given). */
export function mkState(terrain: string[], objects: Omit<MapObject, "id">[] = [], heroes: Hero[] = []): GameState {
  const rows = terrain.length;
  const cols = terrain[0]?.length ?? 0;
  const objs: MapObject[] = objects.map((o, i) => ({ id: `o${i}`, ...o }));
  const hs: Record<string, Hero> = {};
  for (const h of heroes) hs[h.id] = h;
  return {
    version: 1, id: "g", mapId: "test", cols, rows, terrain, day: 1, rngState: 12345,
    players: [mkPlayer("p0", 0, cols, rows, "none"), mkPlayer("p1", 1, cols, rows, "none")],
    heroes: hs, objects: objs, battles: [], winner: null, log: [],
  };
}

/** GameState built from MAPS.valley as the prototype's newGame() lays it out. */
export function valleyState(): GameState {
  const map = MAPS["valley"];
  if (!map) throw new Error("no valley");
  const ids = ["p0", "p1"] as const;
  const objects: MapObject[] = map.objects.map((d: MapObjectDef, i) => {
    const o: MapObject = { id: `o${i}`, kind: d.kind, x: d.x, y: d.y };
    if (d.kind === "castle" || d.kind === "mine") o.owner = d.owner === undefined ? null : ids[d.owner];
    if (d.artifact) o.artifact = d.artifact;
    if (d.army) o.army = d.army.map((s) => ({ ...s }));
    if (d.garrison) o.garrison = d.garrison.map((s) => ({ ...s }));
    return o;
  });
  const heroes: Record<string, Hero> = {};
  const players: PlayerState[] = map.starts.map((_, seat) => {
    const s = mapStart(map, seat as 0 | 1);
    if (!s) throw new Error("no start");
    const pid = ids[seat as 0 | 1];
    const hid = `h${seat}`;
    heroes[hid] = mkHero(hid, pid, s.hero.x, s.hero.y, {
      name: s.heroName, army: s.army.map((a) => ({ ...a })), equipped: { ...s.equipped },
    });
    return {
      ...mkPlayer(pid, seat as 0 | 1, map.cols, map.rows, `o${s.castleIndex}`),
      faction: s.faction, gold: s.gold,
    };
  });
  return {
    version: 1, id: "g", mapId: map.id, cols: map.cols, rows: map.rows, terrain: [...map.terrain], day: 1,
    rngState: 987654321, players, heroes, objects, battles: [], winner: null, log: [],
  };
}
