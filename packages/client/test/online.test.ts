import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerView } from "@korony/shared";
import { OnlineGame, isSeatGone } from "../src/net/online";
import { STORAGE_KEYS, memoryStorage } from "../src/storage";

type Handler = (m: unknown) => void;

/** Minimal stand-in for a colyseus.js Room. */
class FakeRoom {
  handlers = new Map<string, Handler>();
  leaveCb: ((code: number) => void) | null = null;
  sent: unknown[] = [];
  left: boolean[] = [];
  constructor(public reconnectionToken = "room1:tok") {}
  onMessage(type: string, cb: Handler): void {
    this.handlers.set(type, cb);
  }
  onError(): void {}
  onLeave(cb: (code: number) => void): void {
    this.leaveCb = cb;
  }
  send(_type: string, msg: unknown): void {
    this.sent.push(msg);
  }
  leave(consented: boolean): Promise<number> {
    this.left.push(consented);
    return Promise.resolve(1000);
  }
  emit(type: string, m: unknown): void {
    this.handlers.get(type)?.(m);
  }
}

const g = globalThis as { localStorage?: unknown };
let mem: ReturnType<typeof memoryStorage>;

function view(day = 1): PlayerView {
  return { you: "p1", state: { players: [], day } } as unknown as PlayerView;
}

function make(reconnect: (token: string) => Promise<unknown>): { game: OnlineGame; room: FakeRoom } {
  const room = new FakeRoom();
  const Ctor = OnlineGame as unknown as new (client: unknown, code: string | undefined) => OnlineGame;
  const game = new Ctor({ reconnect }, undefined);
  (game as unknown as { attach(r: unknown): void }).attach(room);
  room.emit("view", { t: "view", view: view(), events: [] });
  return { game, room };
}

beforeEach(() => {
  mem = memoryStorage();
  g.localStorage = mem;
});

afterEach(() => {
  vi.useRealTimers();
  delete g.localStorage;
});

describe("OnlineGame acks", () => {
  it("a view without ackSeq (the opponent's move) never settles the player's action", async () => {
    const { game, room } = make(() => Promise.reject(new Error("x")));
    const res = game.send({ type: "endDay" });
    let settled = false;
    void res.then(() => (settled = true));
    room.emit("view", { t: "view", view: view(), events: [] });
    await Promise.resolve();
    expect(settled).toBe(false);
    room.emit("error", { t: "error", message: "Герой должен быть в своём замке", ackSeq: 1 });
    await expect(res).resolves.toEqual({ ok: false, error: "Герой должен быть в своём замке", events: [] });
  });

  it("the view with the action's ackSeq settles it", async () => {
    const { game, room } = make(() => Promise.reject(new Error("x")));
    const res = game.send({ type: "endDay" });
    room.emit("view", { t: "view", view: view(2), events: [{ type: "newDay", day: 2 }], ackSeq: 1 });
    await expect(res).resolves.toEqual({ ok: true, events: [{ type: "newDay", day: 2 }] });
  });
});

describe("OnlineGame reconnection", () => {
  it("fails pending actions on a drop and keeps retrying (and the token) past 15 s of network errors", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fresh = new FakeRoom("room1:tok");
    const { game, room } = make(() => {
      calls++;
      return calls < 8 ? Promise.reject(new Error("network")) : Promise.resolve(fresh);
    });
    const pending = game.send({ type: "endDay" });
    room.leaveCb?.(1006);
    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(game.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(game.status).toBe("reconnecting");
    expect(mem.getItem(STORAGE_KEYS.reconnect)).not.toBeNull();
    expect(OnlineGame.savedReconnect()?.token).toBe("room1:tok");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toBe(8);
    fresh.emit("view", { t: "view", view: view(), events: [] });
    expect(game.status).toBe("playing");
  });

  it("stops and forgets the token when the server says the seat is gone", async () => {
    vi.useFakeTimers();
    const { game, room } = make(() => Promise.reject(Object.assign(new Error("expired"), { code: 4214 })));
    room.leaveCb?.(1006);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(game.status).toBe("closed");
    expect(mem.getItem(STORAGE_KEYS.reconnect)).toBeNull();
  });

  it("gives up after the reconnection window", async () => {
    vi.useFakeTimers();
    const { game, room } = make(() => Promise.reject(new Error("network")));
    room.leaveCb?.(1006);
    await vi.advanceTimersByTimeAsync(80_000);
    expect(game.status).toBe("closed");
    expect(mem.getItem(STORAGE_KEYS.reconnect)).toBeNull();
  });

  it("leaving while a reconnect is in flight does not come back", async () => {
    vi.useFakeTimers();
    const box: { resolve?: (r: unknown) => void } = {};
    const fresh = new FakeRoom("room1:tok");
    const { game, room } = make(() => new Promise((r) => (box.resolve = r)));
    const statuses: string[] = [];
    game.onStatus((s) => statuses.push(s));
    room.leaveCb?.(1006);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(box.resolve).toBeDefined();
    game.suspend();
    box.resolve?.(fresh);
    await vi.advanceTimersByTimeAsync(10);
    expect(fresh.left).toEqual([false]);
    expect(statuses).not.toContain("playing");
    expect(game.status).toBe("closed");
    // stepped away, not given up: the lobby can still return
    expect(OnlineGame.savedReconnect()).not.toBeNull();
  });

  it("suspend keeps the seat, leave gives it up", () => {
    const a = make(() => Promise.reject(new Error("x")));
    a.game.suspend();
    expect(a.room.left).toEqual([false]);
    expect(OnlineGame.savedReconnect()).not.toBeNull();
    const b = make(() => Promise.reject(new Error("x")));
    b.game.leave();
    expect(b.room.left).toEqual([true]);
    expect(OnlineGame.savedReconnect()).toBeNull();
  });

  it("recognises the matchmaker's final answers", () => {
    expect(isSeatGone({ code: 4212 })).toBe(true);
    expect(isSeatGone({ code: 4214 })).toBe(true);
    expect(isSeatGone({ code: 429 })).toBe(false);
    expect(isSeatGone(new Error("offline"))).toBe(false);
  });
});
