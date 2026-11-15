/**
 * Map helpers over the adventure map for phones: a mini-map (tap to look there), a "to the hero" button and
 * the chronicle of the game. Shown only on the map, never in battle or on the lobby screens.
 */
import type { GameState, PlayerView } from "@korony/shared";
import type { MapScene } from "../scenes/MapScene";
import { mePlayer, myHero, ownerColor } from "../game/helpers";
import { t } from "../i18n";
import { STORAGE_KEYS, readItem, writeItem } from "../storage";
import { h } from "./dom";

const TERRAIN_COLOR: Record<string, string> = { ".": "#5e8a3c", F: "#2f5524", M: "#7c7a6e", W: "#2f6690" };
const OWNER_COLOR = { blue: "#4a90e2", red: "#e0625a", grey: "#b9b2a0" } as const;

/** Mini-map size in CSS pixels (the longer side). */
const MINI_PX = 112;

export interface MapToolsHooks {
  scene(): MapScene | null;
  openLog(): void;
}

export class MapTools {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly mini: HTMLElement;
  private view: PlayerView | null = null;
  private open: boolean;
  /** Terrain and fog are redrawn only when the map or the explored area changes. */
  private baseKey = "";
  private base: HTMLCanvasElement | null = null;

  constructor(private readonly hooks: MapToolsHooks) {
    this.open = readItem(STORAGE_KEYS.miniMap) !== "0";
    this.canvas = h("canvas", { class: "minimap-canvas" });
    this.canvas.addEventListener("pointerdown", (e) => this.onTap(e));
    this.mini = h(
      "div",
      { class: "minimap", testid: "minimap" },
      this.canvas,
    );
    this.el = h(
      "div",
      { class: "maptools", hidden: true },
      this.mini,
      h(
        "div",
        { class: "maptools-btns" },
        h("button", { class: "icon-btn round", testid: "map-toggle", ariaLabel: t("map.miniToggle"), onClick: () => this.toggle() }, "▦"),
        h("button", { class: "icon-btn round", testid: "map-log", ariaLabel: t("map.log"), onClick: () => this.hooks.openLog() }, "☰"),
        h("button", { class: "icon-btn round accent", testid: "map-hero", ariaLabel: t("map.toHero"), onClick: () => this.toHero() }, "◎"),
      ),
    );
    this.syncOpen();
  }

  /** Shows the tools for a map view, or hides them (null: lobby, battle, no game). */
  show(view: PlayerView | null): void {
    this.view = view;
    this.el.hidden = !view;
    const scene = this.hooks.scene();
    if (scene) scene.onCamera = () => this.cameraMoved();
    if (view) this.draw();
  }

  /** The camera moved: only the visible-area frame changes. */
  cameraMoved(): void {
    if (this.view && this.open && !this.el.hidden) this.draw();
  }

  private toggle(): void {
    this.open = !this.open;
    writeItem(STORAGE_KEYS.miniMap, this.open ? "1" : "0");
    this.syncOpen();
    if (this.open) this.draw();
  }

  private syncOpen(): void {
    this.mini.hidden = !this.open;
  }

  private toHero(): void {
    this.hooks.scene()?.focusHero();
  }

  private scale(state: GameState): number {
    return MINI_PX / Math.max(state.cols, state.rows);
  }

  private onTap(e: PointerEvent): void {
    const view = this.view;
    if (!view) return;
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const k = r.width / view.state.cols;
    const x = Math.floor((e.clientX - r.left) / k);
    const y = Math.floor((e.clientY - r.top) / k);
    this.hooks.scene()?.centerOnTile(Math.min(Math.max(x, 0), view.state.cols - 1), Math.min(Math.max(y, 0), view.state.rows - 1));
  }

  private draw(): void {
    const view = this.view;
    if (!view || !this.open) return;
    const s = view.state;
    const me = mePlayer(view);
    const k = this.scale(s);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.round(s.cols * k);
    const hgt = Math.round(s.rows * k);
    if (this.canvas.width !== w * dpr || this.canvas.height !== hgt * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = hgt * dpr;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${hgt}px`;
      this.baseKey = "";
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const explored = me?.explored ?? "";
    const key = `${s.id}|${s.cols}x${s.rows}|${explored}`;
    if (key !== this.baseKey || !this.base) {
      this.base = this.drawBase(s, explored, k * dpr);
      this.baseKey = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    const seen = (x: number, y: number): boolean => explored[y * s.cols + x] === "1";

    // objects: castles in owner colours, mines gold, sites blue; monsters are left out to keep it readable
    for (const o of s.objects) {
      if (o.gone || !seen(o.x, o.y)) continue;
      if (o.kind === "castle") {
        ctx.fillStyle = OWNER_COLOR[ownerColor(s, o.owner)];
        ctx.fillRect(o.x - 0.6, o.y - 0.6, 2.2, 2.2);
      } else if (o.kind === "mine") {
        ctx.fillStyle = o.owner ? OWNER_COLOR[ownerColor(s, o.owner)] : "#e3c14b";
        ctx.fillRect(o.x, o.y, 1.2, 1.2);
      } else if (o.kind === "site") {
        ctx.fillStyle = "#8fd1ff";
        ctx.fillRect(o.x, o.y, 1.1, 1.1);
      }
    }
    // heroes: own ones with a light rim, the active one larger
    const active = myHero(view);
    for (const hero of Object.values(s.heroes)) {
      if (!hero.alive) continue;
      const own = hero.owner === view.you;
      const r = hero.id === active?.id ? 1.3 : 0.95;
      ctx.beginPath();
      ctx.arc(hero.x + 0.5, hero.y + 0.5, r, 0, Math.PI * 2);
      ctx.fillStyle = OWNER_COLOR[ownerColor(s, hero.owner)];
      ctx.fill();
      if (own) {
        ctx.lineWidth = 0.35;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
    }
    // the visible area
    const rect = this.hooks.scene()?.visibleTiles();
    if (rect) {
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = "rgba(240,211,138,.95)";
      const x0 = Math.max(0, rect.x);
      const y0 = Math.max(0, rect.y);
      const x1 = Math.min(s.cols, rect.x + rect.w);
      const y1 = Math.min(s.rows, rect.y + rect.h);
      ctx.strokeRect(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
    }
  }

  /** Terrain of explored tiles and black fog elsewhere, at device pixels. */
  private drawBase(s: GameState, explored: string, k: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext("2d");
    if (!ctx) return c;
    ctx.fillStyle = "#0b0c10";
    ctx.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < s.rows; y++) {
      const row = s.terrain[y] ?? "";
      for (let x = 0; x < s.cols; x++) {
        if (explored[y * s.cols + x] !== "1") continue;
        ctx.fillStyle = TERRAIN_COLOR[row[x] ?? "."] ?? TERRAIN_COLOR["."]!;
        ctx.fillRect(Math.floor(x * k), Math.floor(y * k), Math.ceil(k), Math.ceil(k));
      }
    }
    return c;
  }
}

/** The game's chronicle (newest first) for the log panel. */
export function chronicle(view: PlayerView): string[] {
  return [...view.state.log].reverse();
}
