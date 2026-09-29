import type { ArmyStack, GameState, Hero, MapObject, PlayerId, PlayerView } from "./types";
import { approxCount } from "./data/rules";

/** Approximate army size in Russian, as shown in the prototype ("мало", "5–9", ..., "50+"). */
export function approx(count: number): string {
  return approxCount(count);
}

/** Replaces exact counts with an approximate hint (count becomes 0). */
function hideCounts(army: ArmyStack[] | undefined): ArmyStack[] | undefined {
  if (!army) return army;
  return army.map((s) => ({ unit: s.unit, count: 0, countHint: approx(s.count) }));
}

function explored(state: GameState, ex: string, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return false;
  return ex[y * state.cols + x] === "1";
}

/**
 * What `player` is allowed to see. Returns a deep copy; the source state is not modified.
 * Hidden: objects and foreign heroes on unexplored tiles, exact foreign army sizes
 * (replaced with `countHint`), opponent gold/bag/exploration/growth/quests/skill choices,
 * battles the player is not part of, and every rng state (set to 0).
 */
export function playerView(state: GameState, player: PlayerId): PlayerView {
  const me = state.players.find((p) => p.id === player);
  if (!me) throw new Error(`unknown player ${player}`);
  const copy = JSON.parse(JSON.stringify(state)) as GameState;
  const ex = me.explored;

  copy.rngState = 0;

  copy.players = copy.players.map((p) =>
    p.id === player
      ? p
      : {
          ...p,
          gold: 0,
          explored: "0".repeat(state.cols * state.rows),
          growth: {},
          quests: {},
          levelChoices: [],
        },
  );

  const heroes: Record<string, Hero> = {};
  for (const [id, h] of Object.entries(copy.heroes)) {
    if (h.owner === player) {
      heroes[id] = h;
      continue;
    }
    if (!h.alive || !explored(state, ex, h.x, h.y)) continue;
    heroes[id] = { ...h, mp: 0, exp: 0, bag: [], army: hideCounts(h.army) ?? [] };
  }
  copy.heroes = heroes;

  const objects: MapObject[] = [];
  for (const o of copy.objects) {
    const mine = o.owner === player;
    if (!mine && !explored(state, ex, o.x, o.y)) continue;
    if (mine) {
      objects.push(o);
      continue;
    }
    const v: MapObject = { ...o };
    if (o.army) v.army = hideCounts(o.army);
    if (o.garrison) v.garrison = hideCounts(o.garrison);
    objects.push(v);
  }
  copy.objects = objects;

  copy.battles = copy.battles
    .filter((b) => b.sides[0] === player || b.sides[1] === player)
    .map((b) => ({ ...b, battle: { ...b.battle, rngState: 0 } }));

  return { you: player, state: copy };
}
