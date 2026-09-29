/**
 * Canvas drawing code ported from docs/prototype.html (drawFlagman, drawCastle, unitIcon, drawArt,
 * terrain, mines, chests, hexes). Coordinates are in prototype units (a map tile is 42 units);
 * BootScene scales them when baking textures.
 */
import type { ArtifactDef, UnitId } from "@korony/shared";

type Ctx = CanvasRenderingContext2D;

export const COLORS = {
  blue: "#4a7cc4",
  red: "#c24a3e",
  grey: "#6c6a70",
  text: "#ebe2cb",
  gold: "#d9a946",
} as const;

/** Banner (shop cosmetic) flag colours. */
export const BANNER_COLORS: Record<string, string> = {
  gold: "#e3c14b",
  crimson: "#9e1b2a",
  emerald: "#2fa56a",
};

const TAU = Math.PI * 2;

/** Prototype hero on horseback with a flag; `flag` defaults to the body colour. */
export function drawFlagman(ctx: Ctx, x: number, y: number, s: number, color: string, flag: string = color): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath();
  ctx.ellipse(0, 12, 14, 4, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#6b4a2e";
  ctx.beginPath();
  ctx.ellipse(0, 4, 12, 6, 0, 0, TAU);
  ctx.fill();
  ctx.fillRect(-10, 6, 3, 8);
  ctx.fillRect(7, 6, 3, 8);
  ctx.beginPath();
  ctx.moveTo(9, 2);
  ctx.lineTo(16, -6);
  ctx.lineTo(18, -3);
  ctx.lineTo(12, 5);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(-4, -10, 8, 12);
  ctx.fillStyle = "#e8c9a0";
  ctx.beginPath();
  ctx.arc(0, -13, 4, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-6, 6);
  ctx.lineTo(-6, -26);
  ctx.stroke();
  ctx.fillStyle = flag;
  ctx.beginPath();
  ctx.moveTo(-6, -26);
  ctx.lineTo(8, -22);
  ctx.lineTo(-6, -17);
  ctx.fill();
  if (flag !== color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/** Prototype castle: towers, gate, roof and flag in the owner's colour. */
export function drawCastle(ctx: Ctx, x: number, y: number, s: number, color: string, flag: string = color): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fillRect(-26, 18, 54, 6);
  ctx.fillStyle = "#9c937f";
  ctx.fillRect(-24, -6, 48, 26);
  ctx.fillStyle = "#b8ae97";
  ctx.fillRect(-28, -18, 12, 38);
  ctx.fillRect(16, -18, 12, 38);
  ctx.fillRect(-7, -28, 14, 30);
  ctx.fillStyle = "#3b2a1c";
  ctx.beginPath();
  ctx.moveTo(-6, 20);
  ctx.lineTo(-6, 10);
  ctx.arc(0, 10, 6, Math.PI, 0);
  ctx.lineTo(6, 20);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-7, -28);
  ctx.lineTo(0, -42);
  ctx.lineTo(7, -28);
  ctx.fill();
  ctx.fillStyle = flag;
  ctx.fillRect(0, -54, 11, 6);
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -42);
  ctx.lineTo(0, -54);
  ctx.stroke();
  ctx.restore();
}

export type IconKind = "sword" | "bow" | "griffin" | "skel" | "ghost" | "wolf" | "lich";

export const UNIT_ICON: Record<UnitId, IconKind> = {
  pike: "sword",
  halberd: "sword",
  archer: "bow",
  marksman: "bow",
  griffin: "griffin",
  royalGriffin: "griffin",
  skeleton: "skel",
  ghost: "ghost",
  lich: "lich",
  wolf: "wolf",
};

/** Prototype unit icon of radius `r` centred at (cx, cy). */
export function unitIcon(ctx: Ctx, cx: number, cy: number, r: number, kind: IconKind, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.75, r * 0.8, r * 0.25, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = color;
  if (kind === "sword") {
    ctx.fillRect(-r * 0.35, -r * 0.4, r * 0.7, r * 0.9);
    ctx.fillStyle = "#cfd3da";
    ctx.fillRect(r * 0.4, -r * 1.1, r * 0.12, r * 1.4);
    ctx.fillStyle = "#e8c9a0";
    ctx.beginPath();
    ctx.arc(0, -r * 0.6, r * 0.28, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#9aa0aa";
    ctx.fillRect(-r * 0.7, -r * 0.3, r * 0.35, r * 0.6);
  } else if (kind === "bow") {
    ctx.fillRect(-r * 0.3, -r * 0.4, r * 0.6, r * 0.9);
    ctx.fillStyle = "#e8c9a0";
    ctx.beginPath();
    ctx.arc(0, -r * 0.6, r * 0.26, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#8a5a2b";
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.arc(r * 0.35, -r * 0.1, r * 0.55, -1.2, 1.2);
    ctx.stroke();
  } else if (kind === "griffin") {
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.6, r * 0.35, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#c9a15a";
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.1);
    ctx.lineTo(-r * 0.9, -r * 0.9);
    ctx.lineTo(r * 0.1, -r * 0.3);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.2, -r * 0.1);
    ctx.lineTo(r * 0.8, -r * 0.95);
    ctx.lineTo(r * 0.45, -r * 0.1);
    ctx.fill();
    ctx.fillStyle = "#eee";
    ctx.beginPath();
    ctx.arc(r * 0.6, -r * 0.2, r * 0.2, 0, TAU);
    ctx.fill();
  } else if (kind === "skel") {
    ctx.fillStyle = "#ddd8c8";
    ctx.fillRect(-r * 0.1, -r * 0.3, r * 0.2, r * 0.8);
    ctx.beginPath();
    ctx.arc(0, -r * 0.55, r * 0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.fillRect(-r * 0.15, -r * 0.6, r * 0.1, r * 0.1);
    ctx.fillRect(r * 0.05, -r * 0.6, r * 0.1, r * 0.1);
    ctx.fillStyle = color;
    ctx.fillRect(-r * 0.6, -r * 0.2, r * 0.35, r * 0.6);
  } else if (kind === "ghost") {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#b9c8d8";
    ctx.beginPath();
    ctx.arc(0, -r * 0.2, r * 0.5, Math.PI, 0);
    ctx.lineTo(r * 0.5, r * 0.5);
    for (let i = 0; i < 4; i++) ctx.lineTo(r * 0.5 - (i + 0.5) * r * 0.25, r * (i % 2 ? 0.5 : 0.3));
    ctx.lineTo(-r * 0.5, r * 0.5);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(-r * 0.15, -r * 0.25, r * 0.08, 0, TAU);
    ctx.arc(r * 0.15, -r * 0.25, r * 0.08, 0, TAU);
    ctx.fill();
  } else if (kind === "wolf") {
    ctx.fillStyle = "#77757c";
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, 0, r * 0.55, r * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.15);
    ctx.lineTo(r * 0.8, -r * 0.5);
    ctx.lineTo(r * 0.75, r * 0.05);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.45, -r * 0.35);
    ctx.lineTo(r * 0.5, -r * 0.7);
    ctx.lineTo(r * 0.6, -r * 0.4);
    ctx.fill();
    ctx.fillRect(-r * 0.5, r * 0.1, r * 0.12, r * 0.45);
    ctx.fillRect(r * 0.15, r * 0.1, r * 0.12, r * 0.45);
    ctx.fillStyle = color;
    ctx.fillRect(-r * 0.35, -r * 0.35, r * 0.3, r * 0.1);
  } else {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.9);
    ctx.lineTo(r * 0.5, r * 0.5);
    ctx.lineTo(-r * 0.5, r * 0.5);
    ctx.fill();
    ctx.fillStyle = "#ddd8c8";
    ctx.beginPath();
    ctx.arc(0, -r * 0.55, r * 0.22, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#7fd1ff";
    ctx.beginPath();
    ctx.arc(r * 0.55, -r * 0.5, r * 0.14, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Gold diamond the prototype draws next to upgraded stacks (relative to the icon centre). */
export function upgradedMarker(ctx: Ctx, cx: number, cy: number, k = 1): void {
  ctx.fillStyle = "#f0d38a";
  ctx.strokeStyle = "rgba(0,0,0,.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 26 * k, cy - 26 * k);
  ctx.lineTo(cx - 22 * k, cy - 20 * k);
  ctx.lineTo(cx - 26 * k, cy - 14 * k);
  ctx.lineTo(cx - 30 * k, cy - 20 * k);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

const RARITY_GLOW = ["rgba(230,220,190,.35)", "rgba(95,163,224,.45)", "rgba(181,123,224,.5)", "rgba(240,166,74,.6)"];

/** Rarity colours used in text (same as the prototype's .r0-.r3 classes). */
export const RARITY_TEXT = ["#d8cfb6", "#6fb0ec", "#c08cf0", "#f0a64a"];

/** Prototype artifact pictogram: a glow in the rarity colour and a shape per slot. */
export function drawArt(ctx: Ctx, cx: number, cy: number, a: ArtifactDef): void {
  ctx.fillStyle = RARITY_GLOW[a.rarity] ?? RARITY_GLOW[0] ?? "#fff";
  ctx.beginPath();
  ctx.arc(cx, cy, 16, 0, TAU);
  ctx.fill();
  const sl = a.slot;
  if (sl === "weapon") {
    ctx.fillStyle = a.set ? "#9aa0a8" : "#dfe3ea";
    ctx.fillRect(cx - 2, cy - 14, 4, 20);
    ctx.fillStyle = "#d9a946";
    ctx.fillRect(cx - 7, cy + 4, 14, 3);
  } else if (sl === "shield") {
    ctx.fillStyle = "#b9862f";
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy - 10);
    ctx.lineTo(cx + 10, cy - 10);
    ctx.lineTo(cx + 8, cy + 4);
    ctx.lineTo(cx, cy + 12);
    ctx.lineTo(cx - 8, cy + 4);
    ctx.fill();
  } else if (sl === "ring") {
    ctx.strokeStyle = "#e3c14b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy + 2, 7, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = a.rarity ? "#7fd1ff" : "#e05a7a";
    ctx.beginPath();
    ctx.arc(cx, cy - 6, 3.5, 0, TAU);
    ctx.fill();
  } else if (sl === "head") {
    ctx.fillStyle = a.set ? "#8d8f98" : "#e3c14b";
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 6);
    ctx.lineTo(cx - 10, cy - 4);
    ctx.lineTo(cx - 5, cy + 1);
    ctx.lineTo(cx, cy - 9);
    ctx.lineTo(cx + 5, cy + 1);
    ctx.lineTo(cx + 10, cy - 4);
    ctx.lineTo(cx + 10, cy + 6);
    ctx.fill();
  } else if (sl === "torso") {
    ctx.fillStyle = a.set ? "#8d8f98" : "#a07a4a";
    ctx.fillRect(cx - 8, cy - 8, 16, 18);
    ctx.fillRect(cx - 12, cy - 8, 4, 8);
    ctx.fillRect(cx + 8, cy - 8, 4, 8);
  } else if (sl === "feet") {
    ctx.fillStyle = "#6b4a2e";
    ctx.fillRect(cx - 9, cy - 8, 6, 14);
    ctx.fillRect(cx - 9, cy + 3, 10, 5);
    ctx.fillRect(cx + 2, cy - 8, 6, 14);
    ctx.fillRect(cx + 2, cy + 3, 10, 5);
  } else if (sl === "neck") {
    ctx.strokeStyle = "#e3c14b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy - 6, 8, 0.2, Math.PI - 0.2);
    ctx.stroke();
    ctx.fillStyle = a.rarity === 3 ? "#7fd1ff" : "#6fae5a";
    ctx.beginPath();
    ctx.arc(cx, cy + 5, 6, 0, TAU);
    ctx.fill();
  } else if (sl === "shoulders") {
    ctx.fillStyle = "#b9862f";
    ctx.beginPath();
    ctx.ellipse(cx - 7, cy, 7, 5, -0.4, 0, TAU);
    ctx.ellipse(cx + 7, cy, 7, 5, 0.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#e3c14b";
    ctx.fillRect(cx - 2, cy - 3, 4, 8);
  } else {
    // cloak (and anything else): the prototype's trapezoid
    ctx.fillStyle = "#4a7cc4";
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - 10);
    ctx.lineTo(cx + 9, cy - 10);
    ctx.lineTo(cx + 12, cy + 12);
    ctx.lineTo(cx - 12, cy + 12);
    ctx.fill();
  }
}

/** Gold mine with an optional owner flag (prototype drawMap). */
export function drawMine(ctx: Ctx, cx: number, cy: number, owner: string | null): void {
  ctx.fillStyle = "#5a4a3a";
  ctx.beginPath();
  ctx.moveTo(cx - 17, cy + 14);
  ctx.lineTo(cx, cy - 12);
  ctx.lineTo(cx + 17, cy + 14);
  ctx.fill();
  ctx.fillStyle = "#1b120b";
  ctx.fillRect(cx - 6, cy + 2, 12, 12);
  ctx.fillStyle = "#e3c14b";
  ctx.beginPath();
  ctx.arc(cx + 12, cy + 11, 4, 0, TAU);
  ctx.fill();
  if (owner) {
    ctx.fillStyle = owner;
    ctx.fillRect(cx - 1, cy - 22, 9, 6);
    ctx.fillStyle = "#ddd";
    ctx.fillRect(cx - 2, cy - 22, 1.5, 12);
  }
}

export function drawChest(ctx: Ctx, cx: number, cy: number): void {
  ctx.fillStyle = "#7a4a22";
  ctx.fillRect(cx - 10, cy - 3, 20, 12);
  ctx.fillStyle = "#94592a";
  ctx.fillRect(cx - 10, cy - 9, 20, 7);
  ctx.fillStyle = "#e3c14b";
  ctx.fillRect(cx - 2, cy - 4, 4, 5);
}

export type TerrainChar = "." | "F" | "M" | "W";

const TERRAIN_FILL: Record<TerrainChar, [string, string]> = {
  ".": ["#5e8a3c", "#64903f"],
  F: ["#3e6b2e", "#437232"],
  M: ["#7c7a6e", "#838175"],
  W: ["#2f6690", "#336c96"],
};

/**
 * One terrain tile of size T (42 in the prototype) at (0, 0). `checker` picks the alternating
 * background shade, `deco` holds three [0,1) numbers for the decoration as in the prototype.
 */
export function drawTerrainTile(ctx: Ctx, t: TerrainChar, checker: 0 | 1, deco: [number, number, number], T = 42): void {
  const fill = TERRAIN_FILL[t] ?? TERRAIN_FILL["."];
  ctx.fillStyle = fill[checker];
  ctx.fillRect(0, 0, T, T);
  const cx = T / 2;
  const cy = T / 2;
  if (t === "." && deco[0] < 0.35) {
    ctx.fillStyle = "#79a650";
    ctx.fillRect(deco[1] * 34, deco[2] * 34, 4, 4);
  }
  if (t === "F") {
    for (let k = 0; k < 3; k++) {
      const ox = (k - 1) * 11;
      const oy = (k % 2) * 7;
      ctx.fillStyle = "#24461c";
      ctx.beginPath();
      ctx.moveTo(cx + ox, cy - 17 + oy);
      ctx.lineTo(cx + ox + 9, cy + 7 + oy);
      ctx.lineTo(cx + ox - 9, cy + 7 + oy);
      ctx.fill();
    }
  }
  if (t === "M") {
    ctx.fillStyle = "#5b5a52";
    ctx.beginPath();
    ctx.moveTo(cx - 19, cy + 14);
    ctx.lineTo(cx - 3, cy - 16);
    ctx.lineTo(cx + 12, cy + 14);
    ctx.fill();
    ctx.fillStyle = "#e9e6dc";
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy - 7);
    ctx.lineTo(cx - 3, cy - 16);
    ctx.lineTo(cx + 1, cy - 7);
    ctx.fill();
  }
  if (t === "W" && deco[0] < 0.5) {
    ctx.strokeStyle = "#5c93bf";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx - 5, cy, 5, 3.6, 5.8);
    ctx.arc(cx + 5, cy, 5, 3.6, 5.8);
    ctx.stroke();
  }
}

/** Pointy-top hexagon path of radius r around (cx, cy), as the prototype battle grid. */
export function hexPath(ctx: Ctx, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
}

/** Battle obstacle (two grey boulders). */
export function drawRock(ctx: Ctx, cx: number, cy: number): void {
  ctx.fillStyle = "#6e6a60";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 5, 22, 14, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#8a867a";
  ctx.beginPath();
  ctx.ellipse(cx - 4, cy, 14, 9, 0, 0, TAU);
  ctx.fill();
}

/** Deterministic decoration numbers for a map tile (so the map looks the same on every render). */
export function tileDeco(x: number, y: number): [number, number, number] {
  let h = (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;
  const next = (): number => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return [next(), next(), next()];
}
