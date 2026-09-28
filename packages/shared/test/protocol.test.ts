import { describe, expect, it } from "vitest";
import { ROOM_NAME, isBattleAction, isClientMessage, isGameAction, isRoomJoinOptions } from "../src";

const ok = (action: unknown, seq = 1) => ({ t: "action", action, seq });

describe("isClientMessage", () => {
  it("accepts every valid GameAction variant", () => {
    const actions: unknown[] = [
      { type: "move", to: { x: 3, y: 4 } },
      { type: "endDay" },
      { type: "hire", unit: "pike" },
      { type: "build", building: "griffinTower" },
      { type: "upgrade", unit: "archer" },
      { type: "equip", artifact: "crown" },
      { type: "unequip", slot: "ring2" },
      { type: "chooseSkill", index: 0 },
      { type: "chooseSkill", index: 1 },
      { type: "battle", action: { type: "move", to: [2, 3] } },
      { type: "battle", action: { type: "attack", target: 4 } },
      { type: "battle", action: { type: "attack", target: 4, from: [1, 1] } },
      { type: "battle", action: { type: "shoot", target: 0 } },
      { type: "battle", action: { type: "defend" } },
      { type: "battle", action: { type: "cast", spell: "bolt", target: 2 } },
      { type: "autoBattle" },
    ];
    for (const a of actions) expect(isClientMessage(ok(a)), JSON.stringify(a)).toBe(true);
    expect(isClientMessage(JSON.parse(JSON.stringify(ok({ type: "endDay" }, 0))))).toBe(true);
  });

  it("rejects malformed payloads", () => {
    const bad: unknown[] = [
      null, undefined, 42, "action", [], {},
      { t: "action", seq: 1 },
      { t: "action", action: { type: "endDay" } },
      { t: "chat", action: { type: "endDay" }, seq: 1 },
      { t: "action", action: { type: "endDay" }, seq: -1 },
      { t: "action", action: { type: "endDay" }, seq: 1.5 },
      { t: "action", action: { type: "endDay" }, seq: "1" },
      { t: "action", action: { type: "endDay" }, seq: NaN },
      { t: "action", action: { type: "endDay" }, seq: 1, extra: true },
      ok(null), ok([]), ok("endDay"),
      ok({ type: "fly" }),
      ok({ type: "endDay", x: 1 }),
      ok({ type: "move" }),
      ok({ type: "move", to: { x: 1 } }),
      ok({ type: "move", to: { x: 1, y: "2" } }),
      ok({ type: "move", to: { x: 1.5, y: 2 } }),
      ok({ type: "move", to: { x: -1, y: 2 } }),
      ok({ type: "move", to: [1, 2] }),
      ok({ type: "move", to: { x: 1, y: 2, z: 3 } }),
      ok({ type: "hire", unit: "dragon" }),
      ok({ type: "hire", unit: "__proto__" }),
      ok({ type: "hire", unit: "constructor" }),
      ok({ type: "build", building: "castle" }),
      ok({ type: "upgrade" }),
      ok({ type: "equip", artifact: "excalibur" }),
      ok({ type: "unequip", slot: "ring" }),
      ok({ type: "chooseSkill", index: 2 }),
      ok({ type: "chooseSkill", index: "0" }),
      ok({ type: "battle" }),
      ok({ type: "battle", action: { type: "move", to: [1] } }),
      ok({ type: "battle", action: { type: "move", to: [1, 2, 3] } }),
      ok({ type: "battle", action: { type: "move", to: { c: 1, r: 2 } } }),
      ok({ type: "battle", action: { type: "attack" } }),
      ok({ type: "battle", action: { type: "attack", target: 1, from: [1, "a"] } }),
      ok({ type: "battle", action: { type: "shoot", target: -3 } }),
      ok({ type: "battle", action: { type: "cast", spell: "fireball", target: 1 } }),
      ok({ type: "battle", action: { type: "cast", spell: "heal" } }),
      ok({ type: "battle", action: { type: "defend", target: 1 } }),
      ok({ type: "battle", action: { type: "endDay" } }),
      JSON.parse('{"t":"action","action":{"type":"endDay"},"seq":1,"__proto__":{"x":1}}'),
    ];
    for (const b of bad) expect(isClientMessage(b), JSON.stringify(b) ?? String(b)).toBe(false);
  });

  it("exposes the action guards separately", () => {
    expect(isGameAction({ type: "endDay" })).toBe(true);
    expect(isBattleAction({ type: "defend" })).toBe(true);
    expect(isBattleAction({ type: "endDay" })).toBe(false);
    expect(isGameAction(Object.create({ type: "endDay" }))).toBe(false);
  });
});

describe("isRoomJoinOptions", () => {
  it("validates join options", () => {
    expect(ROOM_NAME).toBe("match");
    expect(isRoomJoinOptions({ token: "abc", mode: "pvp" })).toBe(true);
    expect(isRoomJoinOptions({ token: "abc", mode: "pvp", mapId: "valley" })).toBe(true);
    expect(isRoomJoinOptions({ token: "", mode: "pvp" })).toBe(false);
    expect(isRoomJoinOptions({ token: "abc", mode: "ai" })).toBe(false);
    expect(isRoomJoinOptions({ token: "abc", mode: "pvp", mapId: 3 })).toBe(false);
    expect(isRoomJoinOptions(null)).toBe(false);
  });
});
