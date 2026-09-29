import Phaser from "phaser";
import { ARTIFACT_IDS, MAPS, UNIT_IDS } from "@korony/shared";
import {
  SCENE_ART, artUrl, mapArtName, paintArtifact, paintBattleBg, paintCastle, paintChest, paintHero, paintMine, paintRock, paintUnit,
  unitArtName,
} from "../gfx/art";
import type { Pic } from "../gfx/art";
import {
  bakeArt, bakeBattleBg, bakeCastle, bakeChest, bakeDot, bakeHero, bakeHex, bakeMine, bakeRock, bakeTerrain,
  bakeMuzzle, bakeSmoke, bakeTileMark, bakeUnit, colorHex,
} from "../gfx/bake";
import type { Baked } from "../gfx/bake";
import {
  BANNER_KEYS, BATTLE_H, BATTLE_K, BATTLE_W, COLOR_KEYS, HEX_R, MAP_K, ORIGINS, PLAIN_VARIANTS, TEX, TILE, artKey, castleKey, heroKey,
  mapKey, mineKey, terrainKey, unitKey,
} from "../gfx/keys";
import { BANNER_COLORS } from "../gfx/draw";
import type { TerrainChar } from "../gfx/draw";
import { bridge } from "../game/bridge";

const PIC_PREFIX = "pic:";

/**
 * Loads the painted art (public/art) and bakes every texture from it, falling back to the prototype's
 * canvas drawing code for any picture that did not load; then starts the map scene.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  private add1(key: string, baked: Baked): void {
    if (this.textures.exists(key)) this.textures.remove(key);
    this.textures.addCanvas(key, baked.canvas);
    ORIGINS.set(key, baked.origin);
  }

  preload(): void {
    const names = [...SCENE_ART, ...UNIT_IDS.map(unitArtName), ...ARTIFACT_IDS.map((id) => `art-${id}`)];
    for (const n of names) this.load.image(PIC_PREFIX + n, artUrl(n));
    // painted map landscapes go straight to Phaser: MapScene draws them under the objects
    for (const id of Object.keys(MAPS)) this.load.image(mapKey(id), artUrl(mapArtName(id)));
  }

  /** A loaded picture, or null when it failed to load (the drawing is used instead). */
  private pic(name: string): Pic | null {
    const key = PIC_PREFIX + name;
    if (!this.textures.exists(key)) return null;
    const src = this.textures.get(key).getSourceImage();
    return src instanceof HTMLImageElement || src instanceof HTMLCanvasElement ? src : null;
  }

  create(): void {
    // 1x1 white pixel for tinted rectangles / flashes
    const px = document.createElement("canvas");
    px.width = 2;
    px.height = 2;
    const pctx = px.getContext("2d");
    if (pctx) {
      pctx.fillStyle = "#fff";
      pctx.fillRect(0, 0, 2, 2);
    }
    this.add1(TEX.pixel, { canvas: px, origin: { x: 0, y: 0 } });

    // terrain tiles (used when a map has no painted landscape): checker shade x decoration variant
    const terrains: TerrainChar[] = [".", "F", "M", "W"];
    for (const t of terrains) {
      const variants = t === "." ? PLAIN_VARIANTS : t === "W" ? 2 : 1;
      for (const checker of [0, 1] as const) {
        for (let v = 0; v < variants; v++) this.add1(terrainKey(t, checker, v), bakeTerrain(t, checker, v, MAP_K));
      }
    }

    // castles and heroes per owner colour and banner, mines per owner, chest, artifacts
    // red is seat 1, the enemy side
    const mine = this.pic("mine");
    const chest = this.pic("chest");
    for (const c of COLOR_KEYS) {
      const castle = this.pic(c === "red" ? "base-enemy" : "base-player");
      const hero = this.pic(c === "red" ? "hero-enemy" : "hero-player");
      for (const b of BANNER_KEYS) {
        const flag = BANNER_COLORS[b] ?? colorHex(c);
        this.add1(castleKey(c, b), castle ? paintCastle(castle, colorHex(c), flag, MAP_K) : bakeCastle(c, b, MAP_K));
        this.add1(heroKey(c, b), hero ? paintHero(hero, colorHex(c), flag, MAP_K) : bakeHero(c, b, MAP_K));
      }
      this.add1(mineKey(c), mine ? paintMine(mine, colorHex(c), MAP_K) : bakeMine(c, MAP_K));
    }
    this.add1(mineKey(null), mine ? paintMine(mine, null, MAP_K) : bakeMine(null, MAP_K));
    this.add1(TEX.chest, chest ? paintChest(chest, MAP_K) : bakeChest(MAP_K));
    for (const id of ARTIFACT_IDS) {
      const art = this.pic(`art-${id}`);
      this.add1(artKey(id), art ? paintArtifact(art, MAP_K) : bakeArt(id, MAP_K));
    }

    // unit sprites (battle scale; the map uses them scaled down) per side colour, upgraded marker baked in.
    // The pictures face right; red ones are mirrored so the two armies read apart at a glance.
    for (const u of UNIT_IDS) {
      const pic = this.pic(unitArtName(u));
      for (const c of COLOR_KEYS) {
        this.add1(unitKey(u, c), pic ? paintUnit(pic, u, colorHex(c), BATTLE_K, c === "red") : bakeUnit(u, c, BATTLE_K));
      }
    }

    // map path markers
    this.add1(TEX.dotGreen, bakeDot("#7ee06b", false, MAP_K));
    this.add1(TEX.dotRed, bakeDot("#e0625a", false, MAP_K));
    this.add1(TEX.crossGreen, bakeDot("#7ee06b", true, MAP_K));
    this.add1(TEX.crossRed, bakeDot("#e0625a", true, MAP_K));
    this.add1(TEX.tileMark, bakeTileMark(TILE));

    // battle
    this.add1(TEX.hex, bakeHex("base", HEX_R));
    this.add1(TEX.hexReach, bakeHex("reach", HEX_R));
    this.add1(TEX.hexAttack, bakeHex("attack", HEX_R));
    this.add1(TEX.hexActive, bakeHex("active", HEX_R));
    this.add1(TEX.hexSelect, bakeHex("select", HEX_R));
    const rock = this.pic("rock1");
    const rock2 = this.pic("rock2");
    this.add1(TEX.rock, rock ? paintRock(rock, BATTLE_K) : bakeRock(BATTLE_K));
    this.add1(TEX.rock2, rock2 ? paintRock(rock2, BATTLE_K) : bakeRock(BATTLE_K));
    // battle effects: smoke/dust puffs (tinted), muzzle flash, impact spark
    this.add1(TEX.smoke, bakeSmoke(32));
    this.add1(TEX.muzzle, bakeMuzzle(24));
    this.add1(TEX.spark, bakeSmoke(6));
    const field = this.pic("battle-bg");
    this.add1(TEX.battleBg, field ? paintBattleBg(field, BATTLE_W, BATTLE_H) : bakeBattleBg(BATTLE_W, BATTLE_H));

    this.scene.start("MapScene");
    bridge.bootDone();
  }
}
