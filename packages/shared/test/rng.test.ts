import { describe, expect, it } from "vitest";
import { createRng } from "../src";

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it("differs for different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    const sa = Array.from({ length: 5 }, () => a.next());
    const sb = Array.from({ length: 5 }, () => b.next());
    expect(sa).not.toEqual(sb);
  });

  it("round-trips through persisted state", () => {
    const a = createRng(987654321);
    for (let i = 0; i < 17; i++) a.next();
    const saved = JSON.parse(JSON.stringify({ rngState: a.state })) as { rngState: number };
    const b = createRng(saved.rngState);
    for (let i = 0; i < 50; i++) expect(b.next()).toBe(a.next());
    expect(b.state).toBe(a.state);
  });

  it("keeps state as uint32", () => {
    const r = createRng(-1);
    for (let i = 0; i < 20; i++) {
      r.next();
      expect(Number.isInteger(r.state)).toBe(true);
      expect(r.state).toBeGreaterThanOrEqual(0);
      expect(r.state).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("next stays in [0,1) and int is inclusive", () => {
    const r = createRng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.int(3, 3)).toBe(3);
  });

  it("pick returns array elements and throws on empty", () => {
    const r = createRng(7);
    const arr = ["a", "b", "c"] as const;
    for (let i = 0; i < 50; i++) expect(arr).toContain(r.pick(arr));
    expect(() => r.pick([])).toThrow();
  });
});
