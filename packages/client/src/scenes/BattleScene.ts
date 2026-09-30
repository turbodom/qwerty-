import Phaser from "phaser";
import {
  SPELLS, UNITS, activeStack, battleLayoutSeed, canShoot, createBattle, getStack, hexDistance, hexNeighbors,
  previewAttack, reachable,
} from "@korony/shared";
import type {
  ActiveBattle, ArmyStack, Battle, BattleAction, BattleEvent, BattleSide, BattleStack, GameEvent, Hex, PlayerView,
  Seat, SpellId,
} from "@korony/shared";
import { sfx } from "../audio";
import { bridge } from "../game/bridge";
import { mySide, ownerColor } from "../game/helpers";
import type { ColorKey } from "../gfx/keys";
import {
  BATTLE_H, BATTLE_K, BATTLE_MARGIN, BATTLE_W, HEX_R, HEX_W, TEX, originOf, unitKey,
} from "../gfx/keys";
import type { BattleField } from "../gfx/keys";
import { t } from "../i18n";
import { unitName } from "../i18n/catalog";

type Img = Phaser.GameObjects.Image;

const K = BATTLE_K;
const OX = BATTLE_MARGIN + HEX_W / 2;
const OY = BATTLE_MARGIN + HEX_R;
const COLS = 8;
const ROWS = 11;

/** Hero duels burn in the ruined city, sieges hit a fortified outpost, undead lurk in the toxic zone, beasts in the forest. */
function battleField(ab: ActiveBattle): BattleField {
  if (ab.context.kind === "hero") return "battle-bg";
  if (ab.context.kind === "garrison") return "battle-bg-fort";
  return ab.battle.stacks.some((s) => UNITS[s.unit].faction === "necropolis") ? "battle-bg-toxic" : "battle-bg-forest";
}

const BADGE: Record<ColorKey, number> = { blue: 0x1d3050, red: 0x4d1a15, grey: 0x3a3631 };

interface StackView {
  container: Phaser.GameObjects.Container;
  icon: Img;
  flash: Phaser.GameObjects.Arc;
  count: Phaser.GameObjects.Text;
  defend: Phaser.GameObjects.Rectangle;
  haste: Phaser.GameObjects.Triangle;
}

export interface BattleSceneData {
  view: PlayerView;
  battleId: string;
  events: readonly GameEvent[];
  onReady: (scene: BattleScene) => void;
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * The battle as it was when it started: the engine builds it with createBattle from public data
 * (armies in stack order, heroes, and an obstacle layout seeded by day and stack counts), so the client
 * can rebuild it and animate the opening moves. Returns null when the rebuild does not match.
 */
export function reconstructStart(b: Battle): Battle | null {
  const m = /^b(\d+)-/.exec(b.id);
  if (!m) return null;
  const day = Number(m[1]);
  const armies: [ArmyStack[], ArmyStack[]] = [[], []];
  for (const s of [...b.stacks].sort((x, y) => x.id - y.id)) armies[s.side].push({ unit: s.unit, count: s.startCount });
  try {
    const pre = createBattle({
      id: b.id, seed: 1, armies, heroes: b.heroes,
      layoutSeed: battleLayoutSeed(day, armies[0].length, armies[1].length),
    });
    if (pre.stacks.length !== b.stacks.length) return null;
    for (const s of pre.stacks) {
      const o = getStack(b, s.id);
      if (!o || o.unit !== s.unit || o.side !== s.side || o.startCount !== s.startCount) return null;
    }
    const obs = (list: Hex[]): string => list.map((h) => h.join(",")).sort().join(";");
    if (obs(pre.obstacles) !== obs(b.obstacles)) return null;
    return pre;
  } catch {
    return null;
  }
}

/** Tactical battle on an 8x11 hex grid: highlights, previews, tap to move/attack, animated events. */
export class BattleScene extends Phaser.Scene {
  private view!: PlayerView;
  private battleId = "";
  private side: Seat = 0;
  private flip = false;
  private model!: Battle;
  private sides: [BattleSide, BattleSide] = ["neutral", "neutral"];
  private autoSides: [boolean, boolean] = [false, false];
  private hexes: Img[] = [];
  private stacks = new Map<number, StackView>();
  private activeMark!: Img;
  private selMark!: Img;
  private busy = true;
  private selected: number | null = null;
  private spellMode: SpellId | null = null;
  private acting: number | null = null;
  private winnerSide: Seat | null = null;
  private speed = 1;
  /** Stack hit by the last melee attack or shot: it is the one that retaliates. */
  private lastTarget: number | null = null;

  constructor() {
    super("BattleScene");
  }

  create(data: BattleSceneData): void {
    this.view = data.view;
    this.battleId = data.battleId;
    this.stacks = new Map();
    this.hexes = [];
    this.busy = true;
    this.selected = null;
    this.spellMode = null;
    this.winnerSide = null;
    const ab = this.findBattle(data.view);
    if (!ab) {
      data.onReady(this);
      return;
    }
    this.side = mySide(ab, data.view.you);
    this.flip = this.side === 1;
    this.sides = [ab.sides[0], ab.sides[1]];
    this.autoSides = [!!ab.auto?.[0], !!ab.auto?.[1]];
    const started = data.events.some((e) => e.type === "battleStart" && e.battleId === this.battleId);
    this.model = (started ? reconstructStart(ab.battle) : null) ?? clone(ab.battle);
    this.acting = this.model.active;

    this.cameras.main.setBackgroundColor("#2c3a22");
    const field = battleField(ab);
    this.add.image(0, 0, this.textures.exists(field) ? field : TEX.battleBg).setOrigin(0, 0).setDisplaySize(BATTLE_W, BATTLE_H).setDepth(0);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const [x, y] = this.hexCenter(c, r);
        this.hexes.push(this.add.image(x, y, TEX.hex).setDepth(1));
      }
    }
    for (const o of this.model.obstacles) {
      const [x, y] = this.hexCenter(o[0], o[1]);
      const key = (o[0] + o[1]) % 2 ? TEX.rock2 : TEX.rock;
      const org = originOf(key);
      this.add.image(x, y, key).setOrigin(org.x, org.y).setDepth(5 + this.displayRow(o[1]));
    }
    this.ambientSmoke();
    this.ambientEmbers();
    this.activeMark = this.add.image(0, 0, TEX.hexActive).setDepth(3).setVisible(false);
    this.selMark = this.add.image(0, 0, TEX.hexSelect).setDepth(4).setVisible(false);
    for (const s of this.model.stacks) if (s.count > 0) this.stacks.set(s.id, this.makeStack(s));
    this.placeActiveMark();

    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.onTap(wp.x, wp.y);
    });
    this.scale.on("resize", this.layout, this);
    this.events.once("shutdown", () => {
      this.scale.off("resize", this.layout, this);
      bridge.ui?.setBattleBar(null);
    });
    this.layout();
    const name = (s: Seat): string => {
      const h = this.model.heroes[s];
      if (h) return h.name;
      const first = this.model.stacks.find((x) => x.side === s);
      return first ? unitName(first.unit) : t("battle.neutral");
    };
    bridge.hint(t("battle.title", { a: name(this.side), b: name(this.side === 0 ? 1 : 0) }));
    this.updateBar();
    data.onReady(this);
  }

  // ================= public API (Director) =================

  /** Animates this battle's events from the update, then shows the authoritative state. */
  async play(view: PlayerView, events: readonly GameEvent[]): Promise<void> {
    this.view = view;
    if (!this.model) return;
    const evs: BattleEvent[] = [];
    for (const e of events) if (e.type === "battle" && e.battleId === this.battleId) evs.push(e.ev);
    for (const e of events) {
      if (e.type === "battleEnd" && e.battleId === this.battleId) {
        this.winnerSide = e.winner === this.sides[this.side] ? this.side : this.side === 0 ? 1 : 0;
      }
    }
    this.busy = true;
    this.clearSelection();
    this.updateBar();
    this.speed = evs.length > 40 ? 0.4 : evs.length > 16 ? 0.65 : 1;
    for (const ev of evs) {
      if (!this.sys.isActive()) return;
      await this.animate(ev);
    }
    const ab = this.findBattle(view);
    if (ab) {
      this.model = clone(ab.battle);
      this.sides = [ab.sides[0], ab.sides[1]];
      this.autoSides = [!!ab.auto?.[0], !!ab.auto?.[1]];
      this.syncStacks();
      this.busy = false;
    }
    this.refreshTurn();
  }

  /** The battle is no longer in the view (finished). */
  isOver(view: PlayerView): boolean {
    return !this.findBattle(view);
  }

  /** Whether the viewer won, from the battle's end event or, failing that, the game result. */
  won(view: PlayerView): boolean {
    if (this.winnerSide !== null) return this.winnerSide === this.side;
    if (this.model?.winnerSide !== null && this.model?.winnerSide !== undefined) return this.model.winnerSide === this.side;
    return view.state.winner === view.you;
  }

  /** Victory / defeat banner, then resolves. */
  async showResult(won: boolean): Promise<void> {
    if (!this.sys.isActive()) return;
    this.busy = true;
    this.hexes.forEach((h) => h.setTexture(TEX.hex));
    this.activeMark.setVisible(false);
    bridge.ui?.setBattleBar(null);
    sfx(won ? "win" : "lose");
    const accent = won ? 0xd9a946 : 0xc24a3e;
    const band = this.add.rectangle(BATTLE_W / 2, BATTLE_H / 2, BATTLE_W, 150 * K, 0x000000, 0.66).setDepth(900).setAlpha(0);
    const lines = [-1, 1].map((d) =>
      this.add.rectangle(BATTLE_W / 2, BATTLE_H / 2 + d * 75 * K, BATTLE_W, 3 * K, accent, 0.9).setDepth(900).setScale(0, 1),
    );
    const glow = this.add.image(BATTLE_W / 2, BATTLE_H / 2, TEX.smoke).setTint(accent).setBlendMode(Phaser.BlendModes.ADD).setDepth(900).setAlpha(0).setScale(9, 3);
    this.tweens.add({ targets: band, alpha: 1, duration: 200 });
    this.tweens.add({ targets: lines, scaleX: 1, duration: 360, ease: "Cubic.easeOut" });
    this.tweens.add({ targets: glow, alpha: 0.35, duration: 500, yoyo: true, hold: 500 });
    if (won) for (let i = 0; i < 3; i++) this.time.delayedCall(i * 160, () => this.sparks(BATTLE_W * (0.3 + i * 0.2), BATTLE_H / 2 - 30 * K, 0xf0d38a));
    const text = this.add
      .text(BATTLE_W / 2, BATTLE_H / 2, won ? t("battle.victory") : t("battle.defeat"), {
        fontFamily: "Oswald, Arial Narrow, sans-serif",
        fontSize: `${Math.round(46 * K)}px`,
        fontStyle: "bold",
        color: won ? "#f0d38a" : "#ff8a7a",
        stroke: "#000",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(901)
      .setScale(0.6);
    bridge.hint(won ? t("battle.victory") : t("battle.defeat"));
    this.tweens.add({ targets: text, scale: 1, duration: 260, ease: "Back.Out" });
    await this.wait(1400);
    band.destroy();
    text.destroy();
    glow.destroy();
    lines.forEach((l) => l.destroy());
  }

  // bottom-bar actions
  defend(): void {
    if (!this.myTurn()) return;
    void this.send({ type: "defend" });
  }

  magic(): void {
    if (!this.myTurn()) return;
    if (this.spellMode) {
      this.spellMode = null;
      bridge.hint(t("battle.spellCancelled"));
      this.updateBar();
      return;
    }
    const ab = this.findBattle(this.view);
    if (!ab) return;
    bridge.ui?.openSpellbook({ ...ab, battle: this.model }, this.side, (spell) => {
      // the battle may have ended (or gone automatic) while the book was open
      if (!this.live() || !this.myTurn()) return;
      this.spellMode = spell;
      this.clearSelection();
      bridge.hint(SPELLS[spell].target === "enemy" ? t("battle.pickEnemy") : t("battle.pickAlly"));
      this.updateBar();
    });
  }

  auto(): void {
    if (this.busy || bridge.inFlight > 0 || !this.model || this.model.over) return;
    this.spellMode = null;
    this.clearSelection();
    bridge.hint(t("battle.auto"));
    void bridge.act({ type: "autoBattle" });
  }

  // ================= geometry =================

  private displayRow(r: number): number {
    return this.flip ? ROWS - 1 - r : r;
  }

  private hexCenter(c: number, r: number): [number, number] {
    const rr = this.displayRow(r);
    return [OX + c * HEX_W + (rr % 2 ? HEX_W / 2 : 0), OY + rr * HEX_R * 1.5];
  }

  private hexAt(wx: number, wy: number): Hex | null {
    let best: Hex | null = null;
    let bd = Infinity;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const [x, y] = this.hexCenter(c, r);
        const d = Math.hypot(x - wx, y - wy);
        if (d < bd) {
          bd = d;
          best = [c, r];
        }
      }
    }
    return best && bd <= HEX_R ? best : null;
  }

  private hexImage(c: number, r: number): Img | undefined {
    return this.hexes[r * COLS + c];
  }

  private layout(): void {
    const cam = this.cameras.main;
    cam.setSize(this.scale.width, this.scale.height);
    const zoom = Math.min(this.scale.width / BATTLE_W, this.scale.height / BATTLE_H);
    cam.setZoom(zoom);
    cam.centerOn(BATTLE_W / 2, BATTLE_H / 2);
  }

  // ================= stacks =================

  private colorFor(side: Seat): ColorKey {
    const who = this.sides[side];
    return who === "neutral" ? "grey" : ownerColor(this.view.state, who);
  }

  private makeStack(s: BattleStack): StackView {
    const [x, y] = this.hexCenter(s.c, s.r);
    const color = this.colorFor(s.side);
    const container = this.add.container(x, y).setDepth(10 + this.displayRow(s.r));
    const key = unitKey(s.unit, color);
    const org = originOf(key);
    const icon = this.add.image(0, -4 * K, key).setOrigin(org.x, org.y);
    const flash = this.add.circle(0, -4 * K, 24 * K, 0xffffff, 0.55).setVisible(false);
    const badge = this.add.rectangle(18 * K, 20.5 * K, 32 * K, 17 * K, BADGE[color]).setStrokeStyle(1.5, 0x000000);
    const count = this.add
      .text(18 * K, 20.5 * K, String(s.count), {
        fontFamily: "Alegreya Sans, system-ui, sans-serif",
        fontSize: `${Math.round(14 * K)}px`,
        fontStyle: "bold",
        color: "#ebe2cb",
      })
      .setOrigin(0.5);
    const defend = this.add.rectangle(-26 * K, 19 * K, 8 * K, 10 * K, 0xd9a946).setVisible(s.defending);
    const haste = this.add.triangle(-26 * K, -18 * K, 0, 0, 8 * K, 0, 4 * K, 8 * K, 0x7fd1ff).setVisible(s.haste);
    container.add([icon, flash, badge, count, defend, haste]);
    // idle breathing so the field never looks frozen
    if (!reducedMotion()) {
      this.tweens.add({
        targets: icon,
        y: icon.y - 2.5 * K,
        duration: 900 + Math.random() * 500,
        delay: Math.random() * 600,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
    return { container, icon, flash, count, defend, haste };
  }

  /** Puts every stack exactly where the model says (after animations). */
  private syncStacks(): void {
    for (const s of this.model.stacks) {
      let v = this.stacks.get(s.id);
      if (s.count <= 0) {
        if (v) {
          v.container.destroy();
          this.stacks.delete(s.id);
        }
        continue;
      }
      if (!v) {
        v = this.makeStack(s);
        this.stacks.set(s.id, v);
      }
      const [x, y] = this.hexCenter(s.c, s.r);
      this.tweens.killTweensOf(v.container);
      v.container.setPosition(x, y).setAlpha(1).setDepth(10 + this.displayRow(s.r));
      v.count.setText(String(s.count));
      v.defend.setVisible(s.defending);
      v.haste.setVisible(s.haste);
    }
    this.acting = this.model.active;
    this.placeActiveMark();
  }

  private placeActiveMark(): void {
    const s = this.acting === null ? undefined : getStack(this.model, this.acting);
    if (!s || s.count <= 0 || this.model.over) {
      this.activeMark.setVisible(false);
      return;
    }
    const [x, y] = this.hexCenter(s.c, s.r);
    this.activeMark.setPosition(x, y).setVisible(true);
  }

  private clearSelection(): void {
    this.selected = null;
    this.selMark?.setVisible(false);
  }

  private myTurn(): boolean {
    if (this.busy || bridge.inFlight > 0 || !this.model || this.model.over) return false;
    if (!this.findBattle(this.view)) return false;
    const s = activeStack(this.model);
    return !!s && s.side === this.side && this.sides[s.side] === this.view.you && !this.autoSides[s.side];
  }

  /** This scene still shows a battle of the current view (not stopped, battle not finished). */
  private live(): boolean {
    const st = this.sys.settings.status;
    const running = st === Phaser.Scenes.RUNNING || st === Phaser.Scenes.CREATING;
    return running && !!this.model && !!this.findBattle(this.view);
  }

  private refreshTurn(): void {
    if (!this.live() && !this.sys.isActive()) return;
    for (const h of this.hexes) h.setTexture(TEX.hex);
    if (!this.model || this.model.over || !this.findBattle(this.view)) {
      this.updateBar();
      return;
    }
    const s = activeStack(this.model);
    const mine = this.myTurn();
    if (s && mine) {
      const rm = reachable(this.model, s.id);
      for (const key of Object.keys(rm)) {
        const [c, r] = key.split(",").map(Number) as [number, number];
        if (c === s.c && r === s.r) continue;
        this.hexImage(c, r)?.setTexture(TEX.hexReach);
      }
      const shoot = canShoot(this.model, s.id);
      for (const e of this.model.stacks) {
        if (e.count <= 0 || e.side === s.side) continue;
        const ok = shoot || hexNeighbors(e.c, e.r).some((n) => `${n[0]},${n[1]}` in rm);
        if (ok) this.hexImage(e.c, e.r)?.setTexture(TEX.hexAttack);
      }
      if (!this.spellMode) {
        bridge.hint(t(shoot ? "battle.yourTurnShoot" : "battle.yourTurn", { unit: unitName(s.unit).toLowerCase(), count: s.count }));
      }
    } else if (s) {
      bridge.hint(t("battle.enemyTurn"));
    }
    this.placeActiveMark();
    this.updateBar();
  }

  private updateBar(): void {
    if (!this.live()) return;
    const hero = this.model.heroes[this.side];
    bridge.ui?.setBattleBar({
      round: this.model.round,
      myTurn: this.myTurn(),
      canCast: !!hero && hero.spells.length > 0 && !this.model.spellUsed[this.side],
      spellMode: this.spellMode !== null,
      queue: [this.model.active, ...this.model.queue]
        .map((id) => (id === null ? undefined : this.model?.stacks.find((st) => st.id === id && st.count > 0)))
        .filter((st): st is BattleStack => !!st)
        .slice(0, 7)
        .map((st) => ({ unit: st.unit, count: st.count, mine: st.side === this.side })),
    });
  }

  private findBattle(view: PlayerView): ActiveBattle | undefined {
    return view.state.battles.find((b) => b.battle.id === this.battleId);
  }

  // ================= input =================

  private onTap(wx: number, wy: number): void {
    if (!this.myTurn()) return;
    const hex = this.hexAt(wx, wy);
    if (!hex) return;
    const s = activeStack(this.model);
    if (!s) return;
    const at = this.model.stacks.find((x) => x.count > 0 && x.c === hex[0] && x.r === hex[1]);

    if (this.spellMode) {
      const def = SPELLS[this.spellMode];
      const wantEnemy = def.target === "enemy";
      if (!at || (at.side !== this.side) !== wantEnemy) {
        bridge.hint(wantEnemy ? t("battle.pickEnemy") : t("battle.pickAlly"));
        return;
      }
      const spell = this.spellMode;
      this.spellMode = null;
      void this.send({ type: "cast", spell, target: at.id });
      return;
    }

    if (at && at.side !== this.side) {
      const shoot = canShoot(this.model, s.id);
      let from: Hex | null = null;
      if (!shoot) {
        const rm = reachable(this.model, s.id);
        const opts = hexNeighbors(at.c, at.r).filter((n) => `${n[0]},${n[1]}` in rm);
        if (opts.length === 0) {
          bridge.hint(t("battle.cantReach"));
          return;
        }
        opts.sort((a, b) => {
          const pa = this.hexCenter(a[0], a[1]);
          const pb = this.hexCenter(b[0], b[1]);
          return Math.hypot(pa[0] - wx, pa[1] - wy) - Math.hypot(pb[0] - wx, pb[1] - wy);
        });
        from = opts[0] ?? null;
      }
      if (this.selected !== at.id) {
        this.selected = at.id;
        const [x, y] = this.hexCenter(at.c, at.r);
        this.selMark.setPosition(x, y).setVisible(true);
        const p = previewAttack(this.model, s.id, at.id, shoot);
        bridge.hint(
          t(shoot ? "battle.previewShot" : "battle.previewMelee", {
            min: p.minDmg, max: p.maxDmg, kmin: p.minKill, kmax: p.maxKill, count: at.count,
          }),
        );
        sfx("click");
        return;
      }
      if (shoot) void this.send({ type: "shoot", target: at.id });
      else void this.send(from ? { type: "attack", target: at.id, from } : { type: "attack", target: at.id });
      return;
    }

    if (at && at.side === this.side) {
      const u = UNITS[at.unit];
      this.clearSelection();
      bridge.hint(t("battle.unitInfo", { unit: unitName(at.unit), count: at.count, atk: u.atk, def: u.def, hp: u.hp, spd: u.spd }));
      return;
    }

    const rm = reachable(this.model, s.id);
    if (`${hex[0]},${hex[1]}` in rm && !(hex[0] === s.c && hex[1] === s.r)) {
      void this.send({ type: "move", to: hex });
    } else {
      this.clearSelection();
      bridge.hint(t("battle.cantMove"));
    }
  }

  private async send(action: BattleAction): Promise<void> {
    this.clearSelection();
    this.updateBar();
    const res = await bridge.act({ type: "battle", action });
    if (!res.ok) this.refreshTurn();
  }

  // ================= animation =================

  private wait(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      this.time.delayedCall(ms, finish);
      setTimeout(finish, ms + 300);
    });
  }

  private tweenTo(target: object, props: Record<string, number>, duration: number): Promise<void> {
    if (duration <= 0 || reducedMotion()) {
      Object.assign(target, props);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      this.tweens.add({ targets: target, ...props, duration, ease: "Sine.easeInOut", onComplete: finish });
      setTimeout(() => {
        if (!done) Object.assign(target, props);
        finish();
      }, duration + 400);
    });
  }

  private floatText(stackId: number, text: string, color: string, delay = 0): void {
    const v = this.stacks.get(stackId);
    const st = getStack(this.model, stackId);
    let x: number;
    let y: number;
    if (v) {
      x = v.container.x;
      y = v.container.y;
    } else if (st) {
      [x, y] = this.hexCenter(st.c, st.r);
    } else return;
    const txt = this.add
      .text(x, y - 20 * K, text, {
        fontFamily: "Alegreya Sans, system-ui, sans-serif",
        fontSize: `${Math.round(22 * K)}px`,
        fontStyle: "bold",
        color,
        stroke: "#000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(800)
      .setAlpha(delay > 0 ? 0 : 1);
    this.tweens.add({
      targets: txt,
      y: y - 60 * K,
      alpha: { from: 1, to: 0 },
      delay,
      duration: 1000,
      ease: "Sine.easeOut",
      onComplete: () => txt.destroy(),
    });
  }

  private flash(stackId: number): void {
    const v = this.stacks.get(stackId);
    if (!v) return;
    v.flash.setVisible(true).setAlpha(0.6);
    this.tweens.add({ targets: v.flash, alpha: 0, duration: 180, onComplete: () => v.flash.setVisible(false) });
  }

  // ----- battle effects: facing, stepping out of cover, muzzle flash, tracer, impact, smoke -----

  private stackPos(stackId: number | null): [number, number] | null {
    if (stackId === null) return null;
    const v = this.stacks.get(stackId);
    if (v) return [v.container.x, v.container.y];
    const st = getStack(this.model, stackId);
    return st ? this.hexCenter(st.c, st.r) : null;
  }

  /** Turns a stack's sprite toward world x `tx` (pictures face right, red ones are baked mirrored). */
  private face(stackId: number | null, tx: number): void {
    if (stackId === null) return;
    const v = this.stacks.get(stackId);
    const st = getStack(this.model, stackId);
    if (!v || !st || Math.abs(tx - v.container.x) < 1) return;
    const bakedRight = this.colorFor(st.side) !== "red";
    v.icon.setFlipX(bakedRight !== tx > v.container.x);
  }

  /** A few soft puffs that grow and fade: smoke, dust or psionic glow depending on `tint`. */
  private puff(x: number, y: number, tint: number, count: number, spread: number, life: number): void {
    if (reducedMotion()) return;
    for (let i = 0; i < count; i++) {
      const img = this.add
        .image(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread * 0.6, TEX.smoke)
        .setTint(tint)
        .setAlpha(0.55)
        .setScale(0.35 + Math.random() * 0.3)
        .setDepth(760);
      this.tweens.add({
        targets: img,
        y: img.y - (10 + Math.random() * 18) * K,
        x: img.x + (Math.random() - 0.5) * 16 * K,
        scale: img.scale * (2 + Math.random()),
        alpha: 0,
        duration: life * (0.7 + Math.random() * 0.6),
        ease: "Sine.easeOut",
        onComplete: () => img.destroy(),
      });
    }
  }

  private sparks(x: number, y: number, tint: number): void {
    if (reducedMotion()) return;
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const img = this.add.image(x, y, TEX.spark).setTint(tint).setDepth(770).setScale(0.8 + Math.random() * 0.6);
      this.tweens.add({
        targets: img,
        x: x + Math.cos(a) * (14 + Math.random() * 22) * K,
        y: y + Math.sin(a) * (10 + Math.random() * 16) * K,
        alpha: 0,
        scale: 0.2,
        duration: 260 + Math.random() * 160,
        ease: "Quad.easeOut",
        onComplete: () => img.destroy(),
      });
    }
  }

  private shake(intensity: number): void {
    if (!reducedMotion()) this.cameras.main.shake(140, intensity);
  }

  /** The hit stack flinches away from (fx, fy), with sparks and a dust puff. */
  private impact(toId: number, fx: number, fy: number, tint = 0xffc070): void {
    const v = this.stacks.get(toId);
    const p = this.stackPos(toId);
    if (!p) return;
    const [x, y] = p;
    this.sparks(x, y - 12 * K, tint);
    this.puff(x, y + 6 * K, 0x8a8070, 3, 18 * K, 700);
    this.flash(toId);
    this.shake(0.004);
    if (v && !reducedMotion()) {
      const d = Math.hypot(x - fx, y - fy) || 1;
      this.tweens.add({
        targets: v.container,
        x: x + ((x - fx) / d) * 7 * K,
        y: y + ((y - fy) / d) * 7 * K,
        duration: 70,
        yoyo: true,
        ease: "Quad.easeOut",
        onComplete: () => v.container.setPosition(x, y),
      });
    }
  }

  /** Ranged attack: the shooter steps out of cover, fires (muzzle flash + tracer), the target is hit, the shooter steps back. */
  private async shot(fromId: number | null, toId: number): Promise<void> {
    const to = this.stackPos(toId);
    const from = this.stackPos(fromId);
    if (!to) return;
    if (!from || fromId === null) {
      this.impact(toId, to[0], to[1] - 50 * K);
      return;
    }
    const [ax, ay] = from;
    const [bx, by] = to;
    this.face(fromId, bx);
    this.face(toId, ax);
    const d = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / d;
    const uy = (by - ay) / d;
    const v = this.stacks.get(fromId);
    const psionic = getStack(this.model, fromId)?.unit === "lich";
    const color = psionic ? 0x9dff6a : 0xffe2a0;
    if (v) await this.tweenTo(v.container, { x: ax + ux * 10 * K, y: ay + uy * 10 * K }, 110 * this.speed);
    const mx = ax + ux * 30 * K;
    const my = ay - 10 * K + uy * 30 * K;
    sfx("shoot");
    const muzzle = this.add.image(mx, my, TEX.muzzle).setDepth(780).setTint(psionic ? 0xb8ff90 : 0xffffff);
    muzzle.setRotation(Math.atan2(uy, ux)).setScale(1.3);
    this.tweens.add({ targets: muzzle, alpha: 0, scale: 0.6, duration: 110, onComplete: () => muzzle.destroy() });
    const g = this.add.graphics().setDepth(775);
    g.lineStyle(psionic ? 5 : 3, color, 0.95);
    g.beginPath();
    g.moveTo(mx, my);
    g.lineTo(bx, by - 12 * K);
    g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });
    this.puff(mx, my, 0xb0a898, 2, 8 * K, 600);
    await this.wait(90 * this.speed);
    this.impact(toId, ax, ay, psionic ? 0x9dff6a : 0xffc070);
    if (psionic) this.puff(bx, by - 8 * K, 0x7dff5a, 4, 26 * K, 700);
    if (v) void this.tweenTo(v.container, { x: ax, y: ay }, 160 * this.speed);
  }

  /** Melee: the attacker charges part of the way, strikes, and returns. */
  private async lunge(fromId: number | null, toId: number): Promise<void> {
    const to = this.stackPos(toId);
    const from = this.stackPos(fromId);
    const v = fromId === null ? undefined : this.stacks.get(fromId);
    if (!to) return;
    if (!from || !v) {
      this.impact(toId, to[0], to[1] - 40 * K);
      return;
    }
    const [ax, ay] = from;
    const [bx, by] = to;
    this.face(fromId, bx);
    this.face(toId, ax);
    // wind-up: a short step back before the charge
    await this.tweenTo(v.container, { x: ax - (bx - ax) * 0.06, y: ay - (by - ay) * 0.06 }, 90 * this.speed);
    await this.tweenTo(v.container, { x: ax + (bx - ax) * 0.45, y: ay + (by - ay) * 0.45 }, 120 * this.speed);
    this.impact(toId, ax, ay);
    await this.tweenTo(v.container, { x: ax, y: ay }, 150 * this.speed);
  }

  /** Embers rising from the burning ruins along the field edges; a fixed pool, recycled. */
  private ambientEmbers(): void {
    if (reducedMotion()) return;
    const rise = (img: Img): void => {
      const edge = Math.random() < 0.5;
      img.setPosition(edge ? Math.random() * BATTLE_W * 0.22 : BATTLE_W * (0.78 + Math.random() * 0.22), BATTLE_H * (0.55 + Math.random() * 0.45));
      img.setAlpha(0).setScale(0.35 + Math.random() * 0.4);
      this.tweens.add({
        targets: img,
        y: img.y - BATTLE_H * (0.25 + Math.random() * 0.3),
        x: img.x + (Math.random() - 0.5) * 80 * K,
        alpha: { from: 0.9, to: 0 },
        duration: 3200 + Math.random() * 2600,
        delay: Math.random() * 2400,
        ease: "Sine.easeOut",
        onComplete: () => rise(img),
      });
    };
    for (let i = 0; i < 14; i++) {
      const img = this.add.image(0, 0, TEX.spark).setTint(0xffa040).setBlendMode(Phaser.BlendModes.ADD).setDepth(610);
      rise(img);
    }
  }

  /** Slow haze drifting across the field. */
  private ambientSmoke(): void {
    if (reducedMotion()) return;
    const x0 = -120 * K;
    const x1 = BATTLE_W + 120 * K;
    const drift = (img: Img, speed: number): void => {
      this.tweens.add({
        targets: img,
        x: x1,
        duration: ((x1 - img.x) / (x1 - x0)) * speed,
        onComplete: () => {
          img.x = x0;
          drift(img, speed);
        },
      });
    };
    for (let i = 0; i < 4; i++) {
      const img = this.add
        .image(x0 + Math.random() * (x1 - x0), BATTLE_H * (0.15 + i * 0.22), TEX.smoke)
        .setTint(0x9a9080)
        .setAlpha(0.1)
        .setScale(5 + Math.random() * 3, 2.5 + Math.random())
        .setDepth(600);
      drift(img, 22000 + Math.random() * 14000);
    }
  }

  private bolt(toId: number): void {
    const b = getStack(this.model, toId);
    if (!b) return;
    const [x, y] = this.hexCenter(b.c, b.r);
    const g = this.add.graphics().setDepth(750);
    g.lineStyle(5, 0xdff4ff, 1);
    g.beginPath();
    g.moveTo(x, 0);
    let yy = 0;
    while (yy < y) {
      yy = Math.min(y, yy + 40 * K);
      g.lineTo(yy >= y ? x : x + (Math.random() - 0.5) * 40 * K, yy);
    }
    g.strokePath();
    const veil = this.add.rectangle(BATTLE_W / 2, BATTLE_H / 2, BATTLE_W, BATTLE_H, 0xdcf0ff, 0.35).setDepth(740);
    this.tweens.add({
      targets: [g, veil],
      alpha: 0,
      duration: 380,
      onComplete: () => {
        g.destroy();
        veil.destroy();
      },
    });
  }

  private async animate(ev: BattleEvent): Promise<void> {
    const sp = this.speed;
    switch (ev.type) {
      case "turn": {
        this.acting = ev.stack;
        const st = getStack(this.model, ev.stack);
        if (st) st.defending = false;
        this.stacks.get(ev.stack)?.defend.setVisible(false);
        this.placeActiveMark();
        await this.wait(80 * sp);
        break;
      }
      case "round":
        this.model.round = ev.round;
        for (const s of this.model.stacks) s.haste = false;
        for (const v of this.stacks.values()) v.haste.setVisible(false);
        this.updateBar();
        break;
      case "move": {
        const st = getStack(this.model, ev.stack);
        const v = this.stacks.get(ev.stack);
        if (!st) break;
        const dist = hexDistance([st.c, st.r], ev.to);
        st.c = ev.to[0];
        st.r = ev.to[1];
        const [x, y] = this.hexCenter(st.c, st.r);
        if (this.acting === ev.stack) this.activeMark.setVisible(false);
        if (v) {
          v.container.setDepth(10 + this.displayRow(st.r));
          await this.tweenTo(v.container, { x, y }, Math.min(480, 110 * Math.max(1, dist)) * sp);
        }
        this.placeActiveMark();
        break;
      }
      case "damage": {
        const st = getStack(this.model, ev.stack);
        if (!st) break;
        if (ev.source === "shot") {
          await this.shot(this.acting, ev.stack);
          this.lastTarget = ev.stack;
        } else if (ev.source === "melee") {
          await this.lunge(this.acting, ev.stack);
          this.lastTarget = ev.stack;
        } else if (ev.source === "retaliation") {
          await this.lunge(this.lastTarget, ev.stack);
        } else if (ev.source === "splash") {
          const p = this.stackPos(ev.stack);
          if (p) this.impact(ev.stack, p[0], p[1] - 30 * K, 0x9dff6a);
        } else {
          sfx("bolt");
          this.bolt(ev.stack);
          this.flash(ev.stack);
          this.shake(0.008);
          await this.wait(200 * sp);
        }
        if (ev.source !== "spell") sfx("hit");
        st.count = Math.max(0, st.count - ev.killed);
        this.stacks.get(ev.stack)?.count.setText(String(st.count));
        const color = ev.lucky ? "#ffd34a" : ev.source === "splash" ? "#c08cf0" : ev.source === "spell" ? "#bfe6ff" : "#ff8a7a";
        this.floatText(ev.stack, `−${ev.killed}`, color);
        if (ev.lucky && this.acting !== null) this.floatText(this.acting, t("battle.luck"), "#ffd34a", 120);
        await this.wait(320 * sp);
        break;
      }
      case "heal": {
        const st = getStack(this.model, ev.stack);
        if (!st) break;
        st.count += ev.revived;
        this.stacks.get(ev.stack)?.count.setText(String(st.count));
        sfx("heal");
        this.floatText(ev.stack, `+${ev.revived}`, "#7ee06b");
        await this.wait(320 * sp);
        break;
      }
      case "haste": {
        const st = getStack(this.model, ev.stack);
        if (st) st.haste = true;
        this.stacks.get(ev.stack)?.haste.setVisible(true);
        sfx("heal");
        this.floatText(ev.stack, t("battle.haste"), "#7fd1ff");
        await this.wait(260 * sp);
        break;
      }
      case "morale":
        this.floatText(ev.stack, t("battle.morale"), "#f0d38a");
        await this.wait(260 * sp);
        break;
      case "death": {
        const st = getStack(this.model, ev.stack);
        if (st) st.count = 0;
        const v = this.stacks.get(ev.stack);
        sfx("death");
        if (v) {
          this.stacks.delete(ev.stack);
          const c = v.container;
          this.puff(c.x, c.y, 0x6f6a62, 5, 30 * K, 1100);
          this.tweens.add({
            targets: c,
            alpha: 0,
            y: c.y + 10 * K,
            angle: v.icon.flipX ? -70 : 70,
            duration: 560,
            ease: "Quad.easeIn",
            onComplete: () => c.destroy(),
          });
        }
        if (this.acting === ev.stack) this.activeMark.setVisible(false);
        await this.wait(200 * sp);
        break;
      }
      case "end":
        this.model.over = true;
        this.model.winnerSide = ev.winnerSide;
        if (this.winnerSide === null) this.winnerSide = ev.winnerSide;
        this.activeMark.setVisible(false);
        break;
    }
  }
}
