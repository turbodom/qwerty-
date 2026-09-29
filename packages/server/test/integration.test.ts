import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "colyseus.js";
import type { Room } from "colyseus.js";
import { ROOM_NAME } from "@korony/shared";
import type { PlayerView, ServerMessage } from "@korony/shared";
import { startServer } from "../src/server";
import type { RunningServer } from "../src/server";
import { testConfig } from "./helpers";

/** Real HTTP + Colyseus server on a free port, driven by two colyseus.js clients. */

const DAY_SECONDS = 3;

let server: RunningServer;
let base: string;

beforeAll(async () => {
  const config = { ...testConfig({ RECONNECT_SECONDS: "10" }), daySeconds: DAY_SECONDS };
  server = await startServer({ config, port: 0, host: "127.0.0.1", clientDist: null });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server?.close();
});

async function guestToken(username: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

class Inbox {
  readonly messages: ServerMessage[] = [];
  constructor(room: Room) {
    this.listen(room);
  }
  listen(room: Room): void {
    room.onMessage("*", (_type: string | number, message: ServerMessage) => {
      this.messages.push(message);
    });
  }
  views(): Extract<ServerMessage, { t: "view" }>[] {
    return this.messages.filter((m): m is Extract<ServerMessage, { t: "view" }> => m.t === "view");
  }
  lastView(): PlayerView | undefined {
    return this.views().at(-1)?.view;
  }
  async waitFor<T>(pick: (inbox: Inbox) => T | undefined | false, timeoutMs = 5000): Promise<T> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const v = pick(this);
      if (v !== undefined && v !== false) return v;
      if (Date.now() > until) throw new Error(`timed out; got ${JSON.stringify(this.messages.map((m) => m.t))}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

describe("match room over real sockets", () => {
  it("serves the API and restricts matchmaking CORS to the client origin", async () => {
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    const preflight = (origin: string) =>
      fetch(`${base}/matchmake/joinOrCreate/${ROOM_NAME}`, {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST" },
      });
    const ok = await preflight("http://localhost:5173");
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    const evil = await preflight("https://evil.example");
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects a join without a valid session", async () => {
    const client = new Client(base);
    await expect(client.joinOrCreate(ROOM_NAME, { token: "not-a-token", mode: "pvp" })).rejects.toThrow();
    await expect(client.joinOrCreate(ROOM_NAME, { mode: "pvp" })).rejects.toThrow();
  });

  it("plays a match: views, day advance, reconnection, timer and forfeit", async () => {
    const [ta, tb, tc] = await Promise.all([guestToken("alice"), guestToken("bob"), guestToken("carol")]);
    const ca = new Client(base);
    const cb = new Client(base);
    const cc = new Client(base);

    const roomA = await ca.joinOrCreate(ROOM_NAME, { token: ta, mode: "pvp" });
    const inboxA = new Inbox(roomA);
    // a friend-code player never lands in the public room
    const roomC = await cc.joinOrCreate(ROOM_NAME, { token: tc, mode: "pvp", code: "FRIENDS" });
    expect(roomC.roomId).not.toBe(roomA.roomId);
    const roomB = await cb.joinOrCreate(ROOM_NAME, { token: tb, mode: "pvp" });
    const inboxB = new Inbox(roomB);
    expect(roomB.roomId).toBe(roomA.roomId);

    // both get their own view and the day timer
    const va = await inboxA.waitFor((i) => i.lastView());
    const vb = await inboxB.waitFor((i) => i.lastView());
    expect(va.you).toBe("p0");
    expect(vb.you).toBe("p1");
    expect(va.state.day).toBe(1);
    expect(va.state.players.map((p) => p.name)).toEqual(["alice", "bob"]);
    const timer = await inboxA.waitFor((i) => i.messages.find((m) => m.t === "timer"));
    expect(timer.t === "timer" && timer.endsAt).toBeGreaterThan(Date.now());

    // both end the day: the day advances for both, and each sender gets its ack
    roomA.send("action", { t: "action", action: { type: "endDay" }, seq: 1 });
    roomB.send("action", { t: "action", action: { type: "endDay" }, seq: 1 });
    await inboxA.waitFor((i) => i.lastView()?.state.day === 2);
    await inboxB.waitFor((i) => i.lastView()?.state.day === 2);
    expect(inboxA.views().some((m) => m.ackSeq === 1)).toBe(true);
    expect(inboxB.views().some((m) => m.ackSeq === 1)).toBe(true);
    expect(inboxA.views().some((m) => m.events.some((e) => e.type === "newDay" && e.day === 2))).toBe(true);

    // invalid messages get an error with the seq
    roomA.send("action", { t: "action", action: { type: "teleport" }, seq: 5 });
    const err = await inboxA.waitFor((i) => i.messages.find((m) => m.t === "error" && m.ackSeq === 5));
    expect(err.t).toBe("error");

    // bob's connection drops and comes back
    const token = roomB.reconnectionToken;
    roomB.connection.close();
    await inboxA.waitFor((i) =>
      i.views().some((m) => m.events.some((e) => e.type === "toast" && e.text.includes("отключился"))));
    const roomB2 = await cb.reconnect(token);
    const inboxB2 = new Inbox(roomB2);
    const back = await inboxB2.waitFor((i) => i.lastView());
    expect(back.you).toBe("p1");
    expect(back.state.day).toBe(2);
    await inboxA.waitFor((i) => i.views().some((m) => m.events.some((e) => e.type === "toast" && e.text.includes("вернулся"))));

    // nobody acts: the day timer ends day 2
    await inboxA.waitFor((i) => i.lastView()?.state.day === 3, DAY_SECONDS * 1000 + 3000);
    await inboxB2.waitFor((i) => i.lastView()?.state.day === 3, 3000);

    // bob leaves for good: alice wins
    await roomB2.leave(true);
    const final = await inboxA.waitFor((i) => {
      const v = i.lastView();
      return v?.state.winner ? v : undefined;
    });
    expect(final.state.winner).toBe("p0");
    expect(inboxA.views().some((m) => m.events.some((e) => e.type === "victory" && e.player === "p0"))).toBe(true);
    // and the room closes by itself with a normal closure (no reconnection attempt)
    const closeCode = await new Promise<number | null>((resolve) => {
      const t = setTimeout(() => resolve(null), 5000);
      roomA.onLeave((code: number) => {
        clearTimeout(t);
        resolve(code);
      });
    });
    expect(closeCode).toBe(1000);

    await roomC.leave(true);
  }, 30_000);
});
