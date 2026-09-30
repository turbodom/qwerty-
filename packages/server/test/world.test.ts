import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorld } from "@korony/shared";
import type { WorldState } from "@korony/shared";
import { loadConfig } from "../src/config";
import { FileSnapshots, UpstashSnapshots, WorldService } from "../src/world";
import type { WorldSnapshots } from "../src/world";
import { TEST_SECRET, startTestApp } from "./helpers";
import type { TestApp } from "./helpers";

let app: TestApp | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await app?.close();
  app = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function guest(a: TestApp, name: string): Promise<string> {
  const res = await a.req("POST", "/api/auth/guest", { body: { username: name } });
  return res.body.token as string;
}

class MemorySnapshots implements WorldSnapshots {
  readonly kind = "test";
  saved: WorldState | null = null;
  saves = 0;
  async load(): Promise<WorldState | null> {
    return this.saved ? structuredClone(this.saved) : null;
  }
  async save(state: WorldState): Promise<void> {
    this.saved = structuredClone(state);
    this.saves++;
  }
}

describe("/api/world", () => {
  it("needs a session", async () => {
    app = await startTestApp();
    expect((await app.req("GET", "/api/world")).status).toBe(401);
    expect((await app.req("POST", "/api/world/action", { body: { action: { type: "hire" } } })).status).toBe(401);
  });

  it("shows the world, lets a guest join, attack and found a clan", async () => {
    app = await startTestApp();
    const token = await guest(app, "Разведчик");
    const first = await app.req("GET", "/api/world", { token });
    expect(first.status).toBe(200);
    expect(first.body.me).toBeNull();
    expect(first.body.sectors).toHaveLength(81);

    const joined = await app.req("POST", "/api/world/action", { token, body: { action: { type: "join", faction: "castle" } } });
    expect(joined.status).toBe(200);
    expect(joined.body.result.ok).toBe(true);
    expect(joined.body.view.me.name).toBe("Разведчик");

    const target = (joined.body.view.sectors as { id: number; reachable: boolean }[]).find((s) => s.reachable);
    const attack = await app.req("POST", "/api/world/action", { token, body: { action: { type: "attack", sector: target?.id } } });
    expect(attack.body.result.ok).toBe(true);
    expect(attack.body.result.report.sector).toBe(target?.id);
    expect(attack.body.view.me.energy).toBe(joined.body.view.me.energy - 1);

    const clan = await app.req("POST", "/api/world/action", { token, body: { action: { type: "createClan", name: "Стражи", tag: "STR" } } });
    expect(clan.body.result.ok).toBe(true);
    expect(clan.body.view.clans.some((c: { tag: string }) => c.tag === "STR")).toBe(true);
  });

  it("reports rule violations in the result and rejects malformed actions", async () => {
    app = await startTestApp();
    const token = await guest(app, "Новичок");
    const res = await app.req("POST", "/api/world/action", { token, body: { action: { type: "hire" } } });
    expect(res.status).toBe(200);
    expect(res.body.result.ok).toBe(false);
    expect(typeof res.body.result.error).toBe("string");
    expect((await app.req("POST", "/api/world/action", { token, body: { action: { type: "nuke" } } })).status).toBe(400);
    expect((await app.req("POST", "/api/world/action", { token, body: { action: { type: "attack", sector: -1 } } })).status).toBe(400);
    expect((await app.req("POST", "/api/world/action", { token, body: { action: { type: "join", faction: "neutral" } } })).status).toBe(400);
  });

  it("advances world days with the clock", async () => {
    let t = 1_000_000;
    const world = new WorldService({ now: () => t, dayMs: 60_000, seasonDays: 28 });
    app = await startTestApp({ now: () => t, deps: { world } });
    const token = await guest(app, "Путник");
    expect((await app.req("GET", "/api/world", { token })).body.day).toBe(1);
    t += 3 * 60_000;
    expect((await app.req("GET", "/api/world", { token })).body.day).toBe(4);
  });
});

describe("world snapshots", () => {
  it("saves after a change and loads it back on start", async () => {
    const snaps = new MemorySnapshots();
    const session = { uid: "guest:a", username: "Аня" };
    const a = new WorldService({ now: () => 0, dayMs: 60_000, seasonDays: 28, snapshots: snaps, saveDelayMs: 10_000 });
    await a.act(session, { type: "join", faction: "necropolis" });
    expect(snaps.saves).toBe(0);
    await a.flush();
    expect(snaps.saves).toBe(1);
    await a.flush();
    expect(snaps.saves).toBe(1);
    const b = new WorldService({ now: () => 0, dayMs: 60_000, seasonDays: 28, snapshots: snaps });
    expect((await b.view(session)).me?.faction).toBe("necropolis");
  });

  it("keeps the world in a JSON file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "korony-world-"));
    dirs.push(dir);
    const file = new FileSnapshots(join(dir, "world.json"));
    expect(await file.load()).toBeNull();
    const w = createWorld({ seed: 3, now: 0 });
    await file.save(w);
    expect(await file.load()).toEqual(w);
  });

  it("talks to Upstash with GET /get and POST /set", async () => {
    const calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
    let stored: string | null = null;
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      calls.push({ url, method, auth: new Headers(init?.headers).get("authorization"), body: init?.body ?? null });
      if (url.includes("/set/")) stored = String(init?.body);
      const result = url.includes("/get/") ? stored : "OK";
      return new Response(JSON.stringify({ result }), { status: 200 });
    };
    const up = new UpstashSnapshots("https://redis.example/", "tok", "k", fakeFetch);
    expect(await up.load()).toBeNull();
    const w = createWorld({ seed: 5, now: 0 });
    await up.save(w);
    expect(await up.load()).toEqual(w);
    expect(calls[0]).toMatchObject({ url: "https://redis.example/get/k", method: "GET", auth: "Bearer tok" });
    expect(calls[1]).toMatchObject({ url: "https://redis.example/set/k", method: "POST" });
  });
});

describe("world config", () => {
  it("reads day and season length and the Upstash pair", () => {
    const c = loadConfig({
      NODE_ENV: "test", SESSION_SECRET: TEST_SECRET, WORLD_DAY_MINUTES: "30", WORLD_SEASON_DAYS: "14",
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t",
    }, () => {});
    expect(c.worldDayMinutes).toBe(30);
    expect(c.worldSeasonDays).toBe(14);
    expect(c.upstashUrl).toBe("https://x.upstash.io");
    expect(() => loadConfig({ NODE_ENV: "test", SESSION_SECRET: TEST_SECRET, UPSTASH_REDIS_REST_URL: "https://x.upstash.io" }, () => {})).toThrow();
    const d = loadConfig({ NODE_ENV: "test", SESSION_SECRET: TEST_SECRET }, () => {});
    expect(d.worldDayMinutes).toBe(1440);
    expect(d.worldSeasonDays).toBe(28);
    expect(d.worldFile).toBeNull();
  });
});
