import Phaser from "phaser";
import {
  ARTIFACTS, CHEST_GOLD, MINE_INCOME, REVEAL_HERO, approx, guardOf, revealDisc,
} from "@korony/shared";
import type { GameEvent, GameState, Hero, MapObject, PlayerView, Point } from "@korony/shared";
import { sfx } from "../audio";
import { bridge } from "../game/bridge";
import { bannerOf, mapLockReason, mePlayer, myBattle, myHero, objectAtView, ownerColor } from "../game/helpers";
import { nextLeg, planMove } from "../game/pathing";
import { tileDeco } from "../gfx/draw";
import type { TerrainChar } from "../gfx/draw";
import {
  BATTLE_K, MAP_K, PLAIN_VARIANTS, TEX, TILE, artKey, castleKey, heroKey, mapKey, mineKey, originOf, terrainKey, unitKey,
} from "../gfx/keys";
import { fmtNum, t } from "../i18n";
import type { I18nKey } from "../i18n";
import { artifactFx, artifactName, countLabel, unitName } from "../i18n/catalog";


const DRAG_THRESHOLD_CSS = 8;
const STEP_MS = 110;
const MIN_TILE_CSS = 26;
const MAX_TILE_CSS = 72;
const FOG_COLOR = 0x07080b;

type Img = Phaser.GameObjects.Image;

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Adventure map: terrain, objects, heroes, fog of war, path preview, tap-to-move and drag-to-pan. */
export class MapScene extends Phaser.Scene {
  private view: PlayerView | null = null;
  private mapSig = "";
  private terrain: Img[] = [];
  private objects: Phaser.GameObjects.GameObject[] = [];
  private heroes = new Map<string, Img>();
  private pathMarks: Img[] = [];
  private tileMark: Img | null = null;
  private fog: Phaser.GameObjects.Graphics | null = null;
  private explored = "";
  private path: Point[] = [];
  private target: Point | null = null;
  /** The planned path is a detour around a guard, walked in several legs. */
  private detour = false;
  /** Index of the first step where the hero would stop before the target (guard ahead), or -1. */
  private stopAt = -1;
  private animating = false;
  /** A detour is being walked leg by leg. */
  private walking = false;
  private readonly center = { x: 0, y: 0 };
  private drag: { id: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private resolveReady: (() => void) | null = null;
  /** Resolves once create() ran. */
  readonly ready: Promise<void>;

  constructor() {
    super("MapScene");
    this.ready = new Promise<void>((r) => {
      this.resolveReady = r;
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#0b0c10");
    this.fog = this.add.graphics().setDepth(6000);
    this.tileMark = this.add.image(0, 0, TEX.tileMark).setOrigin(0, 0).setDepth(5001).setVisible(false);

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.drag) return;
      this.drag = { id: p.id, x: p.x, y: p.y, cx: this.center.x, cy: this.center.y, moved: false };
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const d = this.drag;
      if (!d || d.id !== p.id || !p.isDown) return;
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_CSS * bridge.dpr) d.moved = true;
      if (d.moved) {
        const z = this.cameras.main.zoom;
        this.center.x = d.cx - dx / z;
        this.center.y = d.cy - dy / z;
        this.applyCamera();
      }
    });
    const up = (p: Phaser.Input.Pointer): void => {
      const d = this.drag;
      if (!d || d.id !== p.id) return;
      this.drag = null;
      if (!d.moved) {
        const wp = this.cameras.main.getWorldPoint(p.x, p.y);
        this.onTap(Math.floor(wp.x / TILE), Math.floor(wp.y / TILE));
      }
    };
    this.input.on("pointerup", up);
    this.input.on("pointerupoutside", up);

    this.scale.on("resize", this.layout, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.layout, this));
    if (this.view) this.rebuild();
    this.layout();
    this.resolveReady?.();
  }

  // ================= public API (called by the Director) =================

  /** Shows a new view, animating hero moves from `events` first. */
  async showView(view: PlayerView, events: readonly GameEvent[]): Promise<void> {
    const prev = this.view;
    this.view = view;
    const sig = `${view.state.id}|${view.state.mapId}|${view.state.cols}x${view.state.rows}`;
    if (!prev || sig !== this.mapSig) {
      this.rebuild();
      this.focusHero();
      return;
    }
    const moves = events.filter((e): e is Extract<GameEvent, { type: "moved" }> => e.type === "moved");
    if (moves.length > 0) {
      this.clearPath();
      // objects that vanish (chests, artifacts, beaten monsters) stay until the hero gets there
      this.renderObjects(view.state, prev.state);
      for (const h of Object.values(view.state.heroes)) this.ensureHero(h, view.state);
      this.animating = true;
      try {
        for (const mv of moves) await this.animateMove(mv.heroId, mv.path, view);
      } finally {
        this.animating = false;
      }
    }
    this.syncAll();
    this.refreshPath();
  }

  /** Clears the map (back to the lobby). */
  clear(): void {
    this.view = null;
    this.mapSig = "";
    for (const i of this.terrain) i.destroy();
    this.terrain = [];
    this.clearObjects();
    for (const h of this.heroes.values()) h.destroy();
    this.heroes.clear();
    this.clearPath();
    this.fog?.clear();
  }

  /** World position of a tile centre in canvas pixels (for tests and tutorials). */
  tileToCanvas(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const wx = x * TILE + TILE / 2;
    const wy = y * TILE + TILE / 2;
    const vw = cam.width;
    const vh = cam.height;
    return { x: (wx - this.center.x) * cam.zoom + vw / 2, y: (wy - this.center.y) * cam.zoom + vh / 2 };
  }

  // ================= building the scene =================

  private rebuild(): void {
    const view = this.view;
    if (!view || !this.sys.isActive() && !this.sys.isSleeping()) return;
    const s = view.state;
    this.mapSig = `${s.id}|${s.mapId}|${s.cols}x${s.rows}`;
    for (const i of this.terrain) i.destroy();
    this.terrain = [];
    // a painted landscape replaces the terrain tiles when the map has one
    if (this.textures.exists(mapKey(s.mapId))) {
      const img = this.add.image(0, 0, mapKey(s.mapId)).setOrigin(0, 0).setDepth(0);
      img.setDisplaySize(s.cols * TILE, s.rows * TILE);
      this.terrain.push(img);
    } else {
      this.buildTiles(s);
    }
    for (const h of this.heroes.values()) h.destroy();
    this.heroes.clear();
    this.syncAll();
    this.layout();
  }

  private buildTiles(s: GameState): void {
    for (let y = 0; y < s.rows; y++) {
      const row = s.terrain[y] ?? "";
      for (let x = 0; x < s.cols; x++) {
        const ch = (row[x] ?? ".") as TerrainChar;
        const deco = tileDeco(x, y);
        const checker = ((x + y) % 2) as 0 | 1;
        let variant = 0;
        if (ch === "." && deco[0] < 0.35) variant = 1 + Math.floor(deco[1] * (PLAIN_VARIANTS - 1));
        else if (ch === "W" && deco[0] < 0.5) variant = 1;
        const key = this.textures.exists(terrainKey(ch, checker, variant)) ? terrainKey(ch, checker, variant) : terrainKey(".", checker, 0);
        const img = this.add.image(x * TILE, y * TILE, key).setOrigin(0, 0).setDepth(0);
        img.setDisplaySize(TILE + 0.5, TILE + 0.5);
        this.terrain.push(img);
      }
    }
  }

  private syncAll(): void {
    const view = this.view;
    if (!view) return;
    this.renderObjects(view.state, null);
    const alive = new Set<string>();
    for (const h of Object.values(view.state.heroes)) {
      if (!h.alive) continue;
      alive.add(h.id);
      const img = this.ensureHero(h, view.state);
      img.setPosition(h.x * TILE + TILE / 2, h.y * TILE + TILE / 2 + 3 * MAP_K);
      img.setDepth(10 + h.y * 2 + 1);
    }
    for (const [id, img] of this.heroes) {
      if (!alive.has(id)) {
        img.destroy();
        this.heroes.delete(id);
      }
    }
    this.explored = mePlayer(view)?.explored ?? "";
    this.renderFog();
  }

  private ensureHero(h: Hero, state: GameState): Img {
    const key = heroKey(ownerColor(state, h.owner), bannerOf(state, h.owner));
    let img = this.heroes.get(h.id);
    if (!img) {
      const o = originOf(key);
      img = this.add.image(h.x * TILE + TILE / 2, h.y * TILE + TILE / 2 + 3 * MAP_K, key).setOrigin(o.x, o.y);
      img.setDepth(10 + h.y * 2 + 1);
      this.heroes.set(h.id, img);
    } else if (img.texture.key !== key) {
      img.setTexture(key);
    }
    return img;
  }

  private clearObjects(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
  }

  /** Draws the objects of `state`, plus those of `keep` that are gone in `state` (until an animation ends). */
  private renderObjects(state: GameState, keep: GameState | null): void {
    this.clearObjects();
    const list: MapObject[] = state.objects.filter((o) => !o.gone);
    if (keep) {
      const present = new Set(list.map((o) => o.id));
      for (const o of keep.objects) if (!o.gone && !present.has(o.id)) list.push(o);
    }
    for (const o of list) this.drawObject(o, keep ?? state);
  }

  private drawObject(o: MapObject, state: GameState): void {
    const cx = o.x * TILE + TILE / 2;
    const cy = o.y * TILE + TILE / 2;
    const depth = 10 + o.y * 2;
    const place = (key: string, x: number, y: number): Img => {
      const org = originOf(key);
      const img = this.add.image(x, y, key).setOrigin(org.x, org.y).setDepth(depth);
      this.objects.push(img);
      return img;
    };
    switch (o.kind) {
      case "castle":
        place(castleKey(ownerColor(state, o.owner), bannerOf(state, o.owner)), cx, cy - 2 * MAP_K);
        break;
      case "mine":
        place(mineKey(o.owner ? ownerColor(state, o.owner) : null), cx, cy);
        break;
      case "chest":
        place(TEX.chest, cx, cy);
        break;
      case "artifact":
        if (o.artifact) place(artKey(o.artifact), cx, cy);
        break;
      case "monster": {
        const st = o.army?.[0];
        if (!st) break;
        const img = place(unitKey(st.unit, "grey"), cx, cy);
        img.setScale((16 * MAP_K) / (28 * BATTLE_K));
        const label = st.countHint ?? approx(st.count);
        const txt = this.add
          .text(cx, cy + 16 * MAP_K, label, {
            fontFamily: "Alegreya Sans, system-ui, sans-serif",
            fontSize: `${Math.round(11 * MAP_K)}px`,
            fontStyle: "bold",
            color: "#ebe2cb",
            backgroundColor: "rgba(0,0,0,0.72)",
            padding: { x: 4, y: 1 },
          })
          .setOrigin(0.5, 0.5)
          .setDepth(depth + 0.5);
        this.objects.push(txt);
        break;
      }
    }
  }

  private renderFog(): void {
    const g = this.fog;
    const view = this.view;
    if (!g || !view) return;
    g.clear();
    const { cols, rows } = view.state;
    const ex = this.explored;
    g.fillStyle(FOG_COLOR, 1);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (ex[y * cols + x] !== "1") g.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    // soft edge: graded translucent bands on explored tiles that touch the fog, so the border fades out
    const bands: [number, number][] = [
      [0.4, 0.1],
      [0.26, 0.22],
      [0.12, 0.38],
    ];
    const fogged = (xx: number, yy: number): boolean => xx >= 0 && yy >= 0 && xx < cols && yy < rows && ex[yy * cols + xx] !== "1";
    for (const [alpha, depth] of bands) {
      g.fillStyle(FOG_COLOR, alpha);
      const e = TILE * depth;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (ex[y * cols + x] !== "1") continue;
          const x0 = x * TILE;
          const y0 = y * TILE;
          if (fogged(x, y - 1)) g.fillRect(x0, y0, TILE, e);
          if (fogged(x, y + 1)) g.fillRect(x0, y0 + TILE - e, TILE, e);
          if (fogged(x - 1, y)) g.fillRect(x0, y0, e, TILE);
          if (fogged(x + 1, y)) g.fillRect(x0 + TILE - e, y0, e, TILE);
          // diagonal-only neighbours get a corner patch so the fog has no notches
          if (fogged(x - 1, y - 1) && !fogged(x - 1, y) && !fogged(x, y - 1)) g.fillRect(x0, y0, e, e);
          if (fogged(x + 1, y - 1) && !fogged(x + 1, y) && !fogged(x, y - 1)) g.fillRect(x0 + TILE - e, y0, e, e);
          if (fogged(x - 1, y + 1) && !fogged(x - 1, y) && !fogged(x, y + 1)) g.fillRect(x0, y0 + TILE - e, e, e);
          if (fogged(x + 1, y + 1) && !fogged(x + 1, y) && !fogged(x, y + 1)) g.fillRect(x0 + TILE - e, y0 + TILE - e, e, e);
        }
      }
    }
  }

  // ================= camera =================

  private layout(): void {
    const cam = this.cameras.main;
    cam.setSize(this.scale.width, this.scale.height);
    const view = this.view;
    if (!view) return;
    const W = view.state.cols * TILE;
    const dpr = bridge.dpr;
    const fit = this.scale.width / W;
    const zoom = Math.min(Math.max(fit, (MIN_TILE_CSS * dpr) / TILE), (MAX_TILE_CSS * dpr) / TILE);
    cam.setZoom(zoom);
    this.applyCamera();
  }

  private applyCamera(): void {
    const view = this.view;
    const cam = this.cameras.main;
    if (!view) return;
    const W = view.state.cols * TILE;
    const H = view.state.rows * TILE;
    const hw = cam.width / (2 * cam.zoom);
    const hh = cam.height / (2 * cam.zoom);
    this.center.x = W <= 2 * hw ? W / 2 : Math.min(Math.max(this.center.x, hw), W - hw);
    this.center.y = H <= 2 * hh ? H / 2 : Math.min(Math.max(this.center.y, hh), H - hh);
    cam.centerOn(this.center.x, this.center.y);
  }

  private focusHero(): void {
    const view = this.view;
    const h = view ? myHero(view) : undefined;
    if (!h) return;
    this.center.x = h.x * TILE + TILE / 2;
    this.center.y = h.y * TILE + TILE / 2;
    this.applyCamera();
  }

  /** Keeps a tile inside the middle of the view while a hero walks. */
  private follow(x: number, y: number): void {
    const cam = this.cameras.main;
    const wx = x * TILE + TILE / 2;
    const wy = y * TILE + TILE / 2;
    const mx = (cam.width / cam.zoom) * 0.3;
    const my = (cam.height / cam.zoom) * 0.3;
    let moved = false;
    if (wx < this.center.x - mx) {
      this.center.x = wx + mx;
      moved = true;
    } else if (wx > this.center.x + mx) {
      this.center.x = wx - mx;
      moved = true;
    }
    if (wy < this.center.y - my) {
      this.center.y = wy + my;
      moved = true;
    } else if (wy > this.center.y + my) {
      this.center.y = wy - my;
      moved = true;
    }
    if (moved) this.applyCamera();
  }

  // ================= animation =================

  private tweenTo(target: object, props: Record<string, number>, duration: number): Promise<void> {
    if (duration <= 0 || reducedMotion()) {
      Object.assign(target, props);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        resolve();
      };
      this.tweens.add({ targets: target, ...props, duration, ease: "Linear", onComplete: finish });
      // the game loop pauses in background tabs: never let the queue hang on a tween
      setTimeout(() => {
        if (!done) Object.assign(target, props);
        finish();
      }, duration + 400);
    });
  }

  private async animateMove(heroId: string, path: readonly Point[], view: PlayerView): Promise<void> {
    const h = view.state.heroes[heroId];
    const first = path[0];
    if (!first) return;
    let img = this.heroes.get(heroId);
    if (!img) {
      if (!h) return;
      img = this.ensureHero({ ...h, x: first.x, y: first.y }, view.state);
    }
    const mine = h?.owner === view.you;
    const { cols, rows } = view.state;
    for (const pt of path) {
      img.setDepth(10 + pt.y * 2 + 1);
      await this.tweenTo(img, { x: pt.x * TILE + TILE / 2, y: pt.y * TILE + TILE / 2 + 3 * MAP_K }, STEP_MS);
      if (mine) {
        this.explored = revealDisc(this.explored, cols, rows, pt.x, pt.y, REVEAL_HERO);
        this.renderFog();
        this.follow(pt.x, pt.y);
        sfx("step");
      }
    }
  }

  // ================= input =================

  private onTap(x: number, y: number): void {
    const view = this.view;
    if (!view || this.animating || this.walking || bridge.inFlight > 0) return;
    const s = view.state;
    if (x < 0 || y < 0 || x >= s.cols || y >= s.rows) return;
    const hero = myHero(view);
    const me = mePlayer(view);
    if (!hero || !me) return;

    // own hero / own castle open their panels
    if (hero.alive && hero.x === x && hero.y === y) {
      const o = objectAtView(s, x, y);
      this.clearPath();
      if (o && o.kind === "castle" && o.owner === view.you) bridge.ui?.openCastle();
      else bridge.ui?.openHero();
      return;
    }

    const lock = mapLockReason(view);
    if (lock) {
      const hintKey: I18nKey =
        lock.key === "reason.dayEnded"
          ? "hint.dayEnded"
          : lock.key === "reason.inBattle"
            ? "hint.inBattle"
            : lock.key === "reason.heroDead"
              ? "hint.heroDead"
              : lock.key;
      bridge.hint(t(hintKey));
      return;
    }
    if (me.explored[y * s.cols + x] !== "1") {
      this.clearPath();
      bridge.hint(t("hint.fog"));
      return;
    }
    if (this.target && this.target.x === x && this.target.y === y && this.path.length > 0) {
      void this.go();
      return;
    }
    const plan = planMove(s, hero, { x, y });
    const path = plan.path;
    if (path.length === 0) {
      this.clearPath();
      bridge.hint(t("hint.noPath"));
      return;
    }
    this.target = { x, y };
    this.path = path;
    this.detour = plan.detour;
    this.stopAt = plan.stopAt;
    this.drawPath();
    const parts: string[] = [];
    const what = this.describe(x, y);
    if (what) parts.push(what);
    // the hero would stop on the way (a guard's zone): say so, the path is drawn red from there
    const stop = plan.stopAt >= 0 ? path[plan.stopAt] : undefined;
    if (stop) parts.push(this.stopText(stop.x, stop.y));
    parts.push(path.length > hero.mp ? t("hint.stepsTooFar", { n: path.length }) : t("hint.steps", { n: path.length }));
    bridge.hint(parts.join(". "));
    sfx("click");
  }

  /** Why the hero would stop on tile (x, y) before reaching the target. */
  private stopText(x: number, y: number): string {
    const view = this.view;
    const g = view ? guardOf(view.state, x, y) : undefined;
    const st = g?.army?.[0];
    if (st) return t("hint.ambush", { unit: unitName(st.unit).toLowerCase(), count: countLabel(st.countHint ?? approx(st.count)) });
    return t("hint.stopOnWay", { what: this.describe(x, y) || t("hint.stopHere") });
  }

  private async go(): Promise<void> {
    const view = this.view;
    const hero = view ? myHero(view) : undefined;
    const target = this.target;
    if (!view || !hero || !target) return;
    if (hero.mp <= 0) {
      bridge.hint(t("hint.noMp"));
      return;
    }
    const path = this.path;
    const detour = this.detour;
    this.clearPath();
    if (!detour) {
      const res = await bridge.act({ type: "move", to: { x: target.x, y: target.y } });
      if (res.ok) this.afterMove();
      return;
    }
    // walk the detour in legs the engine follows exactly, so it never cuts through the guard's zone
    this.walking = true;
    try {
      let rest = path;
      while (rest.length > 0) {
        const v = bridge.conn?.view;
        const h = v ? myHero(v) : undefined;
        if (!v || !h || h.mp <= 0 || mapLockReason(v)) break;
        const k = nextLeg(v.state, h, rest);
        const leg = rest[k];
        if (!leg) break;
        const res = await bridge.act({ type: "move", to: { x: leg.x, y: leg.y } });
        if (!res.ok) return;
        const after = bridge.conn?.view;
        const h2 = after ? myHero(after) : undefined;
        if (!h2 || h2.x !== leg.x || h2.y !== leg.y) break;
        rest = rest.slice(k + 1);
      }
    } finally {
      this.walking = false;
    }
    this.afterMove();
  }

  /** The move went through: the "tap again to go" hint is stale now. */
  private afterMove(): void {
    const v = bridge.conn?.view;
    if (!v || myBattle(v)) return; // the battle scene shows its own hint
    const h = myHero(v);
    bridge.hint(h && h.alive && h.mp <= 0 ? t("hint.noMp") : t("hint.map"));
  }

  private describe(x: number, y: number): string {
    const view = this.view;
    if (!view) return "";
    const s = view.state;
    const eh = Object.values(s.heroes).find((h) => h.alive && h.x === x && h.y === y && h.owner !== view.you);
    if (eh) return t("hint.target.enemyHero", { name: eh.name });
    const g = guardOf(s, x, y);
    if (g) {
      const st = g.army?.[0];
      if (st) {
        return t("hint.target.guard", { unit: unitName(st.unit).toLowerCase(), count: countLabel(st.countHint ?? approx(st.count)) });
      }
    }
    const o = objectAtView(s, x, y);
    if (!o) return "";
    switch (o.kind) {
      case "chest":
        return t("hint.target.chest", { gold: fmtNum(CHEST_GOLD) });
      case "mine":
        return o.owner === view.you ? t("hint.target.mineOwn") : t("hint.target.mine", { gold: fmtNum(MINE_INCOME) });
      case "artifact": {
        if (!o.artifact) return "";
        const a = ARTIFACTS[o.artifact];
        return t("hint.target.artifact", { name: artifactName(o.artifact), rarity: t(`rarity.${a.rarity}` as I18nKey), fx: artifactFx(a) });
      }
      case "castle":
        return o.owner === view.you
          ? t("hint.target.castleOwn")
          : o.owner
            ? t("hint.target.castleEnemy")
            : t("hint.target.castleNeutral");
      default:
        return "";
    }
  }

  // ================= path preview =================

  private clearPath(): void {
    for (const m of this.pathMarks) m.destroy();
    this.pathMarks = [];
    this.path = [];
    this.target = null;
    this.detour = false;
    this.stopAt = -1;
    this.tileMark?.setVisible(false);
  }

  private drawPath(): void {
    for (const m of this.pathMarks) m.destroy();
    this.pathMarks = [];
    const view = this.view;
    const hero = view ? myHero(view) : undefined;
    if (!hero) return;
    this.path.forEach((p, i) => {
      const ok = i < hero.mp && (this.stopAt < 0 || i < this.stopAt);
      const last = i === this.path.length - 1;
      const key = last ? (ok ? TEX.crossGreen : TEX.crossRed) : ok ? TEX.dotGreen : TEX.dotRed;
      const img = this.add.image(p.x * TILE + TILE / 2, p.y * TILE + TILE / 2, key).setDepth(5000);
      this.pathMarks.push(img);
    });
    const tgt = this.target;
    if (tgt && this.tileMark) this.tileMark.setPosition(tgt.x * TILE, tgt.y * TILE).setVisible(true);
  }

  /** After a new view (e.g. a new day) recompute the preview of the planned path, if still valid. */
  private refreshPath(): void {
    const view = this.view;
    const tgt = this.target;
    const hero = view ? myHero(view) : undefined;
    if (!view || !tgt || !hero || mapLockReason(view)) {
      this.clearPath();
      return;
    }
    const plan = planMove(view.state, hero, tgt);
    if (plan.path.length === 0) {
      this.clearPath();
      return;
    }
    this.path = plan.path;
    this.detour = plan.detour;
    this.stopAt = plan.stopAt;
    this.drawPath();
  }
}
