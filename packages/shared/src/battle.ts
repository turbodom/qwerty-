import { createRng } from "./rng";
import type { Rng } from "./rng";
import { UNITS } from "./data/units";
import { SPELLS, boltDamage, healAmount, HASTE_BONUS } from "./data/spells";
import type { SpellId } from "./data/spells";
import type { StatKey } from "./data/stats";
import { mergeArmy } from "./hero";
import type {
  ArmyStack, Battle, BattleAction, BattleActionResult, BattleEvent, BattleHero, BattleStack, DamageSource, Hex, Seat,
} from "./types";

// ================= grid =================

export const BATTLE_COLS = 8;
export const BATTLE_ROWS = 11;
/** Number of obstacles placed in rows 3..7. */
export const BATTLE_OBSTACLES = 4;
/** Shots at a target farther than this deal half damage. */
export const FULL_RANGE = 6;
/** Deployment columns per side (prototype makeBattle). */
const DEPLOY_COLS: readonly [readonly number[], readonly number[]] = [[1, 3, 5, 7, 0], [0, 2, 4, 6, 7]];

/** Odd-r offset -> cube coordinates. */
function toCube(c: number, r: number): [number, number, number] {
  const q = c - (r - (r & 1)) / 2;
  return [q, r, -q - r];
}

/** Hex distance on the odd-r offset grid. */
export function hexDistance(a: Hex, b: Hex): number {
  const A = toCube(a[0], a[1]);
  const B = toCube(b[0], b[1]);
  return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2]));
}

const ODD_DIRS: readonly Hex[] = [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]];
const EVEN_DIRS: readonly Hex[] = [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];

/** In-bounds neighbours of a hex, in the prototype's order. */
export function hexNeighbors(c: number, r: number): Hex[] {
  const dirs = r % 2 ? ODD_DIRS : EVEN_DIRS;
  const out: Hex[] = [];
  for (const [dc, dr] of dirs) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc >= 0 && nr >= 0 && nc < BATTLE_COLS && nr < BATTLE_ROWS) out.push([nc, nr]);
  }
  return out;
}

const hexKey = (c: number, r: number): string => `${c},${r}`;

function isHex(v: unknown): v is Hex {
  return Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]);
}

// ================= stack helpers =================

export function getStack(b: Battle, id: number): BattleStack | undefined {
  return b.stacks.find((s) => s.id === id);
}

/** Living stacks, optionally of one side, in id order. */
export function aliveStacks(b: Battle, side?: Seat): BattleStack[] {
  return b.stacks.filter((s) => s.count > 0 && (side === undefined || s.side === side));
}

/** The stack whose turn it is, if any. */
export function activeStack(b: Battle): BattleStack | undefined {
  return b.active === null ? undefined : getStack(b, b.active);
}

function heroStat(b: Battle, side: Seat, key: StatKey): number {
  return b.heroes[side]?.stats[key] ?? 0;
}

/** Unit speed + hero spd bonus + haste. */
export function stackSpeed(b: Battle, s: BattleStack): number {
  return UNITS[s.unit].spd + heroStat(b, s.side, "spd") + (s.haste ? HASTE_BONUS : 0);
}

/** Total hit points of a stack. */
function totalHp(s: BattleStack): number {
  return s.count > 0 ? (s.count - 1) * UNITS[s.unit].hp + s.top : 0;
}

function enemySide(side: Seat): Seat {
  return side === 0 ? 1 : 0;
}

function blocked(b: Battle, c: number, r: number, self: BattleStack): boolean {
  if (b.obstacles.some((o) => o[0] === c && o[1] === r)) return true;
  return b.stacks.some((s) => s !== self && s.count > 0 && s.c === c && s.r === r);
}

// ================= creation / rounds =================

export interface CreateBattleOptions {
  id: string;
  seed: number;
  armies: [ArmyStack[], ArmyStack[]];
  heroes: [BattleHero | null, BattleHero | null];
  /**
   * Extension: seed of the obstacle layout only. When given, obstacles come from createRng(layoutSeed)
   * and the combat rng starts at `seed` untouched, so the visible layout reveals nothing about the combat
   * rolls. When absent, obstacles are drawn from `seed` first (the combat rng continues from there).
   */
  layoutSeed?: number;
}

/**
 * Public obstacle-layout seed as in the prototype's makeBattle: `day * 31 + stacks0 * 7 + stacks1`.
 * It depends only on public data, so it leaks nothing about any rng state.
 */
export function battleLayoutSeed(day: number, stacks0: number, stacks1: number): number {
  return (day * 31 + stacks0 * 7 + stacks1) >>> 0;
}

function copyHero(h: BattleHero | null): BattleHero | null {
  return h ? { heroId: h.heroId, name: h.name, stats: { ...h.stats }, spells: h.spells.slice() } : null;
}

/**
 * Builds a battle: side 0 deploys on the bottom row, side 1 on the top row (prototype columns),
 * 4 obstacles in rows 3..7, queue for round 1 built and the first stack made active.
 */
export function createBattle(opts: CreateBattleOptions): Battle {
  const rng = createRng(opts.seed);
  const layoutRng = opts.layoutSeed === undefined ? rng : createRng(opts.layoutSeed);
  const stacks: BattleStack[] = [];
  for (const side of [0, 1] as const) {
    const cols = DEPLOY_COLS[side];
    let i = 0;
    for (const a of opts.armies[side]) {
      if (!(a.count > 0) || !UNITS[a.unit]) continue;
      const u = UNITS[a.unit];
      const line = Math.floor(i / cols.length);
      const c = cols[i % cols.length] ?? 0;
      const r = side === 0 ? BATTLE_ROWS - 1 - line : line;
      stacks.push({
        id: stacks.length, unit: a.unit, side, count: a.count, top: u.hp, startCount: a.count,
        c, r, shots: u.shots ?? 0, retal: true, defending: false, haste: false, moraled: false,
      });
      i++;
    }
  }
  const obstacles: Hex[] = [];
  for (let guard = 0; obstacles.length < BATTLE_OBSTACLES && guard < 200; guard++) {
    const c = layoutRng.int(0, BATTLE_COLS - 1);
    const r = layoutRng.int(3, 7);
    if (!obstacles.some((o) => o[0] === c && o[1] === r)) obstacles.push([c, r]);
  }
  const b: Battle = {
    id: opts.id, cols: 8, rows: 11, rngState: rng.state, round: 1, stacks, obstacles,
    queue: [], active: null, spellUsed: [false, false],
    heroes: [copyHero(opts.heroes[0]), copyHero(opts.heroes[1])],
    over: false, winnerSide: null,
  };
  const ev: BattleEvent[] = [];
  if (!checkEnd(b, ev)) {
    newRound(b);
    beginNextTurn(b, ev);
  }
  return b;
}

/** Sort stack ids by speed (desc), side 0 first on ties, then id. */
function sortQueue(b: Battle, ids: number[]): number[] {
  const spd = (id: number): number => {
    const s = getStack(b, id);
    return s ? stackSpeed(b, s) : 0;
  };
  return ids.slice().sort((x, y) => {
    const sx = getStack(b, x);
    const sy = getStack(b, y);
    return spd(y) - spd(x) || (sx?.side ?? 0) - (sy?.side ?? 0) || x - y;
  });
}

function newRound(b: Battle): void {
  for (const s of b.stacks) {
    s.retal = true;
    s.haste = false;
    s.moraled = false;
  }
  b.queue = sortQueue(b, aliveStacks(b).map((s) => s.id));
  b.spellUsed = [false, false];
}

/** Pops the next living stack (starting a new round when the queue runs out) and makes it active. */
function beginNextTurn(b: Battle, ev: BattleEvent[]): void {
  if (b.over) return;
  for (let guard = 0; guard < 1000; guard++) {
    if (b.queue.length === 0) {
      b.round++;
      newRound(b);
      ev.push({ type: "round", round: b.round });
      if (b.queue.length === 0) break;
    }
    const id = b.queue.shift();
    const s = id === undefined ? undefined : getStack(b, id);
    if (s && s.count > 0) {
      s.defending = false;
      b.active = s.id;
      ev.push({ type: "turn", stack: s.id });
      return;
    }
  }
  b.active = null;
}

/** Marks the battle over when a side has no living stacks. Returns true if over. */
function checkEnd(b: Battle, ev: BattleEvent[]): boolean {
  if (b.over) return true;
  const a0 = aliveStacks(b, 0).length;
  const a1 = aliveStacks(b, 1).length;
  if (a0 > 0 && a1 > 0) return false;
  finish(b, a0 > 0 ? 0 : 1, ev);
  return true;
}

function finish(b: Battle, winner: Seat, ev: BattleEvent[]): void {
  b.over = true;
  b.winnerSide = winner;
  b.active = null;
  b.queue = [];
  ev.push({ type: "end", winnerSide: winner });
}

// ================= movement / shooting =================

/** Hexes the stack can reach this turn: key "c,r" -> steps. Includes its own hex at 0. */
export function reachable(b: Battle, stackId: number): Record<string, number> {
  const s = getStack(b, stackId);
  const out: Record<string, number> = {};
  if (!s || s.count <= 0) return out;
  const sp = stackSpeed(b, s);
  out[hexKey(s.c, s.r)] = 0;
  if (UNITS[s.unit].fly) {
    for (let r = 0; r < BATTLE_ROWS; r++) {
      for (let c = 0; c < BATTLE_COLS; c++) {
        const d = hexDistance([s.c, s.r], [c, r]);
        if (d <= sp && !blocked(b, c, r, s)) out[hexKey(c, r)] ??= d;
      }
    }
    return out;
  }
  const q: Hex[] = [[s.c, s.r]];
  for (let head = 0; head < q.length; head++) {
    const p = q[head] as Hex;
    const d0 = out[hexKey(p[0], p[1])] ?? 0;
    if (d0 >= sp) continue;
    for (const n of hexNeighbors(p[0], p[1])) {
      const k = hexKey(n[0], n[1]);
      if (k in out || blocked(b, n[0], n[1], s)) continue;
      out[k] = d0 + 1;
      q.push(n);
    }
  }
  return out;
}

function adjacentEnemy(b: Battle, s: BattleStack): boolean {
  return aliveStacks(b, enemySide(s.side)).some((e) => hexDistance([s.c, s.r], [e.c, e.r]) === 1);
}

/** Shooter with shots left and no enemy adjacent. */
export function canShoot(b: Battle, stackId: number): boolean {
  const s = getStack(b, stackId);
  if (!s || s.count <= 0) return false;
  return !!UNITS[s.unit].shots && s.shots > 0 && !adjacentEnemy(b, s);
}

// ================= damage =================

/** Damage multiplier of attacker vs target (attack/defence, defending, range, antiFly, dmgPct). */
export function damageMultiplier(b: Battle, a: BattleStack, t: BattleStack, ranged: boolean): number {
  const ua = UNITS[a.unit];
  const ut = UNITS[t.unit];
  const A = ua.atk + heroStat(b, a.side, "atk");
  let D = ut.def + heroStat(b, t.side, "def");
  if (t.defending) D = Math.round(D * 1.3);
  let mult = A >= D ? Math.min(4, 1 + 0.05 * (A - D)) : Math.max(0.3, 1 - 0.025 * (D - A));
  if (ranged && hexDistance([a.c, a.r], [t.c, t.r]) > FULL_RANGE) mult *= 0.5;
  if (ua.antiFly && ut.fly) mult *= 1.5;
  return mult * (1 + heroStat(b, a.side, "dmgPct") / 100);
}

/** Rolled damage before luck: up to 10 rolls scaled to the stack size (prototype calcDamage). */
function rollDamage(b: Battle, a: BattleStack, t: BattleStack, ranged: boolean, rng: Rng): number {
  const ua = UNITS[a.unit];
  const rolls = Math.min(a.count, 10);
  if (rolls <= 0) return 0;
  let base = 0;
  for (let i = 0; i < rolls; i++) base += rng.int(ua.dmg[0], ua.dmg[1]);
  base = (base * a.count) / rolls;
  return Math.max(1, Math.round(base * damageMultiplier(b, a, t, ranged)));
}

function killsFor(t: BattleStack, dmg: number): number {
  const hp = UNITS[t.unit].hp;
  const left = totalHp(t) - dmg;
  return left <= 0 ? t.count : t.count - Math.ceil(left / hp);
}

/** Damage and kill range for the UI (luck excluded). Zeroes for invalid ids. */
export function previewAttack(
  b: Battle, attacker: number, target: number, ranged: boolean,
): { minDmg: number; maxDmg: number; minKill: number; maxKill: number } {
  const a = getStack(b, attacker);
  const t = getStack(b, target);
  if (!a || !t || a.count <= 0 || t.count <= 0) return { minDmg: 0, maxDmg: 0, minKill: 0, maxKill: 0 };
  const ua = UNITS[a.unit];
  const m = damageMultiplier(b, a, t, ranged);
  const minDmg = Math.max(1, Math.round(a.count * ua.dmg[0] * m));
  const maxDmg = Math.max(1, Math.round(a.count * ua.dmg[1] * m));
  return { minDmg, maxDmg, minKill: killsFor(t, minDmg), maxKill: killsFor(t, maxDmg) };
}

/** Applies damage to a stack, emits damage (+death) events, returns creatures killed. */
function dealDamage(
  t: BattleStack, dmg: number, source: DamageSource, ev: BattleEvent[], lucky = false,
): number {
  const hp = UNITS[t.unit].hp;
  const before = t.count;
  const tot = totalHp(t);
  const left = tot - dmg;
  if (left <= 0) {
    t.count = 0;
    t.top = 0;
  } else {
    t.count = Math.ceil(left / hp);
    t.top = left - (t.count - 1) * hp;
  }
  const killed = before - t.count;
  const e: BattleEvent = { type: "damage", stack: t.id, amount: Math.min(dmg, tot), killed, source };
  if (lucky) e.lucky = true;
  ev.push(e);
  if (t.count === 0) ev.push({ type: "death", stack: t.id });
  return killed;
}

/** One attack: luck, splash, retaliation, ammo (prototype strike). */
function strike(b: Battle, a: BattleStack, t: BattleStack, ranged: boolean, rng: Rng, ev: BattleEvent[]): void {
  const ua = UNITS[a.unit];
  let d = rollDamage(b, a, t, ranged, rng);
  const luck = heroStat(b, a.side, "luck") * 0.1;
  const lucky = luck > 0 && rng.next() < luck;
  if (lucky) d *= 2;
  dealDamage(t, d, ranged ? "shot" : "melee", ev, lucky);
  if (ua.splash) {
    for (const o of aliveStacks(b, t.side)) {
      if (o === t || hexDistance([o.c, o.r], [t.c, t.r]) !== 1) continue;
      dealDamage(o, Math.round(rollDamage(b, a, o, ranged, rng) / 2), "splash", ev);
    }
  }
  if (!ranged && t.count > 0 && t.retal && !ua.noRetal) {
    if (!UNITS[t.unit].unlimRetal) t.retal = false;
    dealDamage(a, rollDamage(b, t, a, false, rng), "retaliation", ev);
  }
  if (ranged) a.shots--;
  checkEnd(b, ev);
}

/** Morale: chance morale*10% for one extra turn per round (prototype afterAct). */
function afterAct(b: Battle, s: BattleStack, rng: Rng, ev: BattleEvent[]): void {
  if (b.over || s.count <= 0 || s.moraled) return;
  const chance = heroStat(b, s.side, "morale") * 0.1;
  if (chance > 0 && rng.next() < chance) {
    s.moraled = true;
    b.queue.unshift(s.id);
    ev.push({ type: "morale", stack: s.id });
  }
}

// ================= spells =================

/** Bolt damage of a hero (rounded to whole hit points). */
export function heroBoltDamage(h: BattleHero): number {
  return Math.max(1, Math.round(boltDamage(h.stats.pow ?? 0, h.stats.boltX ?? 0)));
}

/** Why the active side cannot cast `spell` on `target` now, or null if it can. */
export function castError(b: Battle, spell: SpellId, target: number): string | null {
  const s = activeStack(b);
  if (b.over || !s) return "Бой окончен";
  const hero = b.heroes[s.side];
  if (!hero) return "Нет героя, чтобы колдовать";
  const def = SPELLS[spell];
  if (!def || !hero.spells.includes(spell)) return "Герой не знает этого заклинания";
  if (b.spellUsed[s.side]) return "В этом раунде уже колдовали";
  const t = getStack(b, target);
  if (!t || t.count <= 0) return "Нет такого отряда";
  if (def.target === "enemy" && t.side === s.side) return "Выберите вражеский отряд";
  if (def.target === "ally" && t.side !== s.side) return "Выберите свой отряд";
  return null;
}

function cast(b: Battle, side: Seat, hero: BattleHero, spell: SpellId, t: BattleStack, ev: BattleEvent[]): void {
  b.spellUsed[side] = true;
  if (spell === "bolt") {
    dealDamage(t, heroBoltDamage(hero), "spell", ev);
    checkEnd(b, ev);
  } else if (spell === "heal") {
    const hp = UNITS[t.unit].hp;
    const tot = Math.min(t.startCount * hp, totalHp(t) + healAmount(hero.stats.pow ?? 0));
    const before = t.count;
    t.count = Math.ceil(tot / hp);
    t.top = tot - (t.count - 1) * hp;
    ev.push({ type: "heal", stack: t.id, revived: t.count - before });
  } else {
    // As in the prototype, haste only extends movement (reachable) until the end of the round;
    // the turn order of the current round is not changed.
    t.haste = true;
    ev.push({ type: "haste", stack: t.id });
  }
}

// ================= actions =================

/**
 * Internal AI-only choice "stay": the stack keeps its hex and ends its turn without defending
 * (the morale roll still happens), as the prototype's aiAct does when no hex gets it closer.
 */
type AiChoice = BattleAction | { type: "stay" };

/** Validates and applies an action of the active stack. Mutates `b`; nothing changes on error. */
export function applyBattleAction(b: Battle, action: BattleAction): BattleActionResult {
  if ((action as { type?: unknown } | null)?.type === "stay") return { ok: false, error: "Неизвестное действие", events: [] };
  return applyChoice(b, action);
}

function applyChoice(b: Battle, action: AiChoice): BattleActionResult {
  const fail = (error: string): BattleActionResult => ({ ok: false, error, events: [] });
  if (b.over) return fail("Бой окончен");
  const s = activeStack(b);
  if (!s || s.count <= 0) return fail("Нет активного отряда");
  const ev: BattleEvent[] = [];
  const rng = createRng(b.rngState);
  const endTurn = (morale: boolean): void => {
    if (morale) afterAct(b, s, rng, ev);
    beginNextTurn(b, ev);
  };

  switch (action?.type) {
    case "move": {
      if (!isHex(action.to)) return fail("Неверная клетка");
      const [c, r] = action.to;
      if (c === s.c && r === s.r) return fail("Отряд уже здесь");
      if (!(hexKey(c, r) in reachable(b, s.id))) return fail("Сюда не дойти за этот ход");
      s.c = c;
      s.r = r;
      ev.push({ type: "move", stack: s.id, to: [c, r] });
      endTurn(true);
      break;
    }
    case "attack": {
      const t = getStack(b, action.target);
      if (!t || t.count <= 0 || t.side === s.side) return fail("Выберите вражеский отряд");
      if (canShoot(b, s.id)) return fail("Стрелки стреляют, а не бьют вблизи");
      const rm = reachable(b, s.id);
      let from: Hex | null = null;
      if (action.from !== undefined) {
        if (!isHex(action.from)) return fail("Неверная клетка");
        const f = action.from;
        if (!(hexKey(f[0], f[1]) in rm) || hexDistance(f, [t.c, t.r]) !== 1) return fail("Отсюда не ударить");
        from = [f[0], f[1]];
      } else {
        let best = Infinity;
        for (const n of hexNeighbors(t.c, t.r)) {
          const d = rm[hexKey(n[0], n[1])];
          if (d !== undefined && d < best) {
            best = d;
            from = n;
          }
        }
      }
      if (!from) return fail("Не дотянуться. Подойдите ближе");
      if (from[0] !== s.c || from[1] !== s.r) {
        s.c = from[0];
        s.r = from[1];
        ev.push({ type: "move", stack: s.id, to: [from[0], from[1]] });
      }
      strike(b, s, t, false, rng, ev);
      endTurn(true);
      break;
    }
    case "shoot": {
      const t = getStack(b, action.target);
      if (!t || t.count <= 0 || t.side === s.side) return fail("Выберите вражеский отряд");
      if (!canShoot(b, s.id)) return fail("Отряд не может стрелять");
      strike(b, s, t, true, rng, ev);
      endTurn(true);
      break;
    }
    case "defend": {
      s.defending = true;
      endTurn(false);
      break;
    }
    case "stay":
      endTurn(true);
      break;
    case "cast": {
      const err = castError(b, action.spell, action.target);
      if (err) return fail(err);
      const hero = b.heroes[s.side] as BattleHero;
      cast(b, s.side, hero, action.spell, getStack(b, action.target) as BattleStack, ev);
      break;
    }
    default:
      return fail("Неизвестное действие");
  }
  b.rngState = rng.state;
  return { ok: true, events: ev };
}

// ================= AI =================

/** AI value of an attack (prototype expected()). */
function expectedValue(b: Battle, a: BattleStack, t: BattleStack, ranged: boolean): number {
  const ua = UNITS[a.unit];
  const avg = ((ua.dmg[0] + ua.dmg[1]) / 2) * a.count;
  const dmg = avg * damageMultiplier(b, a, t, ranged);
  const tot = totalHp(t);
  return Math.min(dmg, tot) * (1 + UNITS[t.unit].atk / 10) + (dmg >= tot ? 40 : 0);
}

/**
 * Action for the active stack (prototype aiAct). Casts bolt first when the hero can; then shoots, attacks or advances.
 * When the stack cannot get any closer, the prototype AI just stays put; that has no public BattleAction, so
 * this returns the nearest legal one, { type: "defend" }. The engine itself plays AI turns with
 * applyAiBattleAction, which keeps the prototype behaviour (no defence bonus, morale still rolled).
 */
export function chooseAiBattleAction(b: Battle): BattleAction {
  const c = aiChoice(b);
  return c.type === "stay" ? { type: "defend" } : c;
}

/** Plays the active stack's turn (or its spell) with the AI, exactly like the prototype's aiAct + afterAct. */
export function applyAiBattleAction(b: Battle): BattleActionResult {
  const res = applyChoice(b, aiChoice(b));
  return res.ok ? res : applyChoice(b, { type: "defend" });
}

function aiChoice(b: Battle): AiChoice {
  const s = activeStack(b);
  if (b.over || !s) return { type: "defend" };
  const foes = aliveStacks(b, enemySide(s.side));
  if (foes.length === 0) return { type: "defend" };

  const h = b.heroes[s.side];
  if (h && !b.spellUsed[s.side] && (h.stats.pow ?? 0) > 0 && h.spells.includes("bolt")) {
    const bolt = heroBoltDamage(h);
    let tgt: BattleStack | null = null;
    let best = -Infinity;
    for (const f of foes) {
      const v = Math.min(totalHp(f), bolt) * UNITS[f.unit].atk;
      if (v > best) {
        best = v;
        tgt = f;
      }
    }
    if (tgt) return { type: "cast", spell: "bolt", target: tgt.id };
  }

  if (canShoot(b, s.id)) {
    let tgt = foes[0] as BattleStack;
    let best = -Infinity;
    for (const f of foes) {
      const v = expectedValue(b, s, f, true);
      if (v > best) {
        best = v;
        tgt = f;
      }
    }
    return { type: "shoot", target: tgt.id };
  }

  const rm = reachable(b, s.id);
  let bestA: { e: BattleStack; n: Hex; sc: number } | null = null;
  for (const e of foes) {
    for (const n of hexNeighbors(e.c, e.r)) {
      const d = rm[hexKey(n[0], n[1])];
      if (d === undefined) continue;
      const sc = expectedValue(b, s, e, false) - d * 0.5;
      if (!bestA || sc > bestA.sc) bestA = { e, n, sc };
    }
  }
  if (bestA) return { type: "attack", target: bestA.e.id, from: bestA.n };

  let near = foes[0] as BattleStack;
  for (const f of foes) {
    if (hexDistance([s.c, s.r], [f.c, f.r]) < hexDistance([s.c, s.r], [near.c, near.r])) near = f;
  }
  let bestM: { p: Hex; d: number } | null = null;
  for (const k of Object.keys(rm)) {
    const [c, r] = k.split(",").map(Number) as [number, number];
    const d = hexDistance([c, r], [near.c, near.r]);
    if (!bestM || d < bestM.d) bestM = { p: [c, r], d };
  }
  if (bestM && (bestM.p[0] !== s.c || bestM.p[1] !== s.r)) return { type: "move", to: bestM.p };
  return { type: "stay" };
}

/** Maximum number of actions autoResolve performs before forcing a result. */
export const AUTO_RESOLVE_LIMIT = 2000;

/**
 * Plays the battle to the end with the AI for both sides. If the iteration guard is hit,
 * the side with more total hit points left wins (side 1, the defender, on a tie).
 */
export function autoResolve(b: Battle): BattleEvent[] {
  const all: BattleEvent[] = [];
  for (let i = 0; !b.over && i < AUTO_RESOLVE_LIMIT; i++) {
    const res = applyAiBattleAction(b);
    for (const e of res.events) all.push(e);
    if (!res.ok) break;
  }
  if (!b.over) {
    const hp = (side: Seat): number => aliveStacks(b, side).reduce((sum, s) => sum + totalHp(s), 0);
    finish(b, hp(0) > hp(1) ? 0 : 1, all);
  }
  return all;
}

// ================= results =================

/** Surviving creatures of a side, merged by unit. */
export function battleSurvivors(b: Battle, side: Seat): ArmyStack[] {
  return mergeArmy(aliveStacks(b, side).map((s) => ({ unit: s.unit, count: s.count })));
}

/** Experience earned by `side`: hit points of enemy creatures killed (prototype xpFrom). */
export function battleExp(b: Battle, side: Seat): number {
  let xp = 0;
  for (const s of b.stacks) if (s.side !== side) xp += Math.max(0, s.startCount - s.count) * UNITS[s.unit].hp;
  return xp;
}
