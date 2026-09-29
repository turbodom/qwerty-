/** URLs of the painted pictures in public/art (served next to index.html). */
import type { ArtifactId, BuildingId, SkillId, SpellId, UnitId } from "@korony/shared";

export function artUrl(name: string): string {
  return `/art/${name}.webp`;
}

export function unitArtName(unit: UnitId): string {
  return `unit-${unit}`;
}

export const artifactIconUrl = (id: ArtifactId): string => artUrl(`art-${id}`);
export const unitPicUrl = (unit: UnitId): string => artUrl(unitArtName(unit));
export const skillIconUrl = (id: SkillId): string => artUrl(`skill-${id}`);
export const spellIconUrl = (id: SpellId): string => artUrl(`spell-${id}`);
export const buildingIconUrl = (id: BuildingId): string => artUrl(`bld-${id}`);
