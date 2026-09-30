import type { GameState, Hero, MapObject, PlayerId, PlayerState, Point } from "./types";
import { isPassable } from "./maps";
import { CASTLE_INCOME, MINE_INCOME } from "./data/rules";

/** Reveal radii (in tiles, Euclidean + 0.5 as in the prototype). */
export const REVEAL_HERO = 4;
export const REVEAL_CASTLE = 3;
export const REVEAL_MINE = 2;

// ================= lookups =================

/** Terrain passability on the adventure map (bounds-checked). */
export function terrainOk(state: GameState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.cols && y < state.rows && isPassable(state.terrain, x, y);
}

export function getPlayer(state: GameState, playerId: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}

/** First non-gone object on the tile. */
export function objectAt(state: GameState, x: number, y: number): MapObject | undefined {
  return state.objects.find((o) => !o.gone && o.x === x && o.y === y);
}

/** Alive hero standing on the tile. */
export function heroAt(state: GameState, x: number, y: number): Hero | undefined {
  return Object.values(state.heroes).find((h) => h.alive && h.x === x && h.y === y);
}

/** Monster that guards (x, y): a live monster on the tile or any of its 8 neighbours. */
export function guardOf(state: GameState, x: number, y: number): MapObject | undefined {
  return state.objects.find(
    (o) => o.kind === "monster" && !o.gone && Math.abs(o.x - x) <= 1 && Math.abs(o.y - y) <= 1,
  );
}

/**
 * A tile where movement of `hero` must stop: another alive hero, a guarded tile,
 * or any object except the hero owner's own castle.
 */
export function isStopper(state: GameState, hero: Hero, x: number, y: number): boolean {
  for (const h of Object.values(state.heroes)) {
    if (h.id !== hero.id && h.alive && h.x === x && h.y === y) return true;
  }
  if (guardOf(state, x, y)) return true;
  const o = objectAt(state, x, y);
  if (o && !(o.kind === "castle" && o.owner === hero.owner)) return true;
  return false;
}

// ================= pathfinding =================

/**
 * 8-directional BFS from the hero to `to` (port of the prototype's findPath).
 * Stopper tiles (except the start) only expand into the target, so a path can end on a
 * monster by stepping onto its guarded neighbour last. Returns the steps excluding the
 * start tile; empty when unreachable or when `to` is the hero's own tile.
 */
export function findPath(state: GameState, heroId: string, to: Point): Point[] {
  const hero = state.heroes[heroId];
  if (!hero || !hero.alive) return [];
  const { cols } = state;
  const tx = to.x;
  const ty = to.y;
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return [];
  if (tx === hero.x && ty === hero.y) return [];
  if (!terrainOk(state, tx, ty)) return [];

  const key = (x: number, y: number): number => y * cols + x;
  const startKey = key(hero.x, hero.y);
  const targetKey = key(tx, ty);
  const prev: number[] = new Array<number>(state.cols * state.rows).fill(-2);
  prev[startKey] = -1;
  const queue: number[] = [startKey];

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as number;
    if (cur === targetKey) break;
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    const stuck = cur !== startKey && isStopper(state, hero, cx, cy);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!terrainOk(state, nx, ny)) continue;
        const k = key(nx, ny);
        if (stuck && k !== targetKey) continue;
        if (prev[k] !== -2) continue;
        prev[k] = cur;
        queue.push(k);
      }
    }
  }

  if (prev[targetKey] === -2) return [];
  const out: Point[] = [];
  let cur = targetKey;
  while (cur !== startKey) {
    out.unshift({ x: cur % cols, y: Math.floor(cur / cols) });
    cur = prev[cur] as number;
  }
  return out;
}

// ================= exploration (fog of war) =================

export function emptyExplored(cols: number, rows: number): string {
  return "0".repeat(cols * rows);
}

export function isExplored(state: GameState, playerId: PlayerId, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return false;
  const p = getPlayer(state, playerId);
  return !!p && p.explored[y * state.cols + x] === "1";
}

/** Returns a copy of `explored` with a disc of radius `r` around (cx, cy) set to "1". */
export function revealDisc(explored: string, cols: number, rows: number, cx: number, cy: number, r: number): string {
  const cells = explored.length === cols * rows ? explored.split("") : emptyExplored(cols, rows).split("");
  const lim = r + 0.5;
  for (let y = Math.max(0, Math.floor(cy - lim)); y <= Math.min(rows - 1, Math.ceil(cy + lim)); y++) {
    for (let x = Math.max(0, Math.floor(cx - lim)); x <= Math.min(cols - 1, Math.ceil(cx + lim)); x++) {
      if (Math.hypot(x - cx, y - cy) <= lim) cells[y * cols + x] = "1";
    }
  }
  return cells.join("");
}

/** Points the player currently sees from: own alive hero (4), own castles (3), own mines (2). */
export function revealSources(state: GameState, playerId: PlayerId): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const p = getPlayer(state, playerId);
  if (!p) return pts;
  const hero = state.heroes[p.heroId];
  if (hero && hero.alive) pts.push([hero.x, hero.y, REVEAL_HERO]);
  for (const o of state.objects) {
    if (o.gone || o.owner !== playerId) continue;
    if (o.kind === "castle") pts.push([o.x, o.y, REVEAL_CASTLE]);
    else if (o.kind === "mine") pts.push([o.x, o.y, REVEAL_MINE]);
  }
  return pts;
}

/** Updates the player's explored string in place (explored tiles never become fogged again). */
export function reveal(state: GameState, playerId: PlayerId): void {
  const p = getPlayer(state, playerId);
  if (!p) return;
  let ex = p.explored;
  for (const [x, y, r] of revealSources(state, playerId)) ex = revealDisc(ex, state.cols, state.rows, x, y, r);
  p.explored = ex;
}

/** Reveals for every player. */
export function revealAll(state: GameState): void {
  for (const p of state.players) reveal(state, p.id);
}

// ================= economy =================

/** Castles the player owns. */
export function ownedCastles(state: GameState, playerId: PlayerId): MapObject[] {
  return state.objects.filter((o) => o.kind === "castle" && !o.gone && o.owner === playerId);
}

/** Daily income: 1000 per owned castle + 500 per owned mine. */
export function income(state: GameState, playerId: PlayerId): number {
  let g = 0;
  for (const o of state.objects) {
    if (o.gone || o.owner !== playerId) continue;
    if (o.kind === "castle") g += CASTLE_INCOME;
    else if (o.kind === "mine") g += MINE_INCOME;
  }
  return g;
}
