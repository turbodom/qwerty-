import type { ArtifactId, SlotId } from "./data/artifacts";
import type { BuildingId } from "./data/buildings";
import type { QuestId } from "./data/quests";
import type { SkillId } from "./data/skills";
import type { SpellId } from "./data/spells";
import type { StatKey } from "./data/stats";
import type { Faction, UnitId } from "./data/units";

// ================= map / game state =================

export type PlayerId = string;
export type Seat = 0 | 1;
export interface Point { x: number; y: number }

export interface ArmyStack {
  unit: UnitId;
  count: number;
  /** Only set in a PlayerView for foreign armies: approximate size (count is then 0). */
  countHint?: string;
}

export type MapObjectKind = "castle" | "mine" | "chest" | "artifact" | "monster";

export interface Hero {
  id: string;
  owner: PlayerId;
  name: string;
  x: number;
  y: number;
  mp: number;
  level: number;
  exp: number;
  alive: boolean;
  /** atk, def, pow = 1; everything else 0; skills add here. */
  base: Record<StatKey, number>;
  equipped: Partial<Record<SlotId, ArtifactId>>;
  bag: ArtifactId[];
  army: ArmyStack[];
}

export interface MapObject {
  id: string;
  kind: MapObjectKind;
  x: number;
  y: number;
  gone?: boolean;
  owner?: PlayerId | null;
  artifact?: ArtifactId;
  army?: ArmyStack[];
  garrison?: ArmyStack[];
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  seat: Seat;
  isAI: boolean;
  faction: Faction;
  gold: number;
  heroId: string;
  castleId: string;
  /** cols*rows string of "0"/"1", row-major. */
  explored: string;
  growth: Partial<Record<UnitId, number>>;
  built: Partial<Record<BuildingId, true>>;
  builtToday: boolean;
  quests: Partial<Record<QuestId, true>>;
  /** Queue of pending skill choices, 2 options each. */
  levelChoices: SkillId[][];
  endedDay: boolean;
  defeated: boolean;
  /** Day on which the player lost the last castle (cleared when a castle is taken back). */
  homelessSince?: number;
  banner?: string;
}

export interface GameState {
  version: 1;
  id: string;
  mapId: string;
  cols: number;
  rows: number;
  terrain: string[];
  day: number;
  rngState: number;
  players: PlayerState[];
  heroes: Record<string, Hero>;
  objects: MapObject[];
  battles: ActiveBattle[];
  winner: PlayerId | null;
  log: string[];
}

export interface PlayerLoadout { startArtifact?: ArtifactId; startGold?: number; banner?: string }

export interface PlayerSetup { id: PlayerId; name: string; isAI: boolean; loadout?: PlayerLoadout }

// ================= actions / events =================

export type GameAction =
  | { type: "move"; to: Point }
  | { type: "endDay" }
  | { type: "hire"; unit: UnitId }
  | { type: "build"; building: BuildingId }
  | { type: "upgrade"; unit: UnitId }
  | { type: "equip"; artifact: ArtifactId }
  | { type: "unequip"; slot: SlotId }
  | { type: "chooseSkill"; index: 0 | 1 }
  | { type: "battle"; action: BattleAction }
  | { type: "autoBattle" };

export type GameEvent =
  | { type: "moved"; heroId: string; path: Point[] }
  | { type: "gold"; player: PlayerId; amount: number; reason: string }
  | { type: "artifact"; player: PlayerId; artifact: ArtifactId }
  /** `sides` (extension): who fights, so events can be routed to participants only. */
  | { type: "battleStart"; battleId: string; sides?: [BattleSide, BattleSide] }
  | { type: "battle"; battleId: string; ev: BattleEvent }
  | { type: "battleEnd"; battleId: string; winner: PlayerId | "neutral"; sides?: [BattleSide, BattleSide] }
  | { type: "level"; player: PlayerId }
  | { type: "quest"; player: PlayerId; quest: QuestId }
  | { type: "newDay"; day: number }
  | { type: "newWeek" }
  | { type: "mine"; player: PlayerId; objectId: string }
  | { type: "defeat"; player: PlayerId }
  | { type: "victory"; player: PlayerId }
  | { type: "toast"; player?: PlayerId; text: string };

export interface ActionResult { ok: boolean; error?: string; events: GameEvent[] }

// ================= battle =================

export type Hex = [number, number];

export interface BattleStack {
  id: number;
  unit: UnitId;
  side: Seat;
  count: number;
  /** HP of the top creature. */
  top: number;
  startCount: number;
  c: number;
  r: number;
  shots: number;
  retal: boolean;
  defending: boolean;
  haste: boolean;
  moraled: boolean;
}

export interface BattleHero { heroId: string; name: string; stats: Record<StatKey, number>; spells: SpellId[] }

export interface Battle {
  id: string;
  cols: 8;
  rows: 11;
  rngState: number;
  round: number;
  stacks: BattleStack[];
  obstacles: Hex[];
  queue: number[];
  active: number | null;
  spellUsed: [boolean, boolean];
  heroes: [BattleHero | null, BattleHero | null];
  over: boolean;
  winnerSide: Seat | null;
}

export type BattleSide = PlayerId | "neutral";

export interface ActiveBattle {
  battle: Battle;
  sides: [BattleSide, BattleSide];
  context: { kind: "monster" | "hero" | "garrison"; objectId?: string; heroIds: string[] };
  /** Extension: sides whose stacks the AI plays (set by the autoBattle action). Neutral and AI players are always automatic. */
  auto?: [boolean, boolean];
}

export type BattleAction =
  | { type: "move"; to: Hex }
  | { type: "attack"; target: number; from?: Hex }
  | { type: "shoot"; target: number }
  | { type: "defend" }
  | { type: "cast"; spell: SpellId; target: number };

export type DamageSource = "melee" | "shot" | "retaliation" | "splash" | "spell";

export type BattleEvent =
  | { type: "move"; stack: number; to: Hex }
  | { type: "damage"; stack: number; amount: number; killed: number; lucky?: boolean; source: DamageSource }
  | { type: "heal"; stack: number; revived: number }
  | { type: "haste"; stack: number }
  | { type: "morale"; stack: number }
  | { type: "death"; stack: number }
  | { type: "turn"; stack: number }
  | { type: "round"; round: number }
  | { type: "end"; winnerSide: Seat };

export interface BattleActionResult { ok: boolean; error?: string; events: BattleEvent[] }

// ================= visibility =================

/** Copy of the state with everything the player cannot see removed. */
export interface PlayerView { you: PlayerId; state: GameState }
