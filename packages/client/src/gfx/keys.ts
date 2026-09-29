/** Texture keys and geometry shared by BootScene (which bakes textures) and the scenes that use them. */
import type { ArtifactId, UnitId } from "@korony/shared";
import type { TerrainChar } from "./draw";

/** Map tile size in world units. */
export const TILE = 64;
/** Prototype map tile size; map textures are baked at TILE / PROTO_TILE. */
export const PROTO_TILE = 42;
export const MAP_K = TILE / PROTO_TILE;

/** Battle hex radius in world units (prototype: 34). */
export const HEX_R = 48;
export const PROTO_HEX_R = 34;
export const BATTLE_K = HEX_R / PROTO_HEX_R;
/** Horizontal distance between hex centres. */
export const HEX_W = Math.sqrt(3) * HEX_R;
/** Margin around the battle grid in world units. */
export const BATTLE_MARGIN = 16;
/** Battle field size in world units: 8 columns (odd rows shifted half a hex) x 11 rows. */
export const BATTLE_W = Math.ceil(8.5 * HEX_W + 2 * BATTLE_MARGIN);
export const BATTLE_H = Math.ceil(17 * HEX_R + 2 * BATTLE_MARGIN);

export type ColorKey = "blue" | "red" | "grey";
export const COLOR_KEYS: readonly ColorKey[] = ["blue", "red", "grey"];
export const BANNER_KEYS: readonly string[] = ["none", "gold", "crimson", "emerald"];

export const TEX = {
  pixel: "px",
  chest: "chest",
  hex: "hex",
  hexReach: "hex-reach",
  hexAttack: "hex-attack",
  hexActive: "hex-active",
  hexSelect: "hex-select",
  rock: "rock",
  battleBg: "battle-bg",
  dotGreen: "dot-green",
  dotRed: "dot-red",
  crossGreen: "cross-green",
  crossRed: "cross-red",
  arrow: "arrow",
  tileMark: "tile-mark",
} as const;

/** Number of plain-tile decoration variants (0 = no grass speck). */
export const PLAIN_VARIANTS = 4;

export function terrainKey(t: TerrainChar, checker: 0 | 1, variant: number): string {
  const name = t === "." ? "plain" : t === "F" ? "forest" : t === "M" ? "mount" : "water";
  return `t-${name}-${checker}-${variant}`;
}

function bannerPart(banner: string | undefined): string {
  return banner && BANNER_KEYS.includes(banner) ? banner : "none";
}

export function castleKey(color: ColorKey, banner?: string): string {
  return `castle-${color}-${bannerPart(banner)}`;
}

export function heroKey(color: ColorKey, banner?: string): string {
  return `hero-${color}-${bannerPart(banner)}`;
}

export function mineKey(color: ColorKey | null): string {
  return `mine-${color ?? "free"}`;
}

export function artKey(id: ArtifactId): string {
  return `art-${id}`;
}

export function unitKey(unit: UnitId, color: ColorKey): string {
  return `unit-${unit}-${color}`;
}

/** Origins (0..1) of baked textures, so sprites can be placed at the prototype's anchor point. */
export const ORIGINS = new Map<string, { x: number; y: number }>();

export function originOf(key: string): { x: number; y: number } {
  return ORIGINS.get(key) ?? { x: 0.5, y: 0.5 };
}
