/**
 * Painted art (generated pictures in public/art). BootScene loads them and bakes them into the same
 * texture boxes as the prototype drawings, so the scenes keep their geometry. A picture that fails to
 * load falls back to the drawing from draw.ts.
 */
import { UNITS } from "@korony/shared";
import type { UnitId } from "@korony/shared";
import { bake } from "./bake";
import type { Baked, Box } from "./bake";
import { upgradedMarker } from "./draw";
export { artUrl, unitArtName } from "./artUrls";
import type { TerrainChar } from "./draw";

export type Pic = CanvasImageSource & { width: number; height: number };

/** File names (without extension) that BootScene loads into Phaser. */
export const SCENE_ART: readonly string[] = [
  "tex-grass", "tex-water", "forest1", "forest2", "mount1", "mount2",
  "castle-castle", "castle-necro", "hero-knight", "hero-necro", "mine", "chest",
  "battle-bg", "rock1", "rock2",
];

/** Draws `pic` scaled to fit maxW x maxH, centred on cx with its bottom edge at `bottom`. */
function fit(ctx: CanvasRenderingContext2D, pic: Pic, cx: number, bottom: number, maxW: number, maxH: number, flip = false): void {
  const k = Math.min(maxW / pic.width, maxH / pic.height);
  const w = pic.width * k;
  const h = pic.height * k;
  ctx.save();
  ctx.imageSmoothingQuality = "high";
  if (flip) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }
  ctx.drawImage(pic, cx - w / 2, bottom - h, w, h);
  ctx.restore();
}

/** Owner-coloured ellipse on the ground under a sprite. */
function base(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

/** Small pennant on a pole; `x`,`y` is the pole foot. */
function pennant(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = "#2a2118";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - h);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,.6)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + h * 0.6, y - h * 0.8);
  ctx.lineTo(x, y - h * 0.58);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Map tiles take one cell of a PAINT_GRID x PAINT_GRID split of a seamless texture, so the texture keeps its detail. */
export const PAINT_GRID = 4;
export const PAINT_VARIANTS = PAINT_GRID * PAINT_GRID;

/** Texture cell of map tile (x, y), used as the tile's variant when the terrain is painted. */
export function paintVariant(x: number, y: number): number {
  return (x % PAINT_GRID) + (y % PAINT_GRID) * PAINT_GRID;
}

function tile(ctx: CanvasRenderingContext2D, pic: Pic, checker: 0 | 1, variant: number, T: number): void {
  const cw = pic.width / PAINT_GRID;
  const ch = pic.height / PAINT_GRID;
  ctx.drawImage(pic, (variant % PAINT_GRID) * cw, Math.floor(variant / PAINT_GRID) * ch, cw, ch, 0, 0, T, T);
  if (checker) {
    ctx.fillStyle = "rgba(0,0,0,.05)";
    ctx.fillRect(0, 0, T, T);
  }
}

export interface PaintedTerrain {
  grass: Pic;
  water: Pic | null;
  forest: [Pic | null, Pic | null];
  mount: [Pic | null, Pic | null];
}

/** Terrain tile (prototype size 42) painted from textures; null when a needed picture is missing. */
export function paintTerrain(p: PaintedTerrain, t: TerrainChar, checker: 0 | 1, variant: number, scale: number): Baked | null {
  const T = 42;
  const box: Box = { x0: 0, y0: 0, x1: T, y1: T };
  const water = p.water;
  if (t === "W") return water ? bake(box, scale, (ctx) => tile(ctx, water, checker, variant, T)) : null;
  if (t === "F") {
    const f = p.forest[variant % 2] ?? p.forest[0];
    if (!f) return null;
    return bake(box, scale, (ctx) => {
      tile(ctx, p.grass, checker, variant, T);
      fit(ctx, f, T / 2, T, T, T);
    });
  }
  if (t === "M") {
    const m = p.mount[variant % 2] ?? p.mount[0];
    if (!m) return null;
    return bake(box, scale, (ctx) => {
      tile(ctx, p.grass, checker, variant, T);
      fit(ctx, m, T / 2, T - 1, T, T - 2);
    });
  }
  return bake(box, scale, (ctx) => tile(ctx, p.grass, checker, variant, T));
}

export function paintCastle(pic: Pic, color: string, flag: string, scale: number): Baked {
  return bake({ x0: -32, y0: -56, x1: 32, y1: 22 }, scale, (ctx) => {
    base(ctx, 0, 14, 28, 7, color);
    fit(ctx, pic, 0, 19, 62, 70);
    pennant(ctx, 22, -30, 22, flag);
  });
}

export function paintHero(pic: Pic, color: string, flag: string, scale: number): Baked {
  return bake({ x0: -24, y0: -38, x1: 24, y1: 18 }, scale, (ctx) => {
    base(ctx, 0, 12, 17, 5, color);
    fit(ctx, pic, 0, 16, 46, 50);
    pennant(ctx, -15, -6, 24, flag);
  });
}

export function paintMine(pic: Pic, color: string | null, scale: number): Baked {
  return bake({ x0: -21, y0: -30, x1: 21, y1: 18 }, scale, (ctx) => {
    if (color) base(ctx, 0, 11, 18, 5, color);
    fit(ctx, pic, 0, 16, 40, 40);
    if (color) pennant(ctx, 14, -8, 18, color);
  });
}

export function paintChest(pic: Pic, scale: number): Baked {
  return bake({ x0: -15, y0: -14, x1: 15, y1: 14 }, scale, (ctx) => fit(ctx, pic, 0, 13, 28, 26));
}

/** Artifact lying on the map: the icon over a soft golden glow. */
export function paintArtifact(pic: Pic, scale: number): Baked {
  return bake({ x0: -17, y0: -17, x1: 17, y1: 17 }, scale, (ctx) => {
    const g = ctx.createRadialGradient(0, 2, 2, 0, 2, 16);
    g.addColorStop(0, "rgba(255,220,120,.55)");
    g.addColorStop(1, "rgba(255,220,120,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-17, -17, 34, 34);
    fit(ctx, pic, 0, 15, 28, 28);
  });
}

/** Battle stack (prototype box of radius 28): owner-coloured base, the creature, the upgraded marker. */
export function paintUnit(pic: Pic, unit: UnitId, color: string, scale: number, flip = false): Baked {
  return bake({ x0: -32, y0: -32, x1: 32, y1: 30 }, scale, (ctx) => {
    base(ctx, 0, 21, 22, 7, color);
    fit(ctx, pic, 0, 27, 60, 58, flip);
    if (UNITS[unit].upgraded) upgradedMarker(ctx, 0, 0);
  });
}

export function paintRock(pic: Pic, scale: number): Baked {
  return bake({ x0: -26, y0: -24, x1: 26, y1: 20 }, scale, (ctx) => fit(ctx, pic, 0, 19, 50, 42));
}

export function paintBattleBg(pic: Pic, w: number, h: number): Baked {
  return bake({ x0: 0, y0: 0, x1: w, y1: h }, 1, (ctx) => {
    const k = Math.max(w / pic.width, h / pic.height);
    ctx.drawImage(pic, (w - pic.width * k) / 2, (h - pic.height * k) / 2, pic.width * k, pic.height * k);
  });
}
