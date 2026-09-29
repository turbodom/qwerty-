import { describe, expect, it } from "vitest";
import { PiApiError, PiClient } from "../src/pi";
import { FakePi, PI_KEY } from "./helpers";

function client(fake: FakePi, apiKey: string | null = PI_KEY): PiClient {
  return new PiClient({ apiBase: "https://pi.test/", apiKey, fetch: fake.fetch, timeoutMs: 200 });
}

describe("PiClient", () => {
  it("me() sends the access token as Bearer and returns the user", async () => {
    const fake = new FakePi();
    fake.addUser("tok", "uid-1", "alice");
    await expect(client(fake).me("tok")).resolves.toEqual({ uid: "uid-1", username: "alice" });
    expect(fake.calls[0]).toMatchObject({ method: "GET", path: "/v2/me", authorization: "Bearer tok" });
  });

  it("me() maps 401 to an unauthorized error", async () => {
    const fake = new FakePi();
    const err = await client(fake).me("bad").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PiApiError);
    expect((err as PiApiError).kind).toBe("unauthorized");
    expect((err as PiApiError).status).toBe(401);
  });

  it("payment calls use the server key and parse the PaymentDTO", async () => {
    const fake = new FakePi();
    fake.addPayment({ identifier: "pay1", user_uid: "uid-1", amount: 0.5, itemId: "banner_gold" });
    const pi = client(fake);
    const p = await pi.getPayment("pay1");
    expect(p).toMatchObject({ identifier: "pay1", user_uid: "uid-1", amount: 0.5, metadata: { itemId: "banner_gold" }, transaction: null });
    expect(p.status.developer_approved).toBe(false);
    await pi.approvePayment("pay1");
    fake.pay("pay1", "tx1");
    const done = await pi.completePayment("pay1", "tx1");
    expect(done.status.developer_completed).toBe(true);
    expect(done.transaction).toEqual({ txid: "tx1", verified: true });
    expect(fake.calls.map((c) => [c.method, c.path, c.authorization])).toEqual([
      ["GET", "/v2/payments/pay1", `Key ${PI_KEY}`],
      ["POST", "/v2/payments/pay1/approve", `Key ${PI_KEY}`],
      ["POST", "/v2/payments/pay1/complete", `Key ${PI_KEY}`],
    ]);
    expect(fake.calls[2]?.body).toEqual({ txid: "tx1" });
  });

  it("reports not_found, not_configured, network and timeout errors clearly", async () => {
    const fake = new FakePi();
    await expect(client(fake).getPayment("nope")).rejects.toMatchObject({ kind: "not_found", status: 404 });
    await expect(client(fake, null).getPayment("x")).rejects.toMatchObject({ kind: "not_configured" });
    fake.down = true;
    await expect(client(fake).getPayment("x")).rejects.toMatchObject({ kind: "network" });
    const slow = new PiClient({
      apiBase: "https://pi.test",
      apiKey: PI_KEY,
      timeoutMs: 50,
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });
    const err = await slow.getPayment("x").catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "timeout" });
    expect(String((err as Error).message)).toMatch(/timed out/);
  });

  it("rejects unexpected response bodies", async () => {
    const pi = new PiClient({
      apiBase: "https://pi.test",
      apiKey: PI_KEY,
      fetch: async () => new Response(JSON.stringify({ hello: "world" }), { status: 200 }),
    });
    await expect(pi.getPayment("x")).rejects.toMatchObject({ kind: "bad_response" });
    await expect(pi.me("t")).rejects.toMatchObject({ kind: "bad_response" });
  });
});
