/** Deterministic pseudo-random generator (mulberry32). State is a plain uint32 so it can live in JSON state. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** Uniformly picks an element; throws on an empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Current internal uint32 state; persist it back to GameState.rngState / Battle.rngState. */
  readonly state: number;
}

export function createRng(state: number): Rng {
  let s = state >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min: number, max: number): number {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error("pick from empty array");
      return arr[Math.floor(next() * arr.length)] as T;
    },
    get state(): number {
      return s;
    },
  };
}
