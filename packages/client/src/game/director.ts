import type Phaser from "phaser";
import type { GameEvent, PlayerView } from "@korony/shared";
import type { BattleScene, BattleSceneData } from "../scenes/BattleScene";
import type { MapScene } from "../scenes/MapScene";
import { bridge } from "./bridge";
import { myBattle } from "./helpers";

interface Update {
  view: PlayerView;
  events: GameEvent[];
}

/**
 * Feeds views to the scenes one update at a time: the map animates hero moves, then the battle scene
 * takes over while the viewer fights (battles in view.state.battles that include them), and the map
 * comes back when the battle is over. `onProcessed` runs after each update has been shown.
 */
export class Director {
  private readonly queue: Update[] = [];
  private running = false;
  private battle: BattleScene | null = null;
  private starting = false;
  private generation = 0;

  constructor(
    private readonly game: Phaser.Game,
    private readonly onProcessed: (view: PlayerView, events: GameEvent[]) => void,
  ) {}

  push(view: PlayerView, events: GameEvent[]): void {
    this.queue.push({ view, events });
    if (!this.running) void this.run();
  }

  /** Drops everything (leaving a game). */
  reset(): void {
    this.generation++;
    this.queue.length = 0;
    this.stopBattle();
    const map = this.mapScene();
    map?.clear();
  }

  /** The map scene, for helpers such as tile coordinates in tests. */
  mapScene(): MapScene | null {
    try {
      return this.game.scene.getScene("MapScene") as MapScene;
    } catch {
      return null;
    }
  }

  get inBattle(): boolean {
    return this.battle !== null;
  }

  get battleScene(): BattleScene | null {
    return this.battle;
  }

  /** A battle scene is being created (it may already show its bar). */
  get startingBattle(): boolean {
    return this.starting;
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const u = this.queue.shift();
        if (!u) break;
        const gen = this.generation;
        try {
          await this.process(u, gen);
        } catch (e) {
          console.warn("scene update failed", e);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async process(u: Update, gen: number): Promise<void> {
    await bridge.booted;
    const map = this.mapScene();
    if (!map) return;
    await map.ready;
    if (gen !== this.generation) return;

    if (this.battle) {
      const b = this.battle;
      await b.play(u.view, u.events);
      if (gen !== this.generation) return;
      if (b.isOver(u.view)) {
        await b.showResult(b.won(u.view));
        if (gen !== this.generation) return;
        this.stopBattle();
        await map.showView(u.view, []);
      }
    } else {
      await map.showView(u.view, u.events);
    }
    if (gen !== this.generation) return;

    if (!this.battle) {
      const ab = myBattle(u.view);
      if (ab) {
        const scene = await this.startBattle(u.view, ab.battle.id, u.events);
        if (gen !== this.generation) return;
        this.battle = scene;
        await scene.play(u.view, u.events);
      }
    }
    if (gen !== this.generation) return;
    this.onProcessed(u.view, u.events);
  }

  private startBattle(view: PlayerView, battleId: string, events: GameEvent[]): Promise<BattleScene> {
    this.starting = true;
    return new Promise<BattleScene>((resolve) => {
      const onReady = (scene: BattleScene): void => {
        this.starting = false;
        resolve(scene);
      };
      const data: BattleSceneData = { view, battleId, events, onReady };
      this.game.scene.sleep("MapScene");
      this.game.scene.run("BattleScene", data);
    });
  }

  private stopBattle(): void {
    if (this.battle) {
      this.battle = null;
      this.game.scene.stop("BattleScene");
    }
    if (this.game.scene.isSleeping("MapScene")) this.game.scene.wake("MapScene");
    bridge.ui?.setBattleBar(null);
  }
}
