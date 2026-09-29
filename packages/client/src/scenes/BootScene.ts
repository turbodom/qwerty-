import Phaser from "phaser";
import { ARTIFACT_IDS, UNIT_IDS } from "@korony/shared";
import {
  bakeArrow, bakeArt, bakeBattleBg, bakeCastle, bakeChest, bakeDot, bakeHero, bakeHex, bakeMine, bakeRock, bakeTerrain,
  bakeTileMark, bakeUnit,
} from "../gfx/bake";
import type { Baked } from "../gfx/bake";
import {
  BANNER_KEYS, BATTLE_H, BATTLE_K, BATTLE_W, COLOR_KEYS, HEX_R, MAP_K, ORIGINS, PLAIN_VARIANTS, TEX, TILE, artKey, castleKey, heroKey,
  mineKey, terrainKey, unitKey,
} from "../gfx/keys";
import type { TerrainChar } from "../gfx/draw";
import { bridge } from "../game/bridge";

/**
 * Generates every texture procedurally from the prototype's canvas drawing code, then starts the map
 * scene. Nothing is downloaded.
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

    // terrain tiles: checker shade x decoration variant
    const terrains: TerrainChar[] = [".", "F", "M", "W"];
    for (const t of terrains) {
      const variants = t === "." ? PLAIN_VARIANTS : t === "W" ? 2 : 1;
      for (const checker of [0, 1] as const) {
        for (let v = 0; v < variants; v++) this.add1(terrainKey(t, checker, v), bakeTerrain(t, checker, v, MAP_K));
      }
    }

    // castles and heroes per owner colour and banner, mines per owner, chest, artifacts
    for (const c of COLOR_KEYS) {
      for (const b of BANNER_KEYS) {
        this.add1(castleKey(c, b), bakeCastle(c, b, MAP_K));
        this.add1(heroKey(c, b), bakeHero(c, b, MAP_K));
      }
      this.add1(mineKey(c), bakeMine(c, MAP_K));
    }
    this.add1(mineKey(null), bakeMine(null, MAP_K));
    this.add1(TEX.chest, bakeChest(MAP_K));
    for (const id of ARTIFACT_IDS) this.add1(artKey(id), bakeArt(id, MAP_K));

    // unit icons (battle scale; the map uses them scaled down) per side colour, upgraded marker baked in
    for (const u of UNIT_IDS) for (const c of COLOR_KEYS) this.add1(unitKey(u, c), bakeUnit(u, c, BATTLE_K));

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
    this.add1(TEX.rock, bakeRock(BATTLE_K));
    this.add1(TEX.battleBg, bakeBattleBg(BATTLE_W, BATTLE_H));
    this.add1(TEX.arrow, bakeArrow(BATTLE_K));

    this.scene.start("MapScene");
    bridge.bootDone();
  }
}
