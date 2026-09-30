import {
  LOG_LIMIT, ROOM_CODE_MAX, applyAction, createGame, isKnownMapId, eventsForPlayer, forceEndDay, isClientMessage, playerView,
} from "@korony/shared";
import type { GameEvent, GameState, PlayerId, PlayerLoadout, PlayerSetup, Seat, ServerMessage } from "@korony/shared";

/**
 * Pure match logic behind MatchRoom: seats, the game, the day timer and message handling.
 * No sockets and no clocks of its own (time and seeds are injected), so it is unit-testable.
 * Every method returns the messages to send; the room only delivers them and schedules the timer.
 */

export const DEFAULT_MAP_ID = "valley";

/** Who joins a seat (from the verified session and the user's purchases). */
export interface JoinUser {
  uid: string;
  username: string;
  loadout: PlayerLoadout;
}

export interface Seated extends JoinUser {
  /** Colyseus session id (stays the same across a reconnection). */
  sessionId: string;
  seat: Seat;
  /** Player id inside GameState; seat based so that Pi uids never reach the opponent. */
  playerId: PlayerId;
  connected: boolean;
}

export interface Outgoing {
  sessionId: string;
  message: ServerMessage;
}

export interface DayTimer {
  /** Unix ms. */
  endsAt: number;
  /** The day the timer ends; a firing timer for another day is stale and ignored. */
  day: number;
}

export interface Step {
  out: Outgoing[];
  /** A day timer to (re)schedule; null cancels the running one; undefined leaves it alone. */
  timer?: DayTimer | null;
  /** The match is over for good: the room should close. */
  dispose?: boolean;
}

export interface MatchLogicOptions {
  gameId: string;
  mapId: string;
  daySeconds: number;
  now: () => number;
  /** uint32 game seed. */
  seed: () => number;
  /** Flood control per client: bucket size and refill per second. */
  rate?: { burst: number; perSecond: number };
}

/** Matchmaking filter: players meet only with the same friend code ("" = public) and map. */
export function matchFilter(options: unknown): { code: string; mapId: string } {
  const o = typeof options === "object" && options !== null ? (options as Record<string, unknown>) : {};
  const rawCode = o["code"];
  const code = typeof rawCode === "string" && rawCode.length <= ROOM_CODE_MAX ? rawCode.trim().toUpperCase() : "";
  const rawMap = o["mapId"];
  const mapId = typeof rawMap === "string" && isKnownMapId(rawMap) ? rawMap : DEFAULT_MAP_ID;
  return { code, mapId };
}

export function playerIdForSeat(seat: Seat): PlayerId {
  return `p${seat}`;
}

function seqOf(raw: unknown): number | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const seq = (raw as Record<string, unknown>)["seq"];
  return typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0 ? seq : undefined;
}

function errorMsg(message: string, ackSeq?: number): ServerMessage {
  return ackSeq === undefined ? { t: "error", message } : { t: "error", message, ackSeq };
}

export class MatchLogic {
  readonly seats: Seated[] = [];
  state: GameState | null = null;
  /** The running day timer, if any. */
  timer: DayTimer | null = null;
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private readonly opts: MatchLogicOptions) {
    if (!isKnownMapId(opts.mapId)) throw new Error(`unknown map ${opts.mapId}`);
  }

  get started(): boolean {
    return this.state !== null;
  }

  get finished(): boolean {
    return this.state !== null && this.state.winner !== null;
  }

  get full(): boolean {
    return this.seats.length >= 2;
  }

  seatOf(sessionId: string): Seated | undefined {
    return this.seats.find((s) => s.sessionId === sessionId);
  }

  /** Takes a free seat. Returns an error message (Russian) when the player cannot sit here. */
  join(sessionId: string, user: JoinUser): string | null {
    if (this.started) return "Партия уже идёт";
    if (this.full) return "Комната заполнена";
    if (this.seats.some((s) => s.uid === user.uid)) return "Вы уже ждёте соперника в этой комнате";
    const taken = new Set(this.seats.map((s) => s.seat));
    const seat: Seat = taken.has(0) ? 1 : 0;
    this.seats.push({ ...user, sessionId, seat, playerId: playerIdForSeat(seat), connected: true });
    this.seats.sort((a, b) => a.seat - b.seat);
    return null;
  }

  /** Both seats taken: create the game, send both views and start the first day timer. */
  start(): Step {
    if (this.started) throw new Error("match already started");
    const [a, b] = this.seats;
    if (!a || !b) throw new Error("two players are needed to start");
    const setup = (s: Seated): PlayerSetup => ({ id: s.playerId, name: s.username, isAI: false, loadout: { ...s.loadout } });
    this.state = createGame({
      id: this.opts.gameId,
      mapId: this.opts.mapId,
      seed: this.opts.seed() >>> 0,
      players: [setup(a), setup(b)],
    });
    const out = this.views([]);
    const timer = this.armTimer(out);
    return { out, timer };
  }

  /** A message from a client ("action" channel): validate, apply, and fan the views out. */
  handleMessage(sessionId: string, raw: unknown): Step {
    const seat = this.seatOf(sessionId);
    if (!seat) return { out: [] };
    const reply = (message: string, ackSeq?: number): Step => ({ out: [{ sessionId, message: errorMsg(message, ackSeq) }] });
    if (!this.allow(sessionId)) return reply("Слишком много действий, подождите немного", seqOf(raw));
    if (!isClientMessage(raw)) return reply("Неверное сообщение", seqOf(raw));
    const state = this.state;
    if (!state) return reply("Ждём соперника", raw.seq);
    const prevDay = state.day;
    let res;
    try {
      res = applyAction(state, seat.playerId, raw.action);
    } catch (err) {
      console.error("[match] applyAction failed:", err);
      return reply("Ошибка сервера", raw.seq);
    }
    if (!res.ok) return reply(res.error ?? "Так нельзя", raw.seq);
    const out = this.views(res.events, sessionId, raw.seq);
    return { out, ...this.afterChange(prevDay, out) };
  }

  /** The day timer fired: the AI finishes the battles of everyone who has not ended the day and ends it. */
  expireDay(day: number): Step {
    const state = this.state;
    if (!state || state.winner !== null || state.day !== day || this.timer?.day !== day) return { out: [] };
    const events: GameEvent[] = [];
    for (const p of state.players) {
      if (p.isAI || p.defeated || p.endedDay) continue;
      if (state.winner !== null || state.day !== day) break;
      const res = forceEndDay(state, p.id);
      if (res.ok) events.push(...res.events);
    }
    const out = this.views(events);
    const after = this.afterChange(day, out);
    // Should the day somehow not have advanced, give it another full timer instead of stalling.
    if (after.timer === undefined && state.winner === null) return { out, timer: this.armTimer(out) };
    return { out, ...after };
  }

  /**
   * The client's connection dropped. Returns whether the room should hold the seat for a reconnection
   * (only during a running game), and tells the opponent.
   */
  disconnected(sessionId: string): { hold: boolean; step: Step } {
    const seat = this.seatOf(sessionId);
    if (!seat) return { hold: false, step: { out: [] } };
    if (!this.started) {
      this.removeSeat(sessionId);
      return { hold: false, step: { out: [] } };
    }
    seat.connected = false;
    if (this.finished) return { hold: false, step: { out: [] } };
    return { hold: true, step: { out: this.toastOthers(sessionId, "Соперник отключился, ждём его возвращения") } };
  }

  /** The client came back: it gets the current view and timer, the opponent a note. */
  reconnected(sessionId: string): Step {
    const seat = this.seatOf(sessionId);
    if (!seat) return { out: [] };
    seat.connected = true;
    return { out: [...this.snapshot(sessionId), ...this.toastOthers(sessionId, "Соперник вернулся")] };
  }

  /**
   * The player is gone for good (left, or did not come back in time). Before the game this frees the seat;
   * during the game the player is defeated, the opponent wins and the room closes.
   */
  forfeit(sessionId: string): Step {
    const seat = this.seatOf(sessionId);
    if (!seat) return { out: [] };
    seat.connected = false;
    const state = this.state;
    if (!state) {
      this.removeSeat(sessionId);
      return { out: [] };
    }
    if (state.winner !== null) return { out: [] };
    const me = state.players.find((p) => p.id === seat.playerId);
    const other = state.players.find((p) => p.id !== seat.playerId && !p.defeated);
    if (!me || !other) return { out: [] };
    me.defeated = true;
    me.levelChoices = [];
    state.winner = other.id;
    state.battles = [];
    const log = (line: string): void => {
      state.log.push(line);
      if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
    };
    log(`${me.name}: поражение. Покинул партию`);
    log(`${other.name}: победа!`);
    const events: GameEvent[] = [
      { type: "defeat", player: me.id },
      { type: "victory", player: other.id },
      { type: "toast", player: other.id, text: "Соперник покинул партию. Победа!" },
    ];
    const out = this.views(events);
    this.timer = null;
    return { out, timer: null, dispose: true };
  }

  /** Current view (no events) and the running timer, for a (re)connecting client. */
  snapshot(sessionId: string): Outgoing[] {
    const seat = this.seatOf(sessionId);
    if (!seat || !this.state) return [];
    const out: Outgoing[] = [
      { sessionId, message: { t: "view", view: playerView(this.state, seat.playerId), events: [] } },
    ];
    if (this.timer && !this.finished) out.push({ sessionId, message: { t: "timer", endsAt: this.timer.endsAt } });
    return out;
  }

  private removeSeat(sessionId: string): void {
    const i = this.seats.findIndex((s) => s.sessionId === sessionId);
    if (i >= 0) this.seats.splice(i, 1);
    this.buckets.delete(sessionId);
  }

  /** A view for every seat; the acting client also gets ackSeq. */
  private views(events: readonly GameEvent[], ackTo?: string, ackSeq?: number): Outgoing[] {
    const state = this.state;
    if (!state) return [];
    return this.seats.map((s) => {
      const message: ServerMessage = {
        t: "view",
        view: playerView(state, s.playerId),
        events: eventsForPlayer(state, s.playerId, [...events]),
      };
      if (s.sessionId === ackTo && ackSeq !== undefined) message.ackSeq = ackSeq;
      return { sessionId: s.sessionId, message };
    });
  }

  private toastOthers(sessionId: string, text: string): Outgoing[] {
    const state = this.state;
    if (!state) return [];
    return this.seats
      .filter((s) => s.sessionId !== sessionId)
      .map((s) => ({
        sessionId: s.sessionId,
        message: {
          t: "view",
          view: playerView(state, s.playerId),
          events: [{ type: "toast", player: s.playerId, text }],
        } satisfies ServerMessage,
      }));
  }

  /** Timer decision after the state changed: a new day gets a fresh timer, a finished game none. */
  private afterChange(prevDay: number, out: Outgoing[]): Pick<Step, "timer"> {
    const state = this.state;
    if (!state) return {};
    if (state.winner !== null) {
      if (this.timer === null) return {};
      this.timer = null;
      return { timer: null };
    }
    if (state.day !== prevDay) return { timer: this.armTimer(out) };
    return {};
  }

  /** Starts a full day timer and appends the timer broadcast to `out`. */
  private armTimer(out: Outgoing[]): DayTimer | null {
    const state = this.state;
    if (!state || state.winner !== null) {
      this.timer = null;
      return null;
    }
    const timer: DayTimer = { endsAt: this.opts.now() + this.opts.daySeconds * 1000, day: state.day };
    this.timer = timer;
    for (const s of this.seats) out.push({ sessionId: s.sessionId, message: { t: "timer", endsAt: timer.endsAt } });
    return timer;
  }

  /** Token bucket per client. */
  private allow(sessionId: string): boolean {
    const rate = this.opts.rate ?? { burst: 30, perSecond: 10 };
    const t = this.opts.now();
    const b = this.buckets.get(sessionId) ?? { tokens: rate.burst, at: t };
    b.tokens = Math.min(rate.burst, b.tokens + ((t - b.at) / 1000) * rate.perSecond);
    b.at = t;
    this.buckets.set(sessionId, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
