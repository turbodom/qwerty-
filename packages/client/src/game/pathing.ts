import { findPath, guardOf, heroAt, isStopper, objectAt, terrainOk } from "@korony/shared";
import type { GameState, Hero, Point } from "@korony/shared";

/**
 * A planned hero move. The engine walks `findPath`, whose BFS may step through a guarded (or otherwise
 * stopping) tile right before the target even when an equally short free route exists; the hero then stops
 * there and, for a guard, a battle starts. The planner prefers a route without such stops (`detour`) and
 * otherwise reports where the engine's route would stop (`stopAt`).
 */
export interface MovePlan {
  path: Point[];
  /** `path` is not the engine's route: it has to be walked in legs the engine follows exactly. */
  detour: boolean;
  /** Index in `path` of the first step before the target where the hero would stop, or -1. */
  stopAt: number;
}

/**
 * Index of the first tile before the last step of `path` where the hero would stop unexpectedly, or -1.
 * Entering the zone of the very monster that guards the target is expected (that fight is the target's).
 */
export function firstStop(state: GameState, hero: Hero, path: readonly Point[]): number {
  const last = path[path.length - 1];
  const targetGuard = last ? guardOf(state, last.x, last.y) : undefined;
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i] as Point;
    if (!isStopper(state, hero, p.x, p.y)) continue;
    const g = guardOf(state, p.x, p.y);
    const onlyTargetGuard = !!g && g === targetGuard && !objectAt(state, p.x, p.y) && !heroAt(state, p.x, p.y);
    if (!onlyTargetGuard) return i;
  }
  return -1;
}

/** Shortest 8-directional route to `to` that enters no stopping tile except the target itself; [] if none. */
export function freePath(state: GameState, hero: Hero, to: Point): Point[] {
  const { cols, rows } = state;
  if (to.x === hero.x && to.y === hero.y) return [];
  if (!terrainOk(state, to.x, to.y)) return [];
  const key = (x: number, y: number): number => y * cols + x;
  const start = key(hero.x, hero.y);
  const target = key(to.x, to.y);
  const prev = new Array<number>(cols * rows).fill(-2);
  prev[start] = -1;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as number;
    if (cur === target) break;
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!terrainOk(state, nx, ny)) continue;
        const k = key(nx, ny);
        if (prev[k] !== -2) continue;
        if (k !== target && isStopper(state, hero, nx, ny)) continue;
        prev[k] = cur;
        queue.push(k);
      }
    }
  }
  if (prev[target] === -2) return [];
  const out: Point[] = [];
  for (let cur = target; cur !== start; cur = prev[cur] as number) out.unshift({ x: cur % cols, y: Math.floor(cur / cols) });
  return out;
}

export function planMove(state: GameState, hero: Hero, to: Point): MovePlan {
  const direct = findPath(state, hero.id, to);
  if (direct.length === 0) return { path: [], detour: false, stopAt: -1 };
  const stopAt = firstStop(state, hero, direct);
  if (stopAt < 0) return { path: direct, detour: false, stopAt: -1 };
  const free = freePath(state, hero, to);
  if (free.length > 0) return { path: free, detour: true, stopAt: -1 };
  return { path: direct, detour: false, stopAt };
}

function samePath(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length && a.every((p, i) => p.x === b[i]?.x && p.y === b[i]?.y);
}

/**
 * The next leg of a detour: the farthest step of `rest` that the engine's own route reaches exactly along
 * `rest` (at worst the first step, which is adjacent). Returns its index in `rest`.
 */
export function nextLeg(state: GameState, hero: Hero, rest: readonly Point[]): number {
  for (let i = rest.length - 1; i > 0; i--) {
    const p = rest[i] as Point;
    if (samePath(findPath(state, hero.id, p), rest.slice(0, i + 1))) return i;
  }
  return 0;
}
