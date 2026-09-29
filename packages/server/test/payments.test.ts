import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shopItem } from "@korony/shared";
import { DAY_MS, applyGrant, loadoutFor } from "../src/shop";
import { startTestApp } from "./helpers";
import type { TestApp } from "./helpers";

const NOW = Date.UTC(2026, 8, 1);

let app: TestApp;
let alice: string;
let bob: string;

beforeEach(async () => {
  app = await startTestApp({ now: () => NOW });
  alice = await app.login("tok-alice", "uid-alice", "alice");
  bob = await app.login("tok-bob", "uid-bob", "bob");
});

afterEach(async () => {
  await app.close();
});

const approve = (token: string, paymentId: string) => app.req("POST", "/api/payments/approve", { token, body: { paymentId } });
const complete = (token: string, paymentId: string, txid: string) =>
  app.req("POST", "/api/payments/complete", { token, body: { paymentId, txid } });
const incomplete = (token: string, paymentId: string) =>
  app.req("POST", "/api/payments/incomplete", { token, body: { payment: { identifier: paymentId, amount: 999, metadata: {} } } });

describe("POST /api/payments/approve", () => {
  it("approves a payment whose amount matches the catalog price", async () => {
    app.pi.addPayment({ identifier: "p1", user_uid: "uid-alice", amount: 0.5, itemId: "banner_gold" });
    const res = await approve(alice, "p1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, paymentId: "p1", status: "approved" });
    expect(app.pi.callsTo("/approve")).toHaveLength(1);
    expect(app.pi.callsTo("/approve")[0]?.authorization).toBe("Key test-pi-key");
    expect(await app.store.getPayment("p1")).toMatchObject({ uid: "uid-alice", itemId: "banner_gold", amount: 0.5, status: "approved", txid: null });
    // a repeated approve is harmless: Pi is not asked twice
    expect((await approve(alice, "p1")).status).toBe(200);
    expect(app.pi.callsTo("/approve")).toHaveLength(1);
  });

  it("rejects a wrong amount", async () => {
    app.pi.addPayment({ identifier: "p2", user_uid: "uid-alice", amount: 0.01, itemId: "premium_30" });
    const res = await approve(alice, "p2");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("amount_mismatch");
    expect(app.pi.callsTo("/approve")).toHaveLength(0);
    expect(await app.store.getPayment("p2")).toBeNull();
  });

  it("rejects an unknown or missing item", async () => {
    app.pi.addPayment({ identifier: "p3", user_uid: "uid-alice", amount: 1, itemId: "free_gold" });
    app.pi.addPayment({ identifier: "p4", user_uid: "uid-alice", amount: 1 });
    app.pi.addPayment({ identifier: "p5", user_uid: "uid-alice", amount: 1, itemId: 42 });
    for (const id of ["p3", "p4", "p5"]) {
      const res = await approve(alice, id);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("unknown_item");
    }
    expect(app.pi.callsTo("/approve")).toHaveLength(0);
  });

  it("rejects another user's payment", async () => {
    app.pi.addPayment({ identifier: "p6", user_uid: "uid-bob", amount: 0.5, itemId: "banner_gold" });
    const res = await approve(alice, "p6");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("foreign_payment");
    expect(app.pi.callsTo("/approve")).toHaveLength(0);
  });

  it("rejects unknown, cancelled, completed and already owned purchases", async () => {
    expect((await approve(alice, "missing")).status).toBe(404);
    const c = app.pi.addPayment({ identifier: "p7", user_uid: "uid-alice", amount: 0.5, itemId: "banner_gold" });
    c.status.user_cancelled = true;
    expect((await approve(alice, "p7")).body.code).toBe("payment_cancelled");

    app.pi.addPayment({ identifier: "p8", user_uid: "uid-alice", amount: 0.5, itemId: "banner_gold" });
    await approve(alice, "p8");
    app.pi.pay("p8", "tx8");
    expect((await complete(alice, "p8", "tx8")).status).toBe(200);
    const again = await approve(alice, "p8");
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("payment_completed");

    app.pi.addPayment({ identifier: "p9", user_uid: "uid-alice", amount: 0.5, itemId: "banner_gold" });
    const owned = await approve(alice, "p9");
    expect(owned.status).toBe(409);
    expect(owned.body.code).toBe("already_owned");
  });

  it("validates the body and answers 503 without a Pi key", async () => {
    expect((await app.req("POST", "/api/payments/approve", { token: alice, body: { paymentId: "../x" } })).status).toBe(400);
    expect((await app.req("POST", "/api/payments/approve", { token: alice, body: {} })).status).toBe(400);
    await app.close();
    app = await startTestApp({ env: { PI_API_KEY: "" } });
    const token = await app.login("t", "u", "n");
    const res = await app.req("POST", "/api/payments/approve", { token, body: { paymentId: "p1" } });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("payments_disabled");
  });
});

describe("POST /api/payments/complete", () => {
  it("completes, grants once and is idempotent", async () => {
    app.pi.addPayment({ identifier: "c1", user_uid: "uid-alice", amount: 0.5, itemId: "banner_gold" });
    expect((await approve(alice, "c1")).status).toBe(200);
    app.pi.pay("c1", "tx-c1");
    const res = await complete(alice, "c1", "tx-c1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "completed", granted: true });
    expect(res.body.user).toMatchObject({ banner: "gold", owned: ["banner_gold"] });
    expect(app.pi.callsTo("/complete")).toHaveLength(1);
    expect(app.pi.callsTo("/complete")[0]?.body).toEqual({ txid: "tx-c1" });

    const again = await complete(alice, "c1", "tx-c1");
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ok: true, status: "completed", granted: false });
    expect(again.body.user.owned).toEqual(["banner_gold"]);
    expect(app.pi.callsTo("/complete")).toHaveLength(1);
    expect((await app.req("GET", "/api/me", { token: alice })).body.owned).toEqual(["banner_gold"]);
  });

  it("grants once even when two completions race", async () => {
    app.pi.addPayment({ identifier: "c2", user_uid: "uid-alice", amount: 2, itemId: "premium_30" });
    await approve(alice, "c2");
    app.pi.pay("c2", "tx-c2");
    const [a, b] = await Promise.all([complete(alice, "c2", "tx-c2"), complete(alice, "c2", "tx-c2")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.granted, b.body.granted].sort()).toEqual([false, true]);
    const me = await app.req("GET", "/api/me", { token: alice });
    expect(me.body.premiumUntil).toBe(NOW + 30 * DAY_MS);
  });

  it("rejects a txid that does not match the payment", async () => {
    app.pi.addPayment({ identifier: "c3", user_uid: "uid-alice", amount: 1, itemId: "loadout_sword" });
    await approve(alice, "c3");
    app.pi.pay("c3", "real-tx");
    const res = await complete(alice, "c3", "fake-tx");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("txid_mismatch");
    expect(app.pi.callsTo("/complete")).toHaveLength(0);
    expect((await app.store.getUser("uid-alice"))?.owned).toEqual([]);
    // and after completion a different txid is still refused
    expect((await complete(alice, "c3", "real-tx")).status).toBe(200);
    expect((await complete(alice, "c3", "fake-tx")).body.code).toBe("txid_mismatch");
  });

  it("refuses unverified transactions, other users and cancelled payments", async () => {
    app.pi.addPayment({ identifier: "c4", user_uid: "uid-alice", amount: 1, itemId: "loadout_gold" });
    await approve(alice, "c4");
    app.pi.pay("c4", "tx-c4", false);
    expect((await complete(alice, "c4", "tx-c4")).body.code).toBe("tx_not_verified");
    expect((await complete(bob, "c4", "tx-c4")).status).toBe(403);

    const c5 = app.pi.addPayment({ identifier: "c5", user_uid: "uid-alice", amount: 1, itemId: "loadout_gold" });
    c5.status.cancelled = true;
    c5.transaction = { txid: "tx-c5", verified: true };
    c5.status.transaction_verified = true;
    expect((await complete(alice, "c5", "tx-c5")).body.code).toBe("payment_cancelled");
    expect((await app.store.getUser("uid-alice"))?.owned).toEqual([]);
  });

  it("rejects a payment whose amount no longer matches what was approved", async () => {
    const p = app.pi.addPayment({ identifier: "c6", user_uid: "uid-alice", amount: 1, itemId: "loadout_sword" });
    await approve(alice, "c6");
    p.amount = 0.001;
    app.pi.pay("c6", "tx-c6");
    expect((await complete(alice, "c6", "tx-c6")).body.code).toBe("amount_mismatch");
  });

  it("gives loadout purchases to the match loadout", async () => {
    for (const [id, item, amount] of [["l1", "loadout_amulet", 1.5], ["l2", "loadout_gold", 1]] as const) {
      app.pi.addPayment({ identifier: id, user_uid: "uid-alice", amount, itemId: item });
      await approve(alice, id);
      app.pi.pay(id, `tx-${id}`);
      expect((await complete(alice, id, `tx-${id}`)).status).toBe(200);
    }
    const lo = await app.req("GET", "/api/loadout", { token: alice });
    expect(lo.body).toEqual({ startArtifact: "luckAmulet", startGold: 1000 });
  });
});

describe("POST /api/payments/incomplete", () => {
  it("completes a paid and verified payment (once)", async () => {
    app.pi.addPayment({ identifier: "i1", user_uid: "uid-alice", amount: 1, itemId: "loadout_sword" });
    await approve(alice, "i1");
    app.pi.pay("i1", "tx-i1");
    const res = await incomplete(alice, "i1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "completed", granted: true });
    expect(res.body.user.owned).toEqual(["loadout_sword"]);
    expect(app.pi.callsTo("/complete")).toHaveLength(1);
    const again = await incomplete(alice, "i1");
    expect(again.body).toMatchObject({ status: "completed", granted: false });
    expect(app.pi.callsTo("/complete")).toHaveLength(1);
  });

  it("cancels a payment without a transaction", async () => {
    app.pi.addPayment({ identifier: "i2", user_uid: "uid-alice", amount: 0.5, itemId: "banner_crimson" });
    await approve(alice, "i2");
    const res = await incomplete(alice, "i2");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "cancelled" });
    expect(app.pi.callsTo("/cancel")).toHaveLength(1);
    expect(app.pi.payments.get("i2")?.status.cancelled).toBe(true);
    expect(await app.store.getPayment("i2")).toMatchObject({ status: "cancelled" });
    expect((await app.store.getUser("uid-alice"))?.owned).toEqual([]);
    // a cancelled payment can no longer be completed
    app.pi.pay("i2", "late");
    expect((await complete(alice, "i2", "late")).body.code).toBe("payment_cancelled");
  });

  it("cancels a payment whose transaction is not verified, and ignores the client's copy", async () => {
    app.pi.addPayment({ identifier: "i3", user_uid: "uid-alice", amount: 0.5, itemId: "banner_gold" });
    const res = await app.req("POST", "/api/payments/incomplete", {
      token: alice,
      body: { payment: { identifier: "i3", transaction: { txid: "forged", verified: true }, status: { transaction_verified: true } } },
    });
    expect(res.body.status).toBe("cancelled");
    expect((await app.store.getUser("uid-alice"))?.owned).toEqual([]);
  });

  it("refuses another user's payment and bad bodies", async () => {
    app.pi.addPayment({ identifier: "i4", user_uid: "uid-bob", amount: 0.5, itemId: "banner_gold" });
    expect((await incomplete(alice, "i4")).status).toBe(403);
    expect(app.pi.callsTo("/cancel")).toHaveLength(0);
    expect((await app.req("POST", "/api/payments/incomplete", { token: alice, body: { paymentId: "i4" } })).status).toBe(400);
  });
});

describe("payments completed on Pi but unknown locally (records lost on restart)", () => {
  /** A payment this server completed with Pi before its in-memory records were lost. */
  const oldPayment = (id: string, itemId: string, amount: number, paidAt: number | null) => {
    const p = app.pi.addPayment({ identifier: id, user_uid: "uid-alice", amount, itemId });
    app.pi.pay(id, `tx-${id}`);
    p.status.developer_approved = true;
    p.status.developer_completed = true;
    if (paidAt !== null) p.created_at = new Date(paidAt).toISOString();
  };

  it("does not grant premium again from now when old payments are replayed", async () => {
    // Three 30-day passes bought 31 days apart, the last one 91 days ago: all long expired.
    oldPayment("r1", "premium_30", 2, NOW - 153 * DAY_MS);
    oldPayment("r2", "premium_30", 2, NOW - 122 * DAY_MS);
    oldPayment("r3", "premium_30", 2, NOW - 91 * DAY_MS);
    for (const id of ["r1", "r2", "r3"]) {
      const res = await complete(alice, id, `tx-${id}`);
      expect(res.status).toBe(200);
      expect(res.body.user.premiumUntil).toBeNull();
    }
    oldPayment("r4", "premium_30", 2, NOW - 100 * DAY_MS);
    expect((await incomplete(alice, "r4")).body.user.premiumUntil).toBeNull();
    expect((await app.req("GET", "/api/me", { token: alice })).body.premiumUntil).toBeNull();
    expect(app.pi.callsTo("/complete")).toHaveLength(0);
  });

  it("restores a still running pass only up to its own end, in any replay order", async () => {
    oldPayment("s1", "premium_30", 2, NOW - 10 * DAY_MS);
    oldPayment("s2", "premium_30", 2, NOW - 5 * DAY_MS);
    expect((await complete(alice, "s2", "tx-s2")).body.user.premiumUntil).toBe(NOW + 25 * DAY_MS);
    // an earlier pass does not stack on top of the restored end
    expect((await incomplete(alice, "s1")).body.user.premiumUntil).toBe(NOW + 25 * DAY_MS);
  });

  it("restores permanent items, but no premium without a payment time", async () => {
    oldPayment("t1", "loadout_sword", 1, NOW - 400 * DAY_MS);
    oldPayment("t2", "premium_30", 2, null);
    expect((await complete(alice, "t1", "tx-t1")).body.user.owned).toEqual(["loadout_sword"]);
    expect((await complete(alice, "t2", "tx-t2")).body.user.premiumUntil).toBeNull();
  });

  it("still grants from now when the local approval survived (completed with Pi, not yet granted)", async () => {
    app.pi.addPayment({ identifier: "u1", user_uid: "uid-alice", amount: 2, itemId: "premium_30" });
    await approve(alice, "u1");
    app.pi.pay("u1", "tx-u1");
    const p = app.pi.payments.get("u1");
    if (p) p.status.developer_completed = true;
    const res = await complete(alice, "u1", "tx-u1");
    expect(res.body).toMatchObject({ status: "completed", granted: true });
    expect(res.body.user.premiumUntil).toBe(NOW + 30 * DAY_MS);
  });
});

describe("grants and loadouts", () => {
  const base = { uid: "u", username: "u", premiumUntil: null, banner: null, owned: [] as string[], createdAt: 0 };

  it("extends premium from its current end", () => {
    const premium = shopItem("premium_30");
    if (!premium) throw new Error("premium_30 missing");
    const once = applyGrant(base, premium, NOW);
    expect(once.premiumUntil).toBe(NOW + 30 * DAY_MS);
    expect(once.owned).toEqual([]);
    const twice = applyGrant(once, premium, NOW + DAY_MS);
    expect(twice.premiumUntil).toBe(NOW + 60 * DAY_MS);
    const lapsed = applyGrant({ ...base, premiumUntil: NOW - DAY_MS }, premium, NOW);
    expect(lapsed.premiumUntil).toBe(NOW + 30 * DAY_MS);
  });

  it("builds the loadout from owned items", () => {
    expect(loadoutFor(null)).toEqual({});
    expect(loadoutFor({ ...base, owned: ["banner_gold", "loadout_sword", "unknown"], banner: "gold" })).toEqual({
      startArtifact: "sword",
      banner: "gold",
    });
    // the most expensive start artifact wins whatever the purchase order; the owned banner is used
    expect(loadoutFor({ ...base, owned: ["loadout_amulet", "loadout_sword", "banner_crimson"] })).toEqual({
      startArtifact: "luckAmulet",
      banner: "crimson",
    });
  });
});
