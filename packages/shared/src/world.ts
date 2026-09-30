/**
 * Сезонная Пустошь: one shared world map per season where every player takes sectors, joins a clan and
 * fights for the Citadel in the centre. Pure and deterministic like the rest of `shared`: time comes in
 * as `now` (Unix ms) from the caller, randomness from `WorldState.rngState`, and the state is plain JSON.
 *
 * Battles on the world map are the regular tactical battles, played to the end by the AI for both sides
 * (`autoResolve`), so a player who is offline still defends with the garrisons they left behind.
 */
import { autoResolve, battleSurvivors, createBattle } from "./battle";
import { MAX_ARMY_STACKS } from "./data/rules";
import { UNITS } from "./data/units";
import type { PlayableFaction, UnitId } from "./data/units";
import { heroPower, mergeArmy } from "./hero";
import { createRng } from "./rng";
import type { ArmyStack, PlayerId } from "./types";

// ================= layout and balance =================

export const WORLD_COLS = 9;
export const WORLD_ROWS = 9;

/**
 * Sector grid, row by row: "." wasteland, "m" mine, "r" ruins, "z" contamination zone, "f" fort, "C" the Citadel.
 * The painted world map (public/art/world-map.webp, tools/art/world-layout.cjs) follows this layout.
 */
export const WORLD_LAYOUT: readonly string[] = [
  "r.m.f.m.r",
  ".z..r..z.",
  "m..z.z..m",
  "..zrzrz..",
  "fr.zCz.rf",
  "..zrzrz..",
  "m..z.z..m",
  ".z..r..z.",
  "r.m.f.m.r",
];

export type SectorKind = "waste" | "mine" | "ruins" | "zone" | "fort" | "citadel";
export const SECTOR_KINDS: readonly SectorKind[] = ["waste", "mine", "ruins", "zone", "fort", "citadel"];

const KIND_BY_CHAR: Record<string, SectorKind> = { ".": "waste", m: "mine", r: "ruins", z: "zone", f: "fort", C: "citadel" };

export interface SectorRule {
  /** Gold a day for whoever holds it (a tenth goes to the holder's clan treasury). */
  income: number;
  /** Rating points while held. */
  score: number;
  /** Gold for taking it (only when it was neutral). */
  loot: number;
  /** Share of the winner's survivors that stays behind as the garrison. */
  garrisonShare: number;
  /** Neutral guard at the rim; closer to the centre it grows (see sectorGuard). */
  guard: readonly ArmyStack[];
}

export const SECTOR_RULES: Record<SectorKind, SectorRule> = {
  waste: { income: 60, score: 1, loot: 150, garrisonShare: 0.15, guard: [{ unit: "wolf", count: 24 }] },
  mine: { income: 220, score: 3, loot: 300, garrisonShare: 0.2, guard: [{ unit: "wolf", count: 24 }, { unit: "skeleton", count: 22 }] },
  ruins: { income: 120, score: 2, loot: 500, garrisonShare: 0.2, guard: [{ unit: "skeleton", count: 32 }, { unit: "ghost", count: 8 }] },
  zone: { income: 160, score: 3, loot: 400, garrisonShare: 0.2, guard: [{ unit: "ghost", count: 16 }, { unit: "lich", count: 3 }] },
  fort: { income: 140, score: 5, loot: 300, garrisonShare: 0.35, guard: [{ unit: "pike", count: 40 }, { unit: "archer", count: 20 }, { unit: "griffin", count: 5 }] },
  citadel: {
    income: 600, score: 30, loot: 2000, garrisonShare: 0.5,
    guard: [{ unit: "skeleton", count: 110 }, { unit: "ghost", count: 36 }, { unit: "lich", count: 12 }, { unit: "wolf", count: 70 }],
  },
};

export const WORLD_START_GOLD = 2500;
export const WORLD_START_ARMY: Record<PlayableFaction, readonly ArmyStack[]> = {
  castle: [{ unit: "pike", count: 30 }, { unit: "archer", count: 16 }, { unit: "griffin", count: 2 }],
  necropolis: [{ unit: "skeleton", count: 34 }, { unit: "ghost", count: 7 }],
};
/** Recruits that arrive at a player's camp every world day. */
export const WORLD_DAILY_GROWTH: Record<PlayableFaction, Partial<Record<UnitId, number>>> = {
  castle: { pike: 14, archer: 7, griffin: 2 },
  necropolis: { skeleton: 16, ghost: 5, lich: 1 },
};
/** Recruits never pile up beyond this many days of growth. */
export const WORLD_GROWTH_CAP_DAYS = 5;
export const ENERGY_MAX = 6;
/** Energy points restored per world day (spread evenly over the day). */
export const ENERGY_PER_DAY = 6;
export const CLAN_CREATE_COST = 500;
export const CLAN_MAX_MEMBERS = 20;
export const CLAN_COLORS = 8;
/** Clan treasury spent by the leader to fortify one clan sector. */
export const FORTIFY_COST = 800;
/** Rating points per won battle. */
export const WIN_SCORE = 2;
/** Boss damage (army power destroyed) per rating point. */
export const BOSS_DAMAGE_PER_POINT = 150;
export const BOSS_REWARD = 2500;
export const BOSS_DAYS = 4;
export const CACHE_GOLD = 1200;
export const CACHE_DAYS = 2;
export const WORLD_LOG_LIMIT = 40;
export const HALL_OF_FAME_LIMIT = 20;

export const DEFAULT_WORLD_DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SEASON_DAYS = 28;

// ================= state =================

export interface WorldSector {
  id: number;
  x: number;
  y: number;
  kind: SectorKind;
  /** Player holding it; null = neutral (guarded by monsters). */
  holder: PlayerId | null;
  guard: ArmyStack[];
}

export interface WorldPlayer {
  id: PlayerId;
  name: string;
  faction: PlayableFaction;
  clanId: string | null;
  army: ArmyStack[];
  gold: number;
  energy: number;
  /** Time the energy was last brought up to date (ms). */
  energyAt: number;
  /** Rim sector where the player's camp stands: the first attacks start from here. */
  camp: number;
  growth: Partial<Record<UnitId, number>>;
  wins: number;
  losses: number;
  bossDamage: number;
  bot?: boolean;
}

export interface WorldClan {
  id: string;
  name: string;
  tag: string;
  color: number;
  leader: PlayerId;
  members: PlayerId[];
  treasury: number;
  bot?: boolean;
}

export type WorldEventKind = "boss" | "cache";

export interface WorldEvent {
  id: string;
  kind: WorldEventKind;
  sector: number;
  /** Last world day the event lasts. */
  untilDay: number;
}

export type WorldLogKind = "capture" | "defend" | "boss" | "bossKilled" | "cache" | "clanCreated" | "season" | "fortify";

export interface WorldLogEntry {
  day: number;
  kind: WorldLogKind;
  actor?: string;
  target?: string;
  clan?: string;
  sector?: number;
  amount?: number;
}

export interface HallOfFameEntry {
  season: number;
  clan: string | null;
  tag: string | null;
  player: string | null;
  score: number;
}

export interface WorldState {
  version: 1;
  season: number;
  seed: number;
  rngState: number;
  /** Start of day 1 (ms). */
  startedAt: number;
  dayMs: number;
  seasonDays: number;
  day: number;
  sectors: WorldSector[];
  players: Record<PlayerId, WorldPlayer>;
  clans: Record<string, WorldClan>;
  events: WorldEvent[];
  log: WorldLogEntry[];
  hallOfFame: HallOfFameEntry[];
  nextId: number;
}

export type WorldAction =
  | { type: "join"; faction: PlayableFaction }
  | { type: "attack"; sector: number }
  | { type: "hire" }
  | { type: "reinforce"; sector: number }
  | { type: "withdraw"; sector: number }
  | { type: "createClan"; name: string; tag: string }
  | { type: "joinClan"; clanId: string }
  | { type: "leaveClan" }
  | { type: "donate"; amount: number }
  | { type: "fortify"; sector: number };

export interface WorldBattleReport {
  sector: number;
  won: boolean;
  /** Armies before the battle. */
  attacker: ArmyStack[];
  defender: ArmyStack[];
  attackerLost: ArmyStack[];
  defenderLost: ArmyStack[];
  captured: boolean;
  gold: number;
  boss: boolean;
  bossKilled: boolean;
  /** Name of the player whose sector was attacked (null: monsters). */
  defenderName: string | null;
}

export interface WorldResult {
  ok: boolean;
  error?: string;
  report?: WorldBattleReport;
}

// ================= helpers =================

export function sectorId(x: number, y: number): number {
  return y * WORLD_COLS + x;
}

/** Distance in rings from the centre (0 = the Citadel, 4 = the rim). */
export function sectorRing(x: number, y: number): number {
  const cx = (WORLD_COLS - 1) / 2;
  const cy = (WORLD_ROWS - 1) / 2;
  return Math.max(Math.abs(x - cx), Math.abs(y - cy));
}

export function isRim(x: number, y: number): boolean {
  return x === 0 || y === 0 || x === WORLD_COLS - 1 || y === WORLD_ROWS - 1;
}

/** Sectors touching `id`, diagonals included. */
export function sectorNeighbors(id: number): number[] {
  const x = id % WORLD_COLS;
  const y = Math.floor(id / WORLD_COLS);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < WORLD_COLS && ny < WORLD_ROWS) out.push(sectorId(nx, ny));
    }
  }
  return out;
}

/** Neutral guard of a sector: the kind's base guard, stronger towards the centre. */
export function sectorGuard(kind: SectorKind, x: number, y: number): ArmyStack[] {
  const k = 1 + (4 - sectorRing(x, y)) * 0.35;
  return SECTOR_RULES[kind].guard.map((s) => ({ unit: s.unit, count: Math.max(1, Math.round(s.count * k)) }));
}

export function armyPower(army: readonly ArmyStack[]): number {
  return Math.round(heroPower(army, null));
}

function cloneArmy(army: readonly ArmyStack[]): ArmyStack[] {
  return army.map((s) => ({ unit: s.unit, count: s.count }));
}

/** Units in `before` missing from `after`, per unit. */
function losses(before: readonly ArmyStack[], after: readonly ArmyStack[]): ArmyStack[] {
  const out: ArmyStack[] = [];
  for (const s of mergeArmy(before)) {
    const left = after.filter((a) => a.unit === s.unit).reduce((n, a) => n + a.count, 0);
    if (s.count > left) out.push({ unit: s.unit, count: s.count - left });
  }
  return out;
}

/** Adds `extra` into `army`, keeping at most MAX_ARMY_STACKS unit kinds (extra kinds are dropped). */
function addArmy(army: readonly ArmyStack[], extra: readonly ArmyStack[]): ArmyStack[] {
  const merged = mergeArmy([...army, ...extra]);
  return merged.slice(0, MAX_ARMY_STACKS);
}

function sectorName(s: WorldSector): string {
  return `${s.kind}:${s.x},${s.y}`;
}

export function clanOf(state: WorldState, playerId: PlayerId | null): WorldClan | null {
  if (!playerId) return null;
  const p = state.players[playerId];
  return p?.clanId ? (state.clans[p.clanId] ?? null) : null;
}

/** True when both players are the same player or in the same clan. */
export function allied(state: WorldState, a: PlayerId, b: PlayerId | null): boolean {
  if (!b) return false;
  if (a === b) return true;
  const ca = state.players[a]?.clanId;
  return !!ca && ca === state.players[b]?.clanId;
}

function log(state: WorldState, e: Omit<WorldLogEntry, "day">): void {
  state.log.push({ day: state.day, ...e });
  if (state.log.length > WORLD_LOG_LIMIT) state.log.splice(0, state.log.length - WORLD_LOG_LIMIT);
}

function newId(state: WorldState, prefix: string): string {
  state.nextId++;
  return `${prefix}${state.nextId}`;
}

// ================= scores =================

export function playerScore(state: WorldState, id: PlayerId): number {
  const p = state.players[id];
  if (!p) return 0;
  let s = p.wins * WIN_SCORE + Math.floor(p.bossDamage / BOSS_DAMAGE_PER_POINT);
  for (const sec of state.sectors) if (sec.holder === id) s += SECTOR_RULES[sec.kind].score;
  return s;
}

export function clanScore(state: WorldState, clanId: string): number {
  const c = state.clans[clanId];
  return c ? c.members.reduce((n, m) => n + playerScore(state, m), 0) : 0;
}

export function heldSectors(state: WorldState, id: PlayerId): number {
  return state.sectors.filter((s) => s.holder === id).length;
}

// ================= creation =================

export interface CreateWorldOptions {
  seed: number;
  now: number;
  season?: number;
  dayMs?: number;
  seasonDays?: number;
  /** Carried over from the previous season. */
  hallOfFame?: HallOfFameEntry[];
}

const BOT_CLANS: readonly { name: string; tag: string; faction: PlayableFaction; players: readonly string[]; home: readonly [number, number][] }[] = [
  { name: "Ржавые Шакалы", tag: "ШАК", faction: "necropolis", players: ["Шакал", "Гнилозуб"], home: [[4, 1], [3, 2]] },
  { name: "Дети Атома", tag: "АТОМ", faction: "necropolis", players: ["Проповедник", "Светлячок"], home: [[7, 4], [6, 3]] },
  { name: "Стальной Легион", tag: "ЛЕГ", faction: "castle", players: ["Центурион", "Броня"], home: [[4, 7], [2, 5]] },
];

export function createWorld(opts: CreateWorldOptions): WorldState {
  const sectors: WorldSector[] = [];
  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      const kind = KIND_BY_CHAR[WORLD_LAYOUT[y]?.[x] ?? "."] ?? "waste";
      sectors.push({ id: sectorId(x, y), x, y, kind, holder: null, guard: sectorGuard(kind, x, y) });
    }
  }
  const state: WorldState = {
    version: 1,
    season: opts.season ?? 1,
    seed: opts.seed >>> 0,
    rngState: opts.seed >>> 0,
    startedAt: opts.now,
    dayMs: opts.dayMs ?? DEFAULT_WORLD_DAY_MS,
    seasonDays: opts.seasonDays ?? DEFAULT_SEASON_DAYS,
    day: 1,
    sectors,
    players: {},
    clans: {},
    events: [],
    log: [],
    hallOfFame: opts.hallOfFame ? opts.hallOfFame.map((h) => ({ ...h })) : [],
    nextId: 0,
  };
  // raider clans so the world is never empty: they hold a few sectors and expand every day
  BOT_CLANS.forEach((b, i) => {
    const clanId = `botclan:${i + 1}`;
    const members: PlayerId[] = [];
    b.players.forEach((name, j) => {
      const id = `bot:${i + 1}.${j + 1}`;
      const [hx, hy] = b.home[j] ?? [4, 1];
      const sec = state.sectors[sectorId(hx, hy)];
      state.players[id] = {
        id, name, faction: b.faction, clanId, army: cloneArmy(WORLD_START_ARMY[b.faction]), gold: 0,
        energy: 0, energyAt: opts.now, camp: sec?.id ?? 0, growth: {}, wins: 0, losses: 0, bossDamage: 0, bot: true,
      };
      if (sec) {
        sec.holder = id;
        sec.guard = cloneArmy(sectorGuard(sec.kind, sec.x, sec.y));
      }
      members.push(id);
    });
    state.clans[clanId] = { id: clanId, name: b.name, tag: b.tag, color: CLAN_COLORS - 1 - i, leader: members[0] ?? "", members, treasury: 0, bot: true };
  });
  return state;
}

// ================= time =================

export function dayEndsAt(state: WorldState): number {
  return state.startedAt + state.day * state.dayMs;
}

export function seasonEndsAt(state: WorldState): number {
  return state.startedAt + state.seasonDays * state.dayMs;
}

function energyInterval(state: WorldState): number {
  return Math.max(1, Math.floor(state.dayMs / ENERGY_PER_DAY));
}

/** Brings a player's energy up to `now`. */
function refreshEnergy(state: WorldState, p: WorldPlayer, now: number): void {
  const step = energyInterval(state);
  if (p.energy >= ENERGY_MAX) {
    p.energyAt = Math.max(p.energyAt, now);
    return;
  }
  const gained = Math.floor((now - p.energyAt) / step);
  if (gained <= 0) return;
  p.energy = Math.min(ENERGY_MAX, p.energy + gained);
  p.energyAt = p.energy >= ENERGY_MAX ? now : p.energyAt + gained * step;
}

/** When the next energy point arrives (null at full energy). */
export function nextEnergyAt(state: WorldState, p: WorldPlayer): number | null {
  return p.energy >= ENERGY_MAX ? null : p.energyAt + energyInterval(state);
}

/**
 * Runs every world day that has ended by `now`: income, guard regrowth, recruits, raider moves and world events;
 * past the last day the season ends and a new one starts. Returns the number of days run.
 */
export function advanceWorld(state: WorldState, now: number): number {
  let n = 0;
  for (let guard = 0; guard < 2000 && now >= dayEndsAt(state); guard++) {
    if (state.day >= state.seasonDays) {
      endSeason(state, dayEndsAt(state));
    } else {
      state.day++;
      dailyTick(state);
    }
    n++;
  }
  return n;
}

function dailyTick(state: WorldState): void {
  const rng = createRng(state.rngState);
  // income
  for (const s of state.sectors) {
    if (!s.holder) continue;
    const p = state.players[s.holder];
    if (!p) {
      s.holder = null;
      continue;
    }
    const income = SECTOR_RULES[s.kind].income;
    const clan = p.clanId ? state.clans[p.clanId] : undefined;
    const tithe = clan ? Math.floor(income / 10) : 0;
    p.gold += income - tithe;
    if (clan) clan.treasury += tithe;
  }
  // neutral guards regrow towards their full size
  const bossSectors = new Set(state.events.filter((e) => e.kind === "boss").map((e) => e.sector));
  for (const s of state.sectors) {
    if (s.holder || bossSectors.has(s.id)) continue;
    const full = sectorGuard(s.kind, s.x, s.y);
    s.guard = full.map((f) => {
      const cur = s.guard.find((g) => g.unit === f.unit)?.count ?? 0;
      return { unit: f.unit, count: Math.min(f.count, cur + Math.max(1, Math.ceil(f.count / 5))) };
    });
  }
  // recruits at the camps
  for (const p of Object.values(state.players)) {
    if (p.bot) continue;
    for (const [u, amount] of Object.entries(WORLD_DAILY_GROWTH[p.faction]) as [UnitId, number][]) {
      p.growth[u] = Math.min(amount * WORLD_GROWTH_CAP_DAYS, (p.growth[u] ?? 0) + amount);
    }
  }
  // events end, new ones start
  for (const e of state.events.filter((x) => x.untilDay < state.day)) {
    const s = state.sectors[e.sector];
    if (e.kind === "boss" && s && !s.holder) s.guard = sectorGuard(s.kind, s.x, s.y);
  }
  state.events = state.events.filter((e) => e.untilDay >= state.day);
  const free = (pred: (s: WorldSector) => boolean): WorldSector[] =>
    state.sectors.filter((s) => !s.holder && s.kind !== "citadel" && pred(s) && !state.events.some((e) => e.sector === s.id));
  if (!state.events.some((e) => e.kind === "boss") && state.day % 3 === 2) {
    const spots = free((s) => s.kind === "zone" || s.kind === "ruins");
    if (spots.length) {
      const s = rng.pick(spots);
      s.guard = bossArmy(state.season);
      state.events.push({ id: newId(state, "ev"), kind: "boss", sector: s.id, untilDay: state.day + BOSS_DAYS - 1 });
      log(state, { kind: "boss", sector: s.id });
    }
  }
  if (!state.events.some((e) => e.kind === "cache")) {
    const spots = free((s) => s.kind === "waste" || s.kind === "mine");
    if (spots.length) {
      const s = rng.pick(spots);
      state.events.push({ id: newId(state, "ev"), kind: "cache", sector: s.id, untilDay: state.day + CACHE_DAYS - 1 });
      log(state, { kind: "cache", sector: s.id, amount: CACHE_GOLD });
    }
  }
  state.rngState = rng.state;
  botsAct(state);
}

/** The world boss: a mutant horde that grows a little every season. */
export function bossArmy(season: number): ArmyStack[] {
  const k = 1 + (season - 1) * 0.15;
  return [
    { unit: "wolf", count: Math.round(70 * k) },
    { unit: "ghost", count: Math.round(24 * k) },
    { unit: "lich", count: Math.round(10 * k) },
    { unit: "skeleton", count: Math.round(60 * k) },
  ];
}

/** Most sectors one raider holds before it stops expanding. */
export const BOT_MAX_SECTORS = 4;

/**
 * Every other day each raider takes one weak neutral (or rival raider) sector next to its clan's land, if it is strong
 * enough and holds fewer than BOT_MAX_SECTORS.
 */
function botsAct(state: WorldState): void {
  if (state.day % 2 !== 0) return;
  for (const p of Object.values(state.players)) {
    if (!p.bot || heldSectors(state, p.id) >= BOT_MAX_SECTORS) continue;
    // raiders restock a little every day
    p.army = addArmy(p.army, WORLD_START_ARMY[p.faction].map((s) => ({ unit: s.unit, count: Math.ceil(s.count / 4) })));
    const mine = armyPower(p.army);
    let best: { s: WorldSector; power: number } | null = null;
    for (const id of reachableSectors(state, p.id)) {
      const s = state.sectors[id];
      // raiders never take land from people: they only grab neutral sectors and fight each other
      if (!s || s.kind === "citadel" || (s.holder && !state.players[s.holder]?.bot)) continue;
      if (state.events.some((e) => e.kind === "boss" && e.sector === id)) continue;
      const power = armyPower(s.guard);
      if (power * 1.6 > mine) continue;
      if (!best || power < best.power || (power === best.power && id < best.s.id)) best = { s, power };
    }
    if (best) fight(state, p, best.s);
  }
}

function endSeason(state: WorldState, at: number): void {
  const citadel = state.sectors.find((s) => s.kind === "citadel");
  const clans = Object.values(state.clans);
  let winner: WorldClan | null = citadel?.holder ? clanOf(state, citadel.holder) : null;
  if (!winner) {
    for (const c of clans) if (!winner || clanScore(state, c.id) > clanScore(state, winner.id)) winner = c;
  }
  let topPlayer: WorldPlayer | null = null;
  for (const p of Object.values(state.players)) {
    if (p.bot) continue;
    if (!topPlayer || playerScore(state, p.id) > playerScore(state, topPlayer.id)) topPlayer = p;
  }
  const fame: HallOfFameEntry = {
    season: state.season,
    clan: winner?.name ?? null,
    tag: winner?.tag ?? null,
    player: topPlayer?.name ?? null,
    score: winner ? clanScore(state, winner.id) : 0,
  };
  const hallOfFame = [fame, ...state.hallOfFame].slice(0, HALL_OF_FAME_LIMIT);
  const next = createWorld({
    seed: (state.seed + 0x9e3779b9) >>> 0, now: at, season: state.season + 1, dayMs: state.dayMs, seasonDays: state.seasonDays, hallOfFame,
  });
  // players and their clans carry over; armies, gold and land start fresh
  for (const p of Object.values(state.players)) {
    if (p.bot) continue;
    next.players[p.id] = freshPlayer(next, p.id, p.name, p.faction, at);
  }
  for (const c of clans) {
    if (c.bot) continue;
    next.clans[c.id] = { ...c, members: c.members.filter((m) => next.players[m]), treasury: 0 };
    for (const m of next.clans[c.id]?.members ?? []) {
      const np = next.players[m];
      if (np) np.clanId = c.id;
    }
  }
  next.nextId = state.nextId;
  next.log = [];
  Object.assign(state, next);
  log(state, { kind: "season", clan: fame.clan ?? undefined, actor: fame.player ?? undefined, amount: state.season - 1 });
}

// ================= players =================

/** Rim sector with the fewest camps (ties: the lowest id after a seeded rotation). */
function pickCamp(state: WorldState): number {
  const counts = new Map<number, number>();
  for (const p of Object.values(state.players)) counts.set(p.camp, (counts.get(p.camp) ?? 0) + 1);
  const rim = state.sectors.filter((s) => isRim(s.x, s.y));
  const offset = (state.seed + Object.keys(state.players).length * 7) % rim.length;
  let best = rim[0]?.id ?? 0;
  let bestN = Infinity;
  for (let i = 0; i < rim.length; i++) {
    const s = rim[(offset + i) % rim.length];
    if (!s) continue;
    const n = (counts.get(s.id) ?? 0) + (s.holder && state.players[s.holder]?.bot ? 5 : 0);
    if (n < bestN) {
      best = s.id;
      bestN = n;
    }
  }
  return best;
}

function freshPlayer(state: WorldState, id: PlayerId, name: string, faction: PlayableFaction, now: number): WorldPlayer {
  return {
    id, name, faction, clanId: null, army: cloneArmy(WORLD_START_ARMY[faction]), gold: WORLD_START_GOLD,
    energy: ENERGY_MAX, energyAt: now, camp: pickCamp(state), growth: { ...WORLD_DAILY_GROWTH[faction] }, wins: 0, losses: 0, bossDamage: 0,
  };
}

/** Sectors the player may attack: next to their camp or to land held by them or their clan, not allied. */
export function reachableSectors(state: WorldState, playerId: PlayerId): number[] {
  const p = state.players[playerId];
  if (!p) return [];
  const from = new Set<number>([p.camp]);
  for (const s of state.sectors) if (allied(state, playerId, s.holder)) from.add(s.id);
  const out = new Set<number>();
  if (!allied(state, playerId, state.sectors[p.camp]?.holder ?? null)) out.add(p.camp);
  for (const id of from) {
    for (const n of sectorNeighbors(id)) {
      const s = state.sectors[n];
      if (s && !allied(state, playerId, s.holder)) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

// ================= battles =================

function fight(state: WorldState, p: WorldPlayer, s: WorldSector): WorldBattleReport {
  const boss = state.events.find((e) => e.kind === "boss" && e.sector === s.id);
  const cache = state.events.find((e) => e.kind === "cache" && e.sector === s.id);
  const defenderId = s.holder;
  const defender = defenderId ? state.players[defenderId] ?? null : null;
  const attackerBefore = cloneArmy(p.army);
  const defenderBefore = cloneArmy(s.guard);
  let won: boolean;
  let attackerAfter: ArmyStack[];
  let defenderAfter: ArmyStack[];
  if (!defenderBefore.some((g) => g.count > 0)) {
    won = true;
    attackerAfter = attackerBefore;
    defenderAfter = [];
  } else {
    const rng = createRng(state.rngState);
    const seed = rng.int(0, 0x7fffffff);
    state.rngState = rng.state;
    const b = createBattle({ id: newId(state, "wb"), seed, armies: [attackerBefore, defenderBefore], heroes: [null, null] });
    autoResolve(b);
    won = b.winnerSide === 0;
    attackerAfter = battleSurvivors(b, 0);
    defenderAfter = battleSurvivors(b, 1);
  }
  const report: WorldBattleReport = {
    sector: s.id, won, attacker: attackerBefore, defender: defenderBefore,
    attackerLost: losses(attackerBefore, attackerAfter), defenderLost: losses(defenderBefore, defenderAfter),
    captured: false, gold: 0, boss: !!boss, bossKilled: false, defenderName: defender?.name ?? null,
  };
  if (boss) p.bossDamage += Math.max(0, armyPower(defenderBefore) - armyPower(defenderAfter));
  if (!won) {
    p.army = attackerAfter;
    s.guard = defenderAfter;
    p.losses++;
    if (defender) {
      defender.wins++;
      log(state, { kind: "defend", actor: defender.name, target: p.name, sector: s.id });
    }
    return report;
  }
  p.wins++;
  if (defender) defender.losses++;
  const share = SECTOR_RULES[s.kind].garrisonShare;
  const garrison = attackerAfter.map((a) => ({ unit: a.unit, count: Math.floor(a.count * share) })).filter((a) => a.count > 0);
  if (!garrison.length && attackerAfter[0] && attackerAfter[0].count > 1) garrison.push({ unit: attackerAfter[0].unit, count: 1 });
  p.army = attackerAfter
    .map((a) => ({ unit: a.unit, count: a.count - (garrison.find((g) => g.unit === a.unit)?.count ?? 0) }))
    .filter((a) => a.count > 0);
  s.guard = garrison;
  let gold = defender ? 0 : SECTOR_RULES[s.kind].loot;
  if (cache) {
    gold += CACHE_GOLD;
    state.events = state.events.filter((e) => e !== cache);
  }
  if (boss) {
    gold += BOSS_REWARD;
    report.bossKilled = true;
    state.events = state.events.filter((e) => e !== boss);
    const clan = clanOf(state, p.id);
    if (clan) clan.treasury += BOSS_REWARD;
    log(state, { kind: "bossKilled", actor: p.name, clan: clan?.tag, sector: s.id, amount: BOSS_REWARD });
  }
  p.gold += gold;
  s.holder = p.id;
  report.captured = true;
  report.gold = gold;
  log(state, { kind: "capture", actor: p.name, target: defender?.name, clan: clanOf(state, p.id)?.tag, sector: s.id });
  return report;
}

// ================= actions =================

const CLAN_NAME_RE = /^[\p{L}\p{N} _.-]{3,24}$/u;
const CLAN_TAG_RE = /^[\p{L}\p{N}]{2,4}$/u;

function fail(error: string): WorldResult {
  return { ok: false, error };
}

/**
 * Applies one player action at time `now` (mutates `state`). The world is first advanced to `now`.
 * `actor.name` is the player's display name, refreshed on every action.
 */
export function applyWorldAction(state: WorldState, actor: { id: PlayerId; name: string }, action: WorldAction, now: number): WorldResult {
  advanceWorld(state, now);
  if (actor.id.startsWith("bot:")) return fail("Недопустимый игрок");
  if (action.type === "join") {
    if (state.players[actor.id]) return fail("Вы уже в Пустоши");
    if (action.faction !== "castle" && action.faction !== "necropolis") return fail("Неизвестная фракция");
    state.players[actor.id] = freshPlayer(state, actor.id, actor.name, action.faction, now);
    return { ok: true };
  }
  const p = state.players[actor.id];
  if (!p) return fail("Сначала вступите в Пустошь");
  p.name = actor.name;
  refreshEnergy(state, p, now);
  switch (action.type) {
    case "attack": {
      const s = state.sectors[action.sector];
      if (!s) return fail("Нет такого сектора");
      if (allied(state, p.id, s.holder)) return fail("Этот сектор уже ваш");
      if (!reachableSectors(state, p.id).includes(s.id)) return fail("Сектор слишком далеко: нападать можно рядом со своей землёй");
      if (p.energy < 1) return fail("Нет энергии: она восстанавливается со временем");
      if (!p.army.some((a) => a.count > 0)) return fail("У вас нет армии: наймите отряды в лагере");
      p.energy--;
      if (p.energy === ENERGY_MAX - 1) p.energyAt = now;
      return { ok: true, report: fight(state, p, s) };
    }
    case "hire": {
      let spent = 0;
      const hired: ArmyStack[] = [];
      for (const [u, avail] of Object.entries(p.growth) as [UnitId, number][]) {
        const cost = UNITS[u].cost;
        const n = cost > 0 ? Math.min(avail, Math.floor((p.gold - spent) / cost)) : avail;
        if (n <= 0) continue;
        spent += n * cost;
        hired.push({ unit: u, count: n });
        p.growth[u] = avail - n;
      }
      if (!hired.length) return fail("Некого нанять или не хватает золота");
      p.gold -= spent;
      p.army = addArmy(p.army, hired);
      return { ok: true };
    }
    case "reinforce": {
      const s = state.sectors[action.sector];
      if (!s || s.holder !== p.id) return fail("Подкреплять можно только свои сектора");
      const part = p.army.map((a) => ({ unit: a.unit, count: Math.floor(a.count / 3) })).filter((a) => a.count > 0);
      if (!part.length) return fail("Армия слишком мала для подкрепления");
      p.army = p.army.map((a) => ({ unit: a.unit, count: a.count - (part.find((x) => x.unit === a.unit)?.count ?? 0) })).filter((a) => a.count > 0);
      s.guard = addArmy(s.guard, part);
      return { ok: true };
    }
    case "withdraw": {
      const s = state.sectors[action.sector];
      if (!s || s.holder !== p.id) return fail("Забирать войска можно только из своих секторов");
      // one creature stays behind to hold the sector
      const first = s.guard[0];
      const back = s.guard.map((a, i) => ({ unit: a.unit, count: i === 0 ? a.count - 1 : a.count })).filter((a) => a.count > 0);
      if (!first || !back.length) return fail("В секторе некого забирать");
      const kinds = new Set([...p.army, ...back].map((a) => a.unit));
      if (kinds.size > MAX_ARMY_STACKS) return fail("В армии нет места для новых отрядов");
      p.army = addArmy(p.army, back);
      s.guard = [{ unit: first.unit, count: 1 }];
      return { ok: true };
    }
    case "createClan": {
      if (p.clanId) return fail("Сначала выйдите из своего клана");
      const name = String(action.name ?? "").trim();
      const tag = String(action.tag ?? "").trim().toUpperCase();
      if (!CLAN_NAME_RE.test(name)) return fail("Название клана: от 3 до 24 букв или цифр");
      if (!CLAN_TAG_RE.test(tag)) return fail("Тег клана: от 2 до 4 букв или цифр");
      const clans = Object.values(state.clans);
      if (clans.some((c) => c.name.toLowerCase() === name.toLowerCase() || c.tag === tag)) return fail("Такое название или тег уже заняты");
      if (p.gold < CLAN_CREATE_COST) return fail(`Основать клан стоит ${CLAN_CREATE_COST} золота`);
      p.gold -= CLAN_CREATE_COST;
      const id = newId(state, "clan:");
      const used = new Set(clans.map((c) => c.color));
      let color = 0;
      while (used.has(color) && color < CLAN_COLORS - 1) color++;
      state.clans[id] = { id, name, tag, color: color % CLAN_COLORS, leader: p.id, members: [p.id], treasury: 0 };
      p.clanId = id;
      log(state, { kind: "clanCreated", actor: p.name, clan: tag });
      return { ok: true };
    }
    case "joinClan": {
      if (p.clanId) return fail("Сначала выйдите из своего клана");
      const c = state.clans[action.clanId];
      if (!c || c.bot) return fail("Нет такого клана");
      if (c.members.length >= CLAN_MAX_MEMBERS) return fail("В клане нет мест");
      c.members.push(p.id);
      p.clanId = c.id;
      return { ok: true };
    }
    case "leaveClan": {
      const c = p.clanId ? state.clans[p.clanId] : undefined;
      if (!c) return fail("Вы не в клане");
      c.members = c.members.filter((m) => m !== p.id);
      p.clanId = null;
      if (!c.members.length) delete state.clans[c.id];
      else if (c.leader === p.id) c.leader = c.members[0] ?? "";
      return { ok: true };
    }
    case "donate": {
      const c = p.clanId ? state.clans[p.clanId] : undefined;
      if (!c) return fail("Вы не в клане");
      const amount = Math.floor(Number(action.amount));
      if (!(amount > 0) || amount > p.gold) return fail("Неверная сумма");
      p.gold -= amount;
      c.treasury += amount;
      return { ok: true };
    }
    case "fortify": {
      const c = p.clanId ? state.clans[p.clanId] : undefined;
      if (!c || c.leader !== p.id) return fail("Укреплять сектора может только глава клана");
      const s = state.sectors[action.sector];
      if (!s || !allied(state, p.id, s.holder)) return fail("Укреплять можно только земли клана");
      if (c.treasury < FORTIFY_COST) return fail(`Нужно ${FORTIFY_COST} золота в казне клана`);
      c.treasury -= FORTIFY_COST;
      const add = WORLD_START_ARMY[p.faction].map((a) => ({ unit: a.unit, count: Math.ceil(a.count / 2) }));
      s.guard = addArmy(s.guard, add);
      log(state, { kind: "fortify", actor: p.name, clan: c.tag, sector: s.id });
      return { ok: true };
    }
    default:
      return fail("Неизвестное действие");
  }
}

// ================= view =================

export interface WorldSectorView {
  id: number;
  x: number;
  y: number;
  kind: SectorKind;
  holder: PlayerId | null;
  holderName: string | null;
  clanId: string | null;
  /** Garrison or monsters: exact for your clan's land, sizes only (count 0 + countHint) for the rest. */
  guard: ArmyStack[];
  power: number;
  event: WorldEventKind | null;
  reachable: boolean;
}

export interface WorldClanView {
  id: string;
  name: string;
  tag: string;
  color: number;
  leader: PlayerId;
  members: { id: PlayerId; name: string; score: number }[];
  score: number;
  sectors: number;
  /** Only for your own clan. */
  treasury: number | null;
  bot: boolean;
}

export interface WorldMeView {
  id: PlayerId;
  name: string;
  faction: PlayableFaction;
  clanId: string | null;
  army: ArmyStack[];
  power: number;
  gold: number;
  energy: number;
  energyMax: number;
  nextEnergyAt: number | null;
  camp: number;
  growth: Partial<Record<UnitId, number>>;
  wins: number;
  losses: number;
  bossDamage: number;
  score: number;
  rank: number;
}

export interface WorldRatingRow {
  id: PlayerId;
  name: string;
  clanTag: string | null;
  score: number;
  sectors: number;
  bot: boolean;
}

export interface WorldView {
  season: number;
  day: number;
  seasonDays: number;
  dayEndsAt: number;
  seasonEndsAt: number;
  now: number;
  cols: number;
  rows: number;
  sectors: WorldSectorView[];
  me: WorldMeView | null;
  clans: WorldClanView[];
  rating: WorldRatingRow[];
  events: WorldEvent[];
  log: WorldLogEntry[];
  hallOfFame: HallOfFameEntry[];
  players: number;
}

function hideCounts(army: readonly ArmyStack[]): ArmyStack[] {
  return army.map((a) => ({ unit: a.unit, count: 0, countHint: countHint(a.count) }));
}

/** Rough size in words-free buckets, like the adventure map's approxCount. */
export function countHint(n: number): string {
  if (n < 5) return "1-4";
  if (n < 10) return "5-9";
  if (n < 20) return "10-19";
  if (n < 50) return "20-49";
  if (n < 100) return "50-99";
  return "100+";
}

/** What one player sees (after advancing the world to `now`; energy is brought up to date too). */
export function worldView(state: WorldState, playerId: PlayerId | null, now: number): WorldView {
  advanceWorld(state, now);
  const me = playerId ? state.players[playerId] : undefined;
  if (me) refreshEnergy(state, me, now);
  const reach = new Set(me ? reachableSectors(state, me.id) : []);
  const rows: WorldRatingRow[] = Object.values(state.players)
    .map((p) => ({
      id: p.id, name: p.name, clanTag: p.clanId ? state.clans[p.clanId]?.tag ?? null : null,
      score: playerScore(state, p.id), sectors: heldSectors(state, p.id), bot: !!p.bot,
    }))
    .sort((a, b) => b.score - a.score || b.sectors - a.sectors || a.name.localeCompare(b.name));
  const clans: WorldClanView[] = Object.values(state.clans)
    .map((c) => ({
      id: c.id, name: c.name, tag: c.tag, color: c.color, leader: c.leader,
      members: c.members.map((m) => ({ id: m, name: state.players[m]?.name ?? "?", score: playerScore(state, m) })),
      score: clanScore(state, c.id),
      sectors: state.sectors.filter((s) => s.holder && c.members.includes(s.holder)).length,
      treasury: me?.clanId === c.id ? c.treasury : null,
      bot: !!c.bot,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return {
    season: state.season,
    day: state.day,
    seasonDays: state.seasonDays,
    dayEndsAt: dayEndsAt(state),
    seasonEndsAt: seasonEndsAt(state),
    now,
    cols: WORLD_COLS,
    rows: WORLD_ROWS,
    sectors: state.sectors.map((s) => {
      const own = me ? allied(state, me.id, s.holder) : false;
      const ev = state.events.find((e) => e.sector === s.id);
      return {
        id: s.id, x: s.x, y: s.y, kind: s.kind, holder: s.holder,
        holderName: s.holder ? state.players[s.holder]?.name ?? null : null,
        clanId: s.holder ? state.players[s.holder]?.clanId ?? null : null,
        guard: own ? cloneArmy(s.guard) : hideCounts(s.guard),
        power: armyPower(s.guard),
        event: ev?.kind ?? null,
        reachable: reach.has(s.id),
      };
    }),
    me: me
      ? {
          id: me.id, name: me.name, faction: me.faction, clanId: me.clanId, army: cloneArmy(me.army), power: armyPower(me.army),
          gold: me.gold, energy: me.energy, energyMax: ENERGY_MAX, nextEnergyAt: nextEnergyAt(state, me), camp: me.camp,
          growth: { ...me.growth }, wins: me.wins, losses: me.losses, bossDamage: me.bossDamage,
          score: playerScore(state, me.id), rank: rows.findIndex((r) => r.id === me.id) + 1,
        }
      : null,
    clans,
    rating: rows.slice(0, 30),
    events: state.events.map((e) => ({ ...e })),
    log: state.log.slice(-30).map((e) => ({ ...e })),
    hallOfFame: state.hallOfFame.map((h) => ({ ...h })),
    players: Object.values(state.players).filter((p) => !p.bot).length,
  };
}

/** Sector label for logs and errors (kind and coordinates). */
export function describeSector(state: WorldState, id: number): string {
  const s = state.sectors[id];
  return s ? sectorName(s) : String(id);
}
