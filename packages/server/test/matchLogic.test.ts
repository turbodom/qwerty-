import { describe, expect, it } from "vitest";
import { START_GOLD } from "@korony/shared";
import type { ServerMessage } from "@korony/shared";
import { MatchLogic, matchFilter } from "../src/rooms/matchLogic";
import type { JoinUser, MatchLogicOptions, Outgoing, Step } from "../src/rooms/matchLogic";

const alice: JoinUser = { uid: "uid-a", username: "Алиса", loadout: { startGold: 1000, startArtifact: "sword", banner: "gold" } };
const bob: JoinUser = { uid: "uid-b", username: "Боб", loadout: {} };

function setup(opts: Partial<MatchLogicOptions> = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const logic = new MatchLogic({ gameId: "room1", mapId: "valley", daySeconds: 90, now: clock.now, seed: () => 42, ...opts });
  return { logic, clock };
}

function started(opts: Partial<MatchLogicOptions> = {}) {
  const s = setup(opts);
  expect(s.logic.join("sa", alice)).toBeNull();
  expect(s.logic.join("sb", bob)).toBeNull();
  const step = s.logic.start();
  return { ...s, step };
}

const to = (step: Step, sessionId: string): ServerMessage[] => step.out.filter((o) => o.sessionId === sessionId).map((o) => o.message);
const views = (out: Outgoing[]) => out.filter((o) => o.message.t === "view");
const action = (a: unknown, seq: number) => ({ t: "action", action: a, seq });

describe("matchFilter", () => {
  it("normalizes the code and map so public players never meet friend rooms", () => {
    expect(matchFilter({ token: "x", mode: "pvp" })).toEqual({ code: "", mapId: "valley" });
    expect(matchFilter({ code: " abc " })).toEqual({ code: "ABC", mapId: "valley" });
    expect(matchFilter({ code: "x".repeat(17) })).toEqual({ code: "", mapId: "valley" });
    expect(matchFilter({ mapId: "atlantis" })).toEqual({ code: "", mapId: "valley" });
    expect(matchFilter({ mapId: "toString" }).mapId).toBe("valley");
    expect(matchFilter(null)).toEqual({ code: "", mapId: "valley" });
  });
});

describe("seats", () => {
  it("seats two different users in join order and refuses the rest", () => {
    const { logic } = setup();
    expect(logic.join("sa", alice)).toBeNull();
    expect(logic.join("sa2", { ...alice })).toMatch(/уже/);
    expect(logic.join("sb", bob)).toBeNull();
    expect(logic.full).toBe(true);
    expect(logic.join("sc", { uid: "uid-c", username: "c", loadout: {} })).toMatch(/заполнена/);
    expect(logic.seats.map((s) => [s.sessionId, s.seat, s.playerId])).toEqual([["sa", 0, "p0"], ["sb", 1, "p1"]]);
  });

  it("frees the seat of a player who leaves before the game starts", () => {
    const { logic } = setup();
    logic.join("sa", alice);
    expect(logic.disconnected("sa").hold).toBe(false);
    expect(logic.seats).toHaveLength(0);
    logic.join("sb", bob);
    logic.join("sc", alice);
    expect(logic.seats.map((s) => [s.sessionId, s.seat])).toEqual([["sb", 0], ["sc", 1]]);
    expect(logic.forfeit("sc")).toEqual({ out: [] });
    expect(logic.seats).toHaveLength(1);
  });

  it("rejects an unknown map", () => {
    expect(() => new MatchLogic({ gameId: "g", mapId: "nope", daySeconds: 90, now: () => 0, seed: () => 1 })).toThrow();
  });
});

describe("start", () => {
  it("creates the game with loadouts, sends each player a view and starts the day timer", () => {
    const { logic, step } = started();
    const state = logic.state;
    if (!state) throw new Error("no state");
    expect(state.players.map((p) => [p.id, p.name, p.seat])).toEqual([["p0", "Алиса", 0], ["p1", "Боб", 1]]);
    expect(state.players[0]?.gold).toBe(START_GOLD + 1000);
    expect(state.players[0]?.banner).toBe("gold");
    expect(state.players[1]?.gold).toBe(START_GOLD);
    const hero0 = state.heroes[state.players[0]?.heroId ?? ""];
    expect(hero0?.equipped.weapon).toBe("sword");

    const a = to(step, "sa");
    const b = to(step, "sb");
    expect(a.map((m) => m.t)).toEqual(["view", "timer"]);
    expect(b.map((m) => m.t)).toEqual(["view", "timer"]);
    const va = a[0];
    const vb = b[0];
    if (va?.t !== "view" || vb?.t !== "view") throw new Error("expected views");
    expect(va.view.you).toBe("p0");
    expect(vb.view.you).toBe("p1");
    expect(va.view.state.rngState).toBe(0);
    expect(vb.view.state.players[0]?.gold).toBe(0); // opponent gold is hidden
    expect(step.timer).toEqual({ endsAt: 1_000_000 + 90_000, day: 1 });
    expect(a[1]).toEqual({ t: "timer", endsAt: 1_090_000 });
    expect(() => logic.start()).toThrow();
  });

  it("is deterministic for a given seed", () => {
    const one = started().logic.state;
    const two = started().logic.state;
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });
});

describe("handleMessage", () => {
  it("rejects malformed messages with an error to the sender only", () => {
    const { logic } = started();
    const bad = logic.handleMessage("sa", { t: "action", action: { type: "fly" }, seq: 7 });
    expect(bad.out).toEqual([{ sessionId: "sa", message: { t: "error", message: "Неверное сообщение", ackSeq: 7 } }]);
    expect(logic.handleMessage("sa", "hello").out[0]?.message).toEqual({ t: "error", message: "Неверное сообщение" });
    expect(logic.handleMessage("sa", { ...action({ type: "endDay" }, 1), extra: 1 }).out[0]?.message.t).toBe("error");
    expect(logic.handleMessage("stranger", action({ type: "endDay" }, 1)).out).toEqual([]);
  });

  it("refuses actions before the opponent arrives", () => {
    const { logic } = setup();
    logic.join("sa", alice);
    expect(logic.handleMessage("sa", action({ type: "endDay" }, 3)).out).toEqual([
      { sessionId: "sa", message: { t: "error", message: "Ждём соперника", ackSeq: 3 } },
    ]);
  });

  it("returns rule errors from applyAction with the ackSeq", () => {
    const { logic } = started();
    const res = logic.handleMessage("sa", action({ type: "chooseSkill", index: 0 }, 5));
    expect(res.out).toHaveLength(1);
    const m = res.out[0]?.message;
    expect(m?.t).toBe("error");
    if (m?.t === "error") {
      expect(m.ackSeq).toBe(5);
      expect(m.message.length).toBeGreaterThan(0);
    }
  });

  it("applies actions for the sender's player, acks only the sender, and advances the day when both end it", () => {
    const { logic, clock } = started();
    const first = logic.handleMessage("sa", action({ type: "endDay" }, 1));
    expect(views(first.out)).toHaveLength(2);
    const va = to(first, "sa")[0];
    const vb = to(first, "sb")[0];
    expect(va).toMatchObject({ t: "view", ackSeq: 1 });
    expect(vb?.t).toBe("view");
    expect(vb && "ackSeq" in vb).toBe(false);
    expect(first.timer).toBeUndefined();
    expect(logic.state?.players[0]?.endedDay).toBe(true);
    expect(logic.state?.day).toBe(1);

    // ending twice is a rule error
    expect(logic.handleMessage("sa", action({ type: "endDay" }, 2)).out[0]?.message.t).toBe("error");

    clock.advance(10_000);
    const second = logic.handleMessage("sb", action({ type: "endDay" }, 9));
    expect(logic.state?.day).toBe(2);
    expect(second.timer).toEqual({ endsAt: 1_010_000 + 90_000, day: 2 });
    const toA = to(second, "sa");
    const toB = to(second, "sb");
    expect(toA.map((m) => m.t)).toEqual(["view", "timer"]);
    expect(toB[0]).toMatchObject({ t: "view", ackSeq: 9 });
    const ev = toA[0]?.t === "view" ? toA[0].events : [];
    expect(ev).toContainEqual({ type: "newDay", day: 2 });
  });

  it("limits message floods per client", () => {
    const { logic } = started({ rate: { burst: 2, perSecond: 0 } });
    logic.handleMessage("sa", "x");
    logic.handleMessage("sa", "x");
    expect(logic.handleMessage("sa", action({ type: "endDay" }, 4)).out[0]?.message).toEqual({
      t: "error", message: "Слишком много действий, подождите немного", ackSeq: 4,
    });
    expect(logic.handleMessage("sb", action({ type: "endDay" }, 1)).out.length).toBe(2);
  });
});

describe("day timer", () => {
  it("force-ends the day for players who have not ended it", () => {
    const { logic, clock } = started();
    logic.handleMessage("sa", action({ type: "endDay" }, 1));
    clock.advance(90_000);
    const step = logic.expireDay(1);
    expect(logic.state?.day).toBe(2);
    expect(step.timer).toEqual({ endsAt: 1_090_000 + 90_000, day: 2 });
    expect(views(step.out)).toHaveLength(2);
    expect(step.out.filter((o) => o.message.t === "timer")).toHaveLength(2);
    for (const o of views(step.out)) expect(o.message).not.toHaveProperty("ackSeq");
  });

  it("works when nobody ended the day", () => {
    const { logic } = started();
    logic.expireDay(1);
    expect(logic.state?.day).toBe(2);
    expect(logic.timer?.day).toBe(2);
  });

  it("ignores a stale timer", () => {
    const { logic } = started();
    logic.handleMessage("sa", action({ type: "endDay" }, 1));
    logic.handleMessage("sb", action({ type: "endDay" }, 1));
    expect(logic.state?.day).toBe(2);
    expect(logic.expireDay(1)).toEqual({ out: [] });
    expect(logic.state?.day).toBe(2);
  });
});

describe("disconnects and forfeits", () => {
  it("holds the seat during a game, tells the opponent, and restores the view on reconnect", () => {
    const { logic } = started();
    const d = logic.disconnected("sb");
    expect(d.hold).toBe(true);
    expect(d.step.out).toHaveLength(1);
    expect(d.step.out[0]?.sessionId).toBe("sa");
    expect(d.step.out[0]?.message).toMatchObject({ t: "view", events: [{ type: "toast", player: "p0" }] });
    expect(logic.seatOf("sb")?.connected).toBe(false);

    const r = logic.reconnected("sb");
    expect(to(r, "sb").map((m) => m.t)).toEqual(["view", "timer"]);
    expect(to(r, "sa")[0]).toMatchObject({ t: "view", events: [{ type: "toast", text: "Соперник вернулся" }] });
    expect(logic.seatOf("sb")?.connected).toBe(true);
  });

  it("gives the win to the remaining player and closes the room", () => {
    const { logic } = started();
    const step = logic.forfeit("sb");
    expect(logic.state?.winner).toBe("p0");
    expect(logic.state?.players[1]?.defeated).toBe(true);
    expect(logic.finished).toBe(true);
    expect(step.dispose).toBe(true);
    expect(step.timer).toBeNull();
    const m = to(step, "sa")[0];
    expect(m?.t === "view" && m.events).toEqual([
      { type: "defeat", player: "p1" },
      { type: "victory", player: "p0" },
      { type: "toast", player: "p0", text: "Соперник покинул партию. Победа!" },
    ]);
    // a finished game refuses actions and ignores timers and further forfeits
    expect(logic.handleMessage("sa", action({ type: "endDay" }, 1)).out[0]?.message.t).toBe("error");
    expect(logic.expireDay(1)).toEqual({ out: [] });
    expect(logic.forfeit("sa")).toEqual({ out: [] });
    expect(logic.disconnected("sa").hold).toBe(false);
  });
});
