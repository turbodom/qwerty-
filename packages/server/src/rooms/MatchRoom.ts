import { randomInt } from "node:crypto";
import { ErrorCode, Protocol, Room, ServerError } from "colyseus";
import type { AuthContext, Client } from "colyseus";
import { ROOM_NAME, isKnownMapId, isRoomJoinOptions } from "@korony/shared";
import type { RoomJoinOptions } from "@korony/shared";
import type { SessionAuth } from "../auth";
import { loadoutFor } from "../shop";
import type { Store } from "../store";
import { MatchLogic, matchFilter } from "./matchLogic";
import type { JoinUser, Step } from "./matchLogic";

export { ROOM_NAME };

export interface MatchRoomDeps {
  auth: SessionAuth;
  store: Store;
  daySeconds: number;
  reconnectSeconds: number;
  now?: () => number;
}

/** Delay between the final message of a forfeited match and closing the room. */
const DISPOSE_DELAY_MS = 1000;
/** A match that ended normally keeps its room this long for the result screen, then closes. */
const FINISHED_ROOM_TTL_MS = 10 * 60 * 1000;

/**
 * Verifies join options and the session token before a seat is reserved (Colyseus static onAuth).
 * The result becomes `client.auth`.
 */
export async function authorizeJoin(deps: Pick<MatchRoomDeps, "auth" | "store">, options: unknown): Promise<JoinUser> {
  if (!isRoomJoinOptions(options)) throw new ServerError(ErrorCode.AUTH_FAILED, "Неверные параметры входа в комнату");
  if (options.mapId !== undefined && !isKnownMapId(options.mapId)) {
    throw new ServerError(ErrorCode.MATCHMAKE_INVALID_CRITERIA, "Неизвестная карта");
  }
  const session = await deps.auth.verify(options.token);
  if (!session) throw new ServerError(ErrorCode.AUTH_FAILED, "Нужно войти заново");
  const user = await deps.store.getUser(session.uid);
  return { uid: session.uid, username: user?.username ?? session.username, loadout: loadoutFor(user) };
}

/**
 * Two-player PvP match. No Colyseus Schema state: the authoritative GameState lives in MatchLogic and every
 * client gets its own fog-of-war PlayerView through `client.send(message.t, message)` (types "view", "error", "timer").
 * Clients send `room.send("action", { t: "action", action, seq })`.
 */
export function createMatchRoom(deps: MatchRoomDeps) {
  const now = deps.now ?? Date.now;

  return class MatchRoom extends Room {
    private logic!: MatchLogic;
    private dayTimer: NodeJS.Timeout | null = null;
    private closeTimer: NodeJS.Timeout | null = null;
    private closeAt = Number.POSITIVE_INFINITY;
    private closing = false;

    static override async onAuth(_token: string, options: unknown, _context: AuthContext): Promise<JoinUser> {
      return authorizeJoin(deps, options);
    }

    override onCreate(options: Partial<RoomJoinOptions>): void {
      // Assigned here rather than as a class field: Room implements maxClients as an accessor.
      this.maxClients = 2;
      this.setPatchRate(null);
      this.autoDispose = true;
      this.logic = new MatchLogic({
        gameId: this.roomId,
        mapId: matchFilter(options).mapId,
        daySeconds: deps.daySeconds,
        now,
        seed: () => randomInt(0, 2 ** 32),
      });
      this.onMessage("action", (client, message: unknown) => {
        this.safely("action", () => this.logic.handleMessage(client.sessionId, message));
      });
      this.onMessage("*", (client, type) => {
        client.send("error", { t: "error", message: `Неизвестное сообщение: ${String(type).slice(0, 32)}` });
      });
    }

    override async onJoin(client: Client, _options: unknown, auth: JoinUser): Promise<void> {
      const err = this.logic.join(client.sessionId, auth);
      if (err) throw new ServerError(ErrorCode.APPLICATION_ERROR, err);
      if (this.logic.full && !this.logic.started) {
        await this.lock();
        this.run(this.logic.start());
      }
    }

    override async onLeave(client: Client, consented: boolean): Promise<void> {
      if (this.closing) return;
      const sessionId = client.sessionId;
      if (consented) {
        this.run(this.logic.forfeit(sessionId));
        return;
      }
      const { hold, step } = this.logic.disconnected(sessionId);
      this.run(step);
      if (!hold) return;
      if (deps.reconnectSeconds <= 0) {
        this.run(this.logic.forfeit(sessionId));
        return;
      }
      try {
        await this.allowReconnection(client, deps.reconnectSeconds);
        this.run(this.logic.reconnected(sessionId));
      } catch {
        if (!this.closing) this.run(this.logic.forfeit(sessionId));
      }
    }

    override onBeforeShutdown(): void {
      // A server restart is nobody's defeat.
      this.closing = true;
      super.onBeforeShutdown();
    }

    override onDispose(): void {
      this.closing = true;
      this.clearDayTimer();
      if (this.closeTimer) clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    /** Delivers a step's messages and applies its timer / close decisions. */
    private run(step: Step): void {
      for (const { sessionId, message } of step.out) {
        this.clients.getById(sessionId)?.send(message.t, message);
      }
      if (step.timer !== undefined) this.scheduleDay(step.timer);
      if (step.dispose) this.closeAfter(DISPOSE_DELAY_MS);
      else if (this.logic.finished) this.closeAfter(FINISHED_ROOM_TTL_MS);
    }

    /** Runs logic from a socket or timer callback; a bug must not take the process down. */
    private safely(what: string, fn: () => Step): void {
      try {
        this.run(fn());
      } catch (err) {
        console.error(`[match] ${what} failed:`, err);
      }
    }

    /**
     * Disconnects everyone (and so disposes the room) after `ms`, unless an earlier close is already set.
     * Uses close code 1000 (normal closure): the match is over, clients should not try to reconnect.
     */
    private closeAfter(ms: number): void {
      if (this.closing) return;
      const at = Date.now() + ms;
      if (at >= this.closeAt) return;
      if (this.closeTimer) clearTimeout(this.closeTimer);
      this.closeAt = at;
      this.closeTimer = setTimeout(() => {
        this.closeTimer = null;
        this.closing = true;
        this.disconnect(Protocol.WS_CLOSE_NORMAL).catch((err: unknown) => console.error("[match] disconnect failed:", err));
      }, ms);
    }

    private scheduleDay(timer: Step["timer"]): void {
      this.clearDayTimer();
      if (!timer) return;
      const { day } = timer;
      this.dayTimer = setTimeout(() => {
        this.dayTimer = null;
        this.safely("day timer", () => this.logic.expireDay(day));
      }, Math.max(0, timer.endsAt - now()));
    }

    private clearDayTimer(): void {
      if (this.dayTimer) clearTimeout(this.dayTimer);
      this.dayTimer = null;
    }
  };
}
