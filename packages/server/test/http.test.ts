import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SHOP_ITEMS } from "@korony/shared";
import { createSessionAuth } from "../src/auth";
import { startTestApp, TEST_SECRET } from "./helpers";
import type { TestApp } from "./helpers";

let app: TestApp | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

describe("POST /api/auth/pi", () => {
  it("verifies the Pi token with /v2/me and returns a session", async () => {
    app = await startTestApp();
    app.pi.addUser("pi-token", "uid-alice", "alice");
    const res = await app.req("POST", "/api/auth/pi", { body: { accessToken: "pi-token" } });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ uid: "uid-alice", username: "alice", premiumUntil: null, banner: null, owned: [] });
    expect(app.pi.calls[0]).toMatchObject({ path: "/v2/me", authorization: "Bearer pi-token" });
    const session = await createSessionAuth(TEST_SECRET).verify(res.body.token as string);
    expect(session).toEqual({ uid: "uid-alice", username: "alice" });
    expect(await app.store.getUser("uid-alice")).toMatchObject({ username: "alice" });
  });

  it("answers 401 for a token Pi does not accept", async () => {
    app = await startTestApp();
    const res = await app.req("POST", "/api/auth/pi", { body: { accessToken: "forged" } });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("invalid_pi_token");
    expect(typeof res.body.error).toBe("string");
  });

  it("answers 502 when Pi is unreachable and 400 for a bad body", async () => {
    app = await startTestApp();
    app.pi.down = true;
    expect((await app.req("POST", "/api/auth/pi", { body: { accessToken: "x" } })).status).toBe(502);
    expect((await app.req("POST", "/api/auth/pi", { body: { token: "x" } })).status).toBe(400);
    expect((await app.req("POST", "/api/auth/pi", { body: { accessToken: "" } })).status).toBe(400);
    expect((await app.req("POST", "/api/auth/pi", { raw: "{not json" })).status).toBe(400);
  });
});

describe("POST /api/auth/guest", () => {
  it("is 404 when guest login is disabled", async () => {
    app = await startTestApp({ env: { ALLOW_GUEST_LOGIN: "false" } });
    const res = await app.req("POST", "/api/auth/guest", { body: { username: "tester" } });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("guest_login_disabled");
  });

  it("is on by default and logs in by name; the token works for /api/me", async () => {
    app = await startTestApp();
    const res = await app.req("POST", "/api/auth/guest", { body: { username: "Тестер" } });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: "Тестер", owned: [] });
    expect(String(res.body.user.uid)).toMatch(/^guest:/);
    const me = await app.req("GET", "/api/me", { token: res.body.token as string });
    expect(me.status).toBe(200);
    expect(me.body).toEqual(res.body.user);
    expect((await app.req("POST", "/api/auth/guest", { body: { username: "x" } })).status).toBe(400);
    expect((await app.req("POST", "/api/auth/guest", { body: { username: "<script>" } })).status).toBe(400);
  });

  it("gives every login its own account, so a name cannot be used to take over another guest", async () => {
    app = await startTestApp();
    const a = await app.req("POST", "/api/auth/guest", { body: { username: "Тестер" } });
    const b = await app.req("POST", "/api/auth/guest", { body: { username: "Тестер" } });
    expect(a.body.user.uid).not.toBe(b.body.user.uid);
  });

  it("keeps guests away from Pi payments", async () => {
    app = await startTestApp({ env: { PI_API_KEY: "key" } });
    const { token } = (await app.req("POST", "/api/auth/guest", { body: { username: "Тестер" } })).body as { token: string };
    const approve = await app.req("POST", "/api/payments/approve", { token, body: { paymentId: "p1" } });
    expect(approve.status).toBe(403);
    expect(approve.body.code).toBe("pi_login_required");
    expect((await app.req("POST", "/api/payments/complete", { token, body: { paymentId: "p1", txid: "t" } })).status).toBe(403);
    expect((await app.req("POST", "/api/payments/incomplete", { token, body: { payment: { identifier: "p1" } } })).status).toBe(403);
  });
});

describe("session-protected routes", () => {
  it("reject missing, malformed and foreign tokens", async () => {
    app = await startTestApp();
    expect((await app.req("GET", "/api/me")).status).toBe(401);
    expect((await app.req("GET", "/api/me", { token: "abc.def.ghi" })).status).toBe(401);
    const foreign = await createSessionAuth("another-secret-that-is-long-enough-123456").sign({ uid: "u", username: "u" });
    expect((await app.req("GET", "/api/me", { token: foreign })).status).toBe(401);
    expect((await app.req("GET", "/api/loadout")).status).toBe(401);
    expect((await app.req("POST", "/api/payments/approve", { body: { paymentId: "p" } })).status).toBe(401);
  });

  it("rejects an expired session", async () => {
    app = await startTestApp();
    const expired = await createSessionAuth(TEST_SECRET, -10).sign({ uid: "u", username: "u" });
    expect((await app.req("GET", "/api/me", { token: expired })).status).toBe(401);
  });
});

describe("GET /api/shop, /api/loadout, /api/health", () => {
  it("serves the catalog", async () => {
    app = await startTestApp();
    const res = await app.req("GET", "/api/shop");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SHOP_ITEMS);
  });

  it("returns the loadout the purchases give", async () => {
    app = await startTestApp();
    const token = await app.login("t", "uid-1", "one");
    expect((await app.req("GET", "/api/loadout", { token })).body).toEqual({});
    await app.store.completePayment(
      { paymentId: "p1", uid: "uid-1", itemId: "loadout_sword", amount: 1, txid: "tx" },
      (u) => ({ ...u, owned: [...u.owned, "loadout_sword", "loadout_gold"], banner: "gold" }),
    );
    expect((await app.req("GET", "/api/loadout", { token })).body).toEqual({ startArtifact: "sword", startGold: 1000, banner: "gold" });
  });

  it("answers the health check and 404s unknown API paths as JSON", async () => {
    app = await startTestApp();
    const h = await app.req("GET", "/api/health");
    expect(h.status).toBe(200);
    expect(h.body.ok).toBe(true);
    expect(h.headers.get("x-content-type-options")).toBe("nosniff");
    expect(h.headers.get("cache-control")).toBe("no-store");
    const nf = await app.req("GET", "/api/nope");
    expect(nf.status).toBe(404);
    expect(nf.body.code).toBe("not_found");
  });
});

describe("hardening", () => {
  it("allows CORS only for CLIENT_ORIGIN", async () => {
    app = await startTestApp({ env: { CLIENT_ORIGIN: "https://game.example" } });
    const ok = await app.req("OPTIONS", "/api/auth/pi", {
      headers: { origin: "https://game.example", "access-control-request-method": "POST" },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://game.example");
    expect(ok.headers.get("access-control-allow-headers")).toMatch(/Authorization/);
    const bad = await app.req("GET", "/api/shop", { headers: { origin: "https://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("limits the JSON body to 16kb", async () => {
    app = await startTestApp();
    const res = await app.req("POST", "/api/auth/pi", { body: { accessToken: "x".repeat(20_000) } });
    expect(res.status).toBe(413);
  });

  it("rate-limits auth requests per IP", async () => {
    app = await startTestApp({ deps: { rateLimits: { auth: { windowMs: 60_000, max: 3 } } } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await app.req("POST", "/api/auth/pi", { body: { accessToken: "x" } })).status);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    // other routes are not limited by the auth bucket
    expect((await app.req("GET", "/api/shop")).status).toBe(200);
  });
});

describe("static client", () => {
  it("serves the built client with SPA fallback when dist exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "korony-dist-"));
    try {
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "index.html"), "<!doctype html><title>Короны</title>");
      writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
      app = await startTestApp({ deps: { clientDist: dir } });
      const root = await fetch(`${app.url}/`);
      expect(root.status).toBe(200);
      expect(await root.text()).toContain("Короны");
      const asset = await fetch(`${app.url}/assets/app.js`);
      expect(asset.headers.get("cache-control")).toMatch(/immutable/);
      const deep = await fetch(`${app.url}/lobby/room`, { headers: { accept: "text/html" } });
      expect(await deep.text()).toContain("Короны");
      expect((await app.req("GET", "/api/unknown")).status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
