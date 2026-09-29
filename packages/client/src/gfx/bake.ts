/**
 * Bakes the prototype drawings into canvases. Used by BootScene (Phaser textures) and by the DOM panels
 * (small data-URL icons), so the map, the battle and the panels share one look.
 */
import { ARTIFACTS, UNITS } from "@korony/shared";
import type { ArtifactId, UnitId } from "@korony/shared";
import {
  BANNER_COLORS, COLORS, UNIT_ICON, drawArt, drawCastle, drawChest, drawFlagman, drawMine, drawRock, drawTerrainTile,
  hexPath, unitIcon, upgradedMarker,
} from "./draw";
import type { TerrainChar } from "./draw";
import type { ColorKey } from "./keys";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Baked {
  canvas: HTMLCanvasElement;
  /** Anchor (the drawing's (0,0)) as a fraction of the canvas size. */
  origin: { x: number; y: number };
}

/** Draws `draw` (in its own units, anchor at 0,0) into a canvas covering `box`, scaled by `scale`. */
export function bake(box: Box, scale: number, draw: (ctx: CanvasRenderingContext2D) => void): Baked {
  const w = Math.max(1, Math.ceil((box.x1 - box.x0) * scale));
  const h = Math.max(1, Math.ceil((box.y1 - box.y0) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(scale, scale);
    ctx.translate(-box.x0, -box.y0);
    draw(ctx);
  }
  return { canvas, origin: { x: -box.x0 / (box.x1 - box.x0), y: -box.y0 / (box.y1 - box.y0) } };
}

export function colorHex(c: ColorKey): string {
  return c === "blue" ? COLORS.blue : c === "red" ? COLORS.red : COLORS.grey;
}

function flagColor(color: ColorKey, banner: string): string {
  return BANNER_COLORS[banner] ?? colorHex(color);
}

// ================= individual pictures (prototype units) =================

/** Castle as drawn on the map (prototype scale .8 already applied). */
export function bakeCastle(color: ColorKey, banner: string, scale: number): Baked {
  return bake({ x0: -24, y0: -45, x1: 24, y1: 21 }, scale, (ctx) =>
    drawCastle(ctx, 0, 0, 0.8, colorHex(color), flagColor(color, banner)),
  );
}

/** Hero on horseback as drawn on the map (prototype scale .95). */
export function bakeHero(color: ColorKey, banner: string, scale: number): Baked {
  return bake({ x0: -15, y0: -27, x1: 19, y1: 17 }, scale, (ctx) =>
    drawFlagman(ctx, 0, 0, 0.95, colorHex(color), flagColor(color, banner)),
  );
}

export function bakeMine(color: ColorKey | null, scale: number): Baked {
  return bake({ x0: -18, y0: -23, x1: 18, y1: 16 }, scale, (ctx) => drawMine(ctx, 0, 0, color ? colorHex(color) : null));
}

export function bakeChest(scale: number): Baked {
  return bake({ x0: -11, y0: -10, x1: 11, y1: 10 }, scale, (ctx) => drawChest(ctx, 0, 0));
}

export function bakeArt(id: ArtifactId, scale: number): Baked {
  return bake({ x0: -17, y0: -17, x1: 17, y1: 17 }, scale, (ctx) => drawArt(ctx, 0, 0, ARTIFACTS[id]));
}

/** Unit icon of prototype radius 28 (battle size) with the upgraded marker for upgraded units. */
export function bakeUnit(unit: UnitId, color: ColorKey, scale: number): Baked {
  const r = 28;
  return bake({ x0: -32, y0: -32, x1: 32, y1: 30 }, scale, (ctx) => {
    unitIcon(ctx, 0, 0, r, UNIT_ICON[unit], colorHex(color));
    if (UNITS[unit].upgraded) upgradedMarker(ctx, 0, 0);
  });
}

export function bakeTerrain(t: TerrainChar, checker: 0 | 1, variant: number, scale: number): Baked {
  // variant -> fixed decoration numbers (plain: speck position, water: waves or not)
  const specks: [number, number][] = [[0.2, 0.3], [0.7, 0.6], [0.45, 0.8]];
  let deco: [number, number, number] = [1, 0, 0];
  if (t === "." && variant > 0) {
    const sp = specks[(variant - 1) % specks.length] ?? [0.5, 0.5];
    deco = [0, sp[0], sp[1]];
  } else if (t === "W" && variant > 0) {
    deco = [0, 0, 0];
  }
  return bake({ x0: 0, y0: 0, x1: 42, y1: 42 }, scale, (ctx) => drawTerrainTile(ctx, t, checker, deco, 42));
}

export function bakeHex(kind: "base" | "reach" | "attack" | "active" | "select", r: number): Baked {
  return bake({ x0: -r, y0: -r, x1: r, y1: r }, 1, (ctx) => {
    if (kind === "active") {
      hexPath(ctx, 0, 0, r - 3);
      ctx.strokeStyle = "#f0d38a";
      ctx.lineWidth = 5;
      ctx.stroke();
      return;
    }
    if (kind === "select") {
      ctx.beginPath();
      ctx.arc(0, 0, r - 7, 0, Math.PI * 2);
      ctx.strokeStyle = "#ff8a7a";
      ctx.lineWidth = 4;
      ctx.stroke();
      return;
    }
    hexPath(ctx, 0, 0, r - 2);
    const fill = kind === "reach" ? "rgba(217,169,70,.28)" : kind === "attack" ? "rgba(224,98,90,.30)" : "rgba(0,0,0,.07)";
    const stroke = kind === "reach" ? "rgba(240,211,138,.7)" : kind === "attack" ? "rgba(255,138,122,.8)" : "rgba(0,0,0,.22)";
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  });
}

export function bakeRock(scale: number): Baked {
  return bake({ x0: -23, y0: -10, x1: 23, y1: 20 }, scale, (ctx) => drawRock(ctx, 0, 0));
}

export function bakeBattleBg(w: number, h: number): Baked {
  return bake({ x0: 0, y0: 0, x1: w, y1: h }, 1, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#556b3a");
    g.addColorStop(1, "#6f8a45");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // a few darker grass tufts, deterministic
    ctx.fillStyle = "rgba(40,60,25,.18)";
    for (let i = 0; i < 70; i++) {
      const x = (i * 97.13) % w;
      const y = (i * 53.71 + (i % 7) * 31) % h;
      ctx.fillRect(x, y, 5, 3);
    }
  });
}

export function bakeDot(color: string, cross: boolean, scale: number): Baked {
  return bake({ x0: -9, y0: -9, x1: 9, y1: 9 }, scale, (ctx) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (cross) {
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-7, -7);
      ctx.lineTo(7, 7);
      ctx.moveTo(7, -7);
      ctx.lineTo(-7, 7);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });
}

export function bakeArrow(scale: number): Baked {
  return bake({ x0: -14, y0: -3, x1: 14, y1: 3 }, scale, (ctx) => {
    ctx.strokeStyle = "#f3e7c8";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-13, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();
    ctx.fillStyle = "#f3e7c8";
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(8, -3);
    ctx.lineTo(8, 3);
    ctx.fill();
  });
}

/** Rounded gold frame marking the planned target tile. */
export function bakeTileMark(size: number): Baked {
  return bake({ x0: 0, y0: 0, x1: size, y1: size }, 1, (ctx) => {
    ctx.strokeStyle = "rgba(240,211,138,.85)";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, size - 4, size - 4);
  });
}

// ================= DOM icons =================

const urlCache = new Map<string, string>();

function toUrl(key: string, make: () => Baked): string {
  const hit = urlCache.get(key);
  if (hit) return hit;
  let url = "";
  try {
    url = make().canvas.toDataURL("image/png");
  } catch {
    url = "";
  }
  urlCache.set(key, url);
  return url;
}

export function artIconUrl(id: ArtifactId): string {
  return toUrl(`art-${id}`, () => bakeArt(id, 2));
}

export function unitIconUrl(unit: UnitId, color: ColorKey): string {
  return toUrl(`unit-${unit}-${color}`, () => bakeUnit(unit, color, 1.2));
}
