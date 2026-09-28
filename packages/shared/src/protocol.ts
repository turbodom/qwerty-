import type { BattleAction, GameAction, GameEvent, PlayerView } from "./types";
import { UNIT_IDS } from "./data/units";
import { BUILDING_IDS } from "./data/buildings";
import { ARTIFACT_IDS, SLOTS } from "./data/artifacts";
import { SPELL_IDS } from "./data/spells";

export type ClientMessage = { t: "action"; action: GameAction; seq: number };

export type ServerMessage =
  | { t: "view"; view: PlayerView; events: GameEvent[]; ackSeq?: number }
  | { t: "error"; message: string; ackSeq?: number }
  /** End of day by timer, unix ms. */
  | { t: "timer"; endsAt: number };

export interface RoomJoinOptions {
  token: string;
  mode: "pvp";
  mapId?: string;
  /** Private room code for playing with a friend (Colyseus filterBy(["code"])). */
  code?: string;
}

/** Longest accepted friend-room code. */
export const ROOM_CODE_MAX = 16;

export const ROOM_NAME = "match";

export interface AuthResponse {
  token: string;
  user: { uid: string; username: string; premiumUntil: number | null; banner: string | null; owned: string[] };
}

// ================= runtime validation of untrusted client input =================

type Obj = Record<string, unknown>;

/** Largest coordinate / id / seq accepted from a client. */
const MAX_INT = 1_000_000_000;

function isPlainObject(x: unknown): x is Obj {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const proto: unknown = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

/** Own keys are exactly `required` plus any subset of `optional`. */
function hasKeys(o: Obj, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(o);
  for (const k of required) if (!Object.prototype.hasOwnProperty.call(o, k)) return false;
  for (const k of keys) if (!required.includes(k) && !optional.includes(k)) return false;
  return true;
}

function isInt(x: unknown, min = 0, max = MAX_INT): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= min && x <= max;
}

function isOneOf<T extends string>(x: unknown, list: readonly T[]): x is T {
  return typeof x === "string" && (list as readonly string[]).includes(x);
}

function isPoint(x: unknown): boolean {
  return isPlainObject(x) && hasKeys(x, ["x", "y"]) && isInt(x["x"]) && isInt(x["y"]);
}

function isHex(x: unknown): boolean {
  return Array.isArray(x) && x.length === 2 && isInt(x[0]) && isInt(x[1]);
}

const SLOT_IDS = SLOTS.map((s) => s.id);

export function isBattleAction(x: unknown): x is BattleAction {
  if (!isPlainObject(x)) return false;
  switch (x["type"]) {
    case "move":
      return hasKeys(x, ["type", "to"]) && isHex(x["to"]);
    case "attack":
      return (
        hasKeys(x, ["type", "target"], ["from"]) &&
        isInt(x["target"]) &&
        (x["from"] === undefined || isHex(x["from"]))
      );
    case "shoot":
      return hasKeys(x, ["type", "target"]) && isInt(x["target"]);
    case "defend":
      return hasKeys(x, ["type"]);
    case "cast":
      return hasKeys(x, ["type", "spell", "target"]) && isOneOf(x["spell"], SPELL_IDS) && isInt(x["target"]);
    default:
      return false;
  }
}

export function isGameAction(x: unknown): x is GameAction {
  if (!isPlainObject(x)) return false;
  switch (x["type"]) {
    case "move":
      return hasKeys(x, ["type", "to"]) && isPoint(x["to"]);
    case "endDay":
    case "autoBattle":
      return hasKeys(x, ["type"]);
    case "hire":
    case "upgrade":
      return hasKeys(x, ["type", "unit"]) && isOneOf(x["unit"], UNIT_IDS);
    case "build":
      return hasKeys(x, ["type", "building"]) && isOneOf(x["building"], BUILDING_IDS);
    case "equip":
      return hasKeys(x, ["type", "artifact"]) && isOneOf(x["artifact"], ARTIFACT_IDS);
    case "unequip":
      return hasKeys(x, ["type", "slot"]) && isOneOf(x["slot"], SLOT_IDS);
    case "chooseSkill":
      return hasKeys(x, ["type", "index"]) && (x["index"] === 0 || x["index"] === 1);
    case "battle":
      return hasKeys(x, ["type", "action"]) && isBattleAction(x["action"]);
    default:
      return false;
  }
}

/** Strict shape check for messages received from clients (unknown keys are rejected). */
export function isClientMessage(x: unknown): x is ClientMessage {
  return (
    isPlainObject(x) &&
    hasKeys(x, ["t", "action", "seq"]) &&
    x["t"] === "action" &&
    isInt(x["seq"], 0, Number.MAX_SAFE_INTEGER) &&
    isGameAction(x["action"])
  );
}

/** Strict shape check for Colyseus join options. */
export function isRoomJoinOptions(x: unknown): x is RoomJoinOptions {
  return (
    isPlainObject(x) &&
    hasKeys(x, ["token", "mode"], ["mapId", "code"]) &&
    typeof x["token"] === "string" &&
    x["token"].length > 0 &&
    x["token"].length <= 4096 &&
    x["mode"] === "pvp" &&
    (x["mapId"] === undefined || (typeof x["mapId"] === "string" && x["mapId"].length <= 64)) &&
    (x["code"] === undefined ||
      (typeof x["code"] === "string" && x["code"].length > 0 && x["code"].length <= ROOM_CODE_MAX))
  );
}
