import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config";
import type { Config } from "../src/config";
import { createApp } from "../src/http";
import type { AppDeps } from "../src/http";
import { PiClient } from "../src/pi";
import type { PiPayment } from "../src/pi";
import { MemoryStore } from "../src/store";

export const TEST_SECRET = "test-secret-that-is-long-enough-for-hs256-0123456789";
export const PI_KEY = "test-pi-key";

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ NODE_ENV: "test", SESSION_SECRET: TEST_SECRET, PI_API_KEY: PI_KEY, ...env }, () => {});
}

export interface PiCall {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

/** In-memory stand-in for the Pi Platform API, exposed as a `fetch` implementation. */
export class FakePi {
  readonly tokens = new Map<string, { uid: string; username: string }>();
  readonly payments = new Map<string, PiPayment>();
  readonly calls: PiCall[] = [];
  /** Makes every request fail at the network level. */
  down = false;

  addUser(token: string, uid: string, username: string): void {
    this.tokens.set(token, { uid, username });
  }

  addPayment(p: { identifier: string; user_uid: string; amount: number; itemId?: unknown; metadata?: Record<string, unknown> }): PiPayment {
    const payment: PiPayment = {
      identifier: p.identifier,
      user_uid: p.user_uid,
      amount: p.amount,
      memo: "test",
      metadata: p.metadata ?? (p.itemId === undefined ? {} : { itemId: p.itemId }),
      status: {
        developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false,
      },
      transaction: null,
    };
    this.payments.set(p.identifier, payment);
    return payment;
  }

  /** The user signs the transaction in the Pi wallet and the blockchain confirms it. */
  pay(id: string, txid: string, verified = true): void {
    const p = this.payments.get(id);
    if (!p) throw new Error(`no payment ${id}`);
    p.transaction = { txid, verified };
    p.status.transaction_verified = verified;
  }

  callsTo(suffix: string): PiCall[] {
    return this.calls.filter((c) => c.path.endsWith(suffix));
  }

  readonly fetch: typeof fetch = async (input, init) => {
    if (this.down) throw new TypeError("fetch failed");
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const authorization = headers.get("authorization");
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    this.calls.push({ method, path: url.pathname, authorization, body });
    const json = (status: number, data: unknown): Response =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

    if (url.pathname === "/v2/me" && method === "GET") {
      const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      const u = this.tokens.get(token);
      return u ? json(200, { uid: u.uid, username: u.username }) : json(401, { error: "unauthorized" });
    }
    const m = /^\/v2\/payments\/([^/]+)(?:\/(approve|complete|cancel))?$/.exec(url.pathname);
    if (!m) return json(404, { error: "not_found" });
    if (authorization !== `Key ${PI_KEY}`) return json(401, { error: "invalid_key" });
    const p = this.payments.get(decodeURIComponent(m[1] ?? ""));
    if (!p) return json(404, { error: "payment_not_found" });
    const action = m[2];
    if (!action && method === "GET") return json(200, p);
    if (method !== "POST") return json(405, { error: "method" });
    if (action === "approve") {
      if (p.status.developer_approved) return json(400, { error: "already_approved" });
      p.status.developer_approved = true;
    } else if (action === "complete") {
      const txid = (body as { txid?: unknown } | null)?.txid;
      if (!p.transaction || p.transaction.txid !== txid) return json(400, { error: "txid_mismatch" });
      if (p.status.developer_completed) return json(400, { error: "already_completed" });
      p.status.developer_completed = true;
    } else if (action === "cancel") {
      if (p.transaction) return json(400, { error: "already_paid" });
      p.status.cancelled = true;
    }
    return json(200, p);
  };
}

export interface TestApp {
  url: string;
  store: MemoryStore;
  pi: FakePi;
  config: Config;
  /** JSON request helper; returns status, body and headers. */
  req(method: string, path: string, opts?: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string }): Promise<{
    status: number;
    body: any;
    headers: Headers;
  }>;
  login(token: string, uid: string, username: string): Promise<string>;
  close(): Promise<void>;
}

/** Express app on a random port, with a MemoryStore and the FakePi behind a real PiClient. */
export async function startTestApp(opts: { env?: Record<string, string>; now?: () => number; deps?: Partial<AppDeps> } = {}): Promise<TestApp> {
  const config = testConfig(opts.env);
  const now = opts.now ?? Date.now;
  const store = new MemoryStore(now);
  const fake = new FakePi();
  const pi = new PiClient({ apiBase: "https://pi.test", apiKey: config.piApiKey, fetch: fake.fetch, timeoutMs: 1000 });
  const app = createApp({ config, store, pi, now, clientDist: null, ...opts.deps });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const req: TestApp["req"] = async (method, path, o = {}) => {
    const headers: Record<string, string> = { ...o.headers };
    if (o.token) headers["authorization"] = `Bearer ${o.token}`;
    let body: string | undefined;
    if (o.raw !== undefined) body = o.raw;
    else if (o.body !== undefined) body = JSON.stringify(o.body);
    if (body !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
    const res = await fetch(`${url}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };

  return {
    url, store, pi: fake, config, req,
    async login(token, uid, username) {
      fake.addUser(token, uid, username);
      const res = await req("POST", "/api/auth/pi", { body: { accessToken: token } });
      if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
      return (res.body as { token: string }).token;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
