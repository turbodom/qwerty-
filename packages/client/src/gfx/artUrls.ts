/** URLs of the painted pictures in public/art (served next to index.html). */
import type { ArtifactId, BuildingId, SkillId, SpellId, UnitId } from "@korony/shared";

export function artUrl(name: string): string {
  return `/art/${name}.webp`;
}

/** Painted landscape of a whole adventure map, laid out over its terrain grid. */
export function mapArtName(mapId: string): string {
  return `map-${mapId}`;
}

export function unitArtName(unit: UnitId): string {
  return `unit-${unit}`;
}

export const artifactIconUrl = (id: ArtifactId): string => artUrl(`art-${id}`);
export const unitPicUrl = (unit: UnitId): string => artUrl(unitArtName(unit));
export const skillIconUrl = (id: SkillId): string => artUrl(`skill-${id}`);
export const spellIconUrl = (id: SpellId): string => artUrl(`spell-${id}`);
export const buildingIconUrl = (id: BuildingId): string => artUrl(`bld-${id}`);

/** Hero figure detail level from the number of worn items: 0 light gear, 1 armoured, 2 fully kitted. */
export function gearTier(worn: number): 0 | 1 | 2 {
  return worn >= 6 ? 2 : worn >= 3 ? 1 : 0;
}

export function heroBodyUrl(side: "player" | "enemy", tier: 0 | 1 | 2): string {
  return artUrl(`hero-body-${side}-${tier}`);
}
