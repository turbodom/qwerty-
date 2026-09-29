import { Client } from "colyseus.js";
import type { Room } from "colyseus.js";
import { ROOM_NAME } from "@korony/shared";
import type { ClientMessage, GameAction, GameEvent, PlayerView, RoomJoinOptions } from "@korony/shared";
import { DEFAULT_MAP_ID, colyseusEndpoint } from "../config";
import { t } from "../i18n";
import { STORAGE_KEYS, readJson, removeItem, writeJson } from "../storage";
import type { ActionResultLike, GameConnection, ViewListener } from "./connection";

export type OnlineStatus = "connecting" | "waiting" | "playing" | "reconnecting" | "closed";

/** Saved so a page reload can rejoin the match within the server's reconnection window. */
interface ReconnectInfo {
  token: string;
  savedAt: number;
  code?: string;
}

/** Server keeps a seat for 60 s; a little slack for clock differences. */
const RECONNECT_WINDOW_MS = 70_000;
const ACTION_TIMEOUT_MS = 15_000;
/** Pause between reconnection attempts: 1 s, 2 s, ... up to this cap, until the window has passed. */
const RECONNECT_MAX_DELAY_MS = 5_000;
/** Colyseus matchmaker codes that mean the seat is gone for good (MATCHMAKE_INVALID_ROOM_ID, MATCHMAKE_EXPIRED). */
const SEAT_GONE_CODES: readonly number[] = [4212, 4214];

/** True when a reconnect error is the server's final answer (room disposed, token expired), not a network problem. */
export function isSeatGone(e: unknown): boolean {
  const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  return typeof code === "number" && SEAT_GONE_CODES.includes(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface Pending {
  resolve: (r: ActionResultLike) => void;
  timer: ReturnType<typeof setTimeout>;
}

function isView(x: unknown): x is PlayerView {
  if (!x || typeof x !== "object") return false;
  const v = x as Partial<PlayerView>;
  return typeof v.you === "string" && !!v.state && typeof v.state === "object" && Array.isArray(v.state.players);
}

function numberOrUndefined(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

/** Online PvP match over Colyseus. The server is authoritative: we send actions and render its views. */
export class OnlineGame implements GameConnection {
  readonly kind = "online" as const;
  view: PlayerView | null = null;
  timerEndsAt?: number;
  status: OnlineStatus = "connecting";
  /** Private room code (friend game), if any. */
  readonly code: string | undefined;

  private room: Room | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<ViewListener>();
  private readonly statusListeners = new Set<(s: OnlineStatus) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private left = false;
  /** How we left: true = gave up the match (forfeit), false = stepped away keeping the seat. */
  private leftConsented = true;

  private constructor(
    private readonly client: Client,
    code: string | undefined,
  ) {
    this.code = code;
  }

  /** Joins (or creates) a PvP room; with `code` only players using the same code meet. */
  static async join(opts: { token: string; code?: string; mapId?: string }): Promise<OnlineGame> {
    const client = new Client(colyseusEndpoint());
    const game = new OnlineGame(client, opts.code);
    const joinOptions: RoomJoinOptions = { token: opts.token, mode: "pvp", mapId: opts.mapId ?? DEFAULT_MAP_ID };
    if (opts.code) joinOptions.code = opts.code;
    const room = await client.joinOrCreate(ROOM_NAME, joinOptions);
    game.attach(room);
    return game;
  }

  /** Saved reconnection data when it is still inside the reconnection window. */
  static savedReconnect(): ReconnectInfo | null {
    const info = readJson<ReconnectInfo>(STORAGE_KEYS.reconnect);
    if (!info || typeof info.token !== "string" || typeof info.savedAt !== "number") return null;
    if (Date.now() - info.savedAt > RECONNECT_WINDOW_MS) {
      removeItem(STORAGE_KEYS.reconnect);
      return null;
    }
    return info;
  }

  /** Rejoins the match saved before a reload; null when that is no longer possible. */
  static async resume(): Promise<OnlineGame | null> {
    const info = OnlineGame.savedReconnect();
    if (!info) return null;
    const client = new Client(colyseusEndpoint());
    try {
      const room = await client.reconnect(info.token);
      const game = new OnlineGame(client, info.code);
      game.attach(room);
      return game;
    } catch (e) {
      // keep the token after a network error: the seat may still be held, the lobby can try again
      if (isSeatGone(e)) removeItem(STORAGE_KEYS.reconnect);
      return null;
    }
  }

  subscribe(cb: ViewListener): () => void {
    this.listeners.add(cb);
    if (this.view) cb(this.view, []);
    return () => {
      this.listeners.delete(cb);
    };
  }

  onStatus(cb: (s: OnlineStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  /** Server errors that do not answer one of our actions (and connection problems). */
  onError(cb: (message: string) => void): () => void {
    this.errorListeners.add(cb);
    return () => {
      this.errorListeners.delete(cb);
    };
  }

  send(action: GameAction): Promise<ActionResultLike> {
    const room = this.room;
    if (!room || this.left) return Promise.resolve({ ok: false, error: t("online.noConnection"), events: [] });
    const seq = ++this.seq;
    const msg: ClientMessage = { t: "action", action, seq };
    return new Promise<ActionResultLike>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        resolve({ ok: false, error: t("online.timeout"), events: [] });
      }, ACTION_TIMEOUT_MS);
      this.pending.set(seq, { resolve, timer });
      try {
        room.send("action", msg);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(seq);
        resolve({ ok: false, error: e instanceof Error ? e.message : String(e), events: [] });
      }
    });
  }

  /** Leaves for good: the server counts it as giving up the match (a forfeit once the game is running). */
  leave(): void {
    this.close(true);
  }

  /**
   * Steps away without giving up: the connection is closed as if it dropped, so the server keeps the seat
   * for its reconnection window (the day timer plays meanwhile) and the saved token lets the lobby return.
   */
  suspend(): void {
    this.close(false);
  }

  // ================= internals =================

  private close(consented: boolean): void {
    if (this.left) return;
    this.left = true;
    this.leftConsented = consented;
    const room = this.room;
    if (consented) removeItem(STORAGE_KEYS.reconnect);
    else if (room) this.saveReconnect(room);
    this.failPending(t("online.left"));
    this.room = null;
    if (room) room.leave(consented).catch(() => undefined);
    this.setStatus("closed");
    this.listeners.clear();
  }

  /** Answers every action still waiting for the server (the connection is gone, so no ack will come). */
  private failPending(error?: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve(error === undefined ? { ok: false, events: [] } : { ok: false, error, events: [] });
    }
    this.pending.clear();
  }

  private attach(room: Room): void {
    this.room = room;
    this.saveReconnect(room);
    this.setStatus(this.view ? "playing" : "waiting");
    room.onMessage("view", (m: unknown) => this.handle("view", m));
    room.onMessage("error", (m: unknown) => this.handle("error", m));
    room.onMessage("timer", (m: unknown) => this.handle("timer", m));
    room.onMessage("*", (type: string | number, m: unknown) => this.handle(String(type), m));
    room.onError((_code: number, message?: string) => this.emitError(message ?? t("online.connError")));
    room.onLeave((code: number) => {
      if (this.left) return;
      // 1000 = the server closed the room normally (game over / room disposed)
      if (code === 1000) {
        this.setStatus("closed");
        removeItem(STORAGE_KEYS.reconnect);
        return;
      }
      void this.tryReconnect();
    });
  }

  private saveReconnect(room: Room): void {
    if (room.reconnectionToken) this.saveToken(room.reconnectionToken, Date.now());
  }

  private saveToken(token: string, savedAt: number): void {
    const info: ReconnectInfo = { token, savedAt };
    if (this.code) info.code = this.code;
    writeJson(STORAGE_KEYS.reconnect, info);
  }

  /**
   * The connection dropped: retry with a capped backoff for as long as the server may still hold the seat.
   * The saved token is dropped only when the server says the seat is gone or the window has passed, so the
   * lobby button and a page reload can still bring the player back after a network error.
   */
  private async tryReconnect(): Promise<void> {
    const token = this.room?.reconnectionToken;
    this.room = null;
    // no ack can arrive for actions sent on the dead connection; the snapshot after reconnecting is authoritative
    this.failPending();
    if (!token) {
      removeItem(STORAGE_KEYS.reconnect);
      this.setStatus("closed");
      return;
    }
    const disconnectedAt = Date.now();
    this.saveToken(token, disconnectedAt);
    this.setStatus("reconnecting");
    for (let i = 0; !this.left; i++) {
      await sleep(Math.min(1000 * (i + 1), RECONNECT_MAX_DELAY_MS));
      if (this.left) return;
      if (Date.now() - disconnectedAt > RECONNECT_WINDOW_MS) break;
      let room: Room;
      try {
        room = await this.client.reconnect(token);
      } catch (e) {
        if (isSeatGone(e)) break;
        continue;
      }
      if (this.left) {
        // the player left while the request was in flight: do not pull them back into the game
        if (!this.leftConsented) this.saveReconnect(room);
        room.leave(this.leftConsented).catch(() => undefined);
        return;
      }
      this.attach(room);
      return;
    }
    if (!this.left) {
      // the "closed" status is the player's notice (the app shows "connection lost")
      removeItem(STORAGE_KEYS.reconnect);
      this.setStatus("closed");
    }
  }

  private handle(type: string, raw: unknown): void {
    const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const kind = typeof m["t"] === "string" ? m["t"] : type;
    const ackSeq = numberOrUndefined(m["ackSeq"]);
    if (kind === "view") {
      const view = m["view"];
      if (!isView(view)) return;
      const events = Array.isArray(m["events"]) ? (m["events"] as GameEvent[]) : [];
      this.view = view;
      if (this.status !== "playing") this.setStatus("playing");
      if (this.room) this.saveReconnect(this.room);
      for (const cb of [...this.listeners]) cb(view, events);
      this.settle(ackSeq, { ok: true, events });
    } else if (kind === "error") {
      const message = typeof m["message"] === "string" ? m["message"] : t("online.error");
      if (ackSeq !== undefined && this.pending.has(ackSeq)) this.settle(ackSeq, { ok: false, error: message, events: [] });
      else this.emitError(message);
    } else if (kind === "timer") {
      const endsAt = numberOrUndefined(m["endsAt"]);
      if (endsAt !== undefined) {
        // endsAt 0 (or any past time) clears the timer
        if (endsAt > 0) this.timerEndsAt = endsAt;
        else delete this.timerEndsAt;
        for (const cb of [...this.statusListeners]) cb(this.status);
      }
    }
  }

  /**
   * Resolves the action with `ackSeq`. The server acknowledges every action of this client with its seq,
   * so a message without ackSeq (the opponent's move, a toast, the day timer) never settles anything.
   */
  private settle(ackSeq: number | undefined, result: ActionResultLike): void {
    if (ackSeq === undefined) return;
    const key = ackSeq;
    const p = this.pending.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(key);
    p.resolve(result);
  }

  private setStatus(s: OnlineStatus): void {
    this.status = s;
    for (const cb of [...this.statusListeners]) cb(s);
  }

  private emitError(message: string): void {
    for (const cb of [...this.errorListeners]) cb(message);
  }
}
