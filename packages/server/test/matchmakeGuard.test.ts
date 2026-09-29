import { createServer, request } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ROOM_NAME } from "@korony/shared";
import { MATCHMAKE_BODY_LIMIT, createMatchmakeGuard } from "../src/matchmakeGuard";
import type { MatchmakeGuardOptions } from "../src/matchmakeGuard";
import { startServer } from "../src/server";
import type { RunningServer } from "../src/server";
import { testConfig } from "./helpers";

/** Stand-in for Colyseus' handleMatchMakeRequest: buffers the whole body, answers on `end`. */
class BufferingHandler {
  calls = 0;
  buffered = 0;
  readonly handle = (req: IncomingMessage, res: ServerResponse): void => {
    this.calls++;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      chunks.push(c);
      this.buffered += c.length;
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ bytes: Buffer.concat(chunks).length }));
    });
  };
}

interface Reply {
  status: number | null;
  body: string;
  /** The server closed the connection before a response arrived. */
  reset: boolean;
}

/** Streams `total` bytes in 4 KB chunks (chunked encoding unless contentLength is given), stopping when the server answers or hangs up. */
function upload(port: number, path: string, total: number, contentLength?: number): Promise<Reply> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: Reply): void => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (contentLength !== undefined) headers["content-length"] = String(contentLength);
    const req = request({ host: "127.0.0.1", port, path, method: "POST", headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => finish({ status: res.statusCode ?? null, body, reset: false }));
      res.on("error", () => finish({ status: res.statusCode ?? null, body, reset: false }));
    });
    req.on("error", () => finish({ status: null, body: "", reset: true }));
    let sent = 0;
    const chunk = Buffer.alloc(4096, 0x20);
    const pump = (): void => {
      while (!done && sent < total) {
        const n = Math.min(chunk.length, total - sent);
        sent += n;
        if (!req.write(chunk.subarray(0, n))) {
          req.once("drain", pump);
          return;
        }
      }
      if (!done && sent >= total && !req.writableEnded) req.end();
    };
    pump();
  });
}

let server: Server | null = null;
let running: RunningServer | null = null;

afterEach(async () => {
  if (server) {
    const s = server;
    await new Promise<void>((resolve) => {
      s.close(() => resolve());
      s.closeAllConnections();
    });
    server = null;
  }
  await running?.close();
  running = null;
});

async function guarded(opts: Partial<MatchmakeGuardOptions> = {}): Promise<{ port: number; inner: BufferingHandler }> {
  const inner = new BufferingHandler();
  const guard = createMatchmakeGuard(inner.handle, { trustProxy: false, ...opts });
  server = createServer((req, res) => void guard(req, res));
  const s = server;
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  return { port: (s.address() as AddressInfo).port, inner };
}

describe("matchmaking guard", () => {
  it("passes small bodies through untouched", async () => {
    const { port, inner } = await guarded();
    const r = await upload(port, "/matchmake/joinOrCreate/x", 300);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ bytes: 300 });
    expect(inner.calls).toBe(1);
  });

  it("refuses a declared Content-Length over the limit without reading the body", async () => {
    const { port, inner } = await guarded();
    const r = await upload(port, "/matchmake/joinOrCreate/x", 1024, 50_000_000);
    if (!r.reset) {
      expect(r.status).toBe(413);
      expect(JSON.parse(r.body)).toMatchObject({ code: "too_large" });
    }
    expect(inner.calls).toBe(0);
  });

  it("cuts off a streamed body once it passes the limit", async () => {
    const { port, inner } = await guarded();
    const r = await upload(port, "/matchmake/joinOrCreate/x", 20_000_000);
    if (!r.reset) expect(r.status).toBe(413);
    expect(inner.calls).toBe(1);
    // the inner handler buffered at most the limit plus the one chunk that crossed it
    expect(inner.buffered).toBeLessThanOrEqual(MATCHMAKE_BODY_LIMIT + 64 * 1024);
  });

  it("rate-limits per client IP", async () => {
    const { port, inner } = await guarded({ rateLimit: { windowMs: 60_000, max: 2 } });
    expect((await upload(port, "/matchmake/joinOrCreate/x", 10)).status).toBe(200);
    expect((await upload(port, "/matchmake/joinOrCreate/x", 10)).status).toBe(200);
    const third = await upload(port, "/matchmake/joinOrCreate/x", 10);
    expect(third.status).toBe(429);
    expect(JSON.parse(third.body)).toMatchObject({ code: "rate_limited" });
    expect(inner.calls).toBe(2);
  });
});

describe("startServer matchmaking routes", () => {
  it("apply the body limit and the rate limit before Colyseus", async () => {
    running = await startServer({
      config: testConfig(),
      port: 0,
      host: "127.0.0.1",
      clientDist: null,
      rateLimits: { matchmake: { windowMs: 60_000, max: 3 } },
    });
    const path = `/matchmake/joinOrCreate/${ROOM_NAME}`;
    const big = await upload(running.port, path, 5_000_000);
    if (!big.reset) expect(big.status).toBe(413);
    // a small body still reaches Colyseus (which refuses the missing session)
    const small = await upload(running.port, path, 2);
    expect(small.status).toBe(200);
    expect(small.body).toContain("error");
    await upload(running.port, path, 2);
    expect((await upload(running.port, path, 2)).status).toBe(429);
  });
});
