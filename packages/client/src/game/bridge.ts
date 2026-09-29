/**
 * Glue between the Phaser scenes and the DOM UI: the current game session and the UI callbacks the
 * scenes may use (hint line, toasts, panels, battle action bar). Set by the App at startup.
 */
import type { ActiveBattle, GameAction, Seat, SpellId } from "@korony/shared";
import type { ActionResultLike, GameConnection } from "../net/connection";

export interface BattleBarState {
  round: number;
  /** A stack of the viewer is active and the viewer plays it (not automatic). */
  myTurn: boolean;
  /** The viewer's hero can still cast this round. */
  canCast: boolean;
  /** Spell targeting is active. */
  spellMode: boolean;
}

export interface UiHooks {
  hint(text: string): void;
  toast(text: string, kind?: "info" | "error"): void;
  openHero(): void;
  openCastle(): void;
  openSpellbook(ab: ActiveBattle, side: Seat, onPick: (spell: SpellId) => void): void;
  setBattleBar(state: BattleBarState | null): void;
}

class Bridge {
  conn: GameConnection | null = null;
  ui: UiHooks | null = null;
  /** Device pixel ratio the canvas renders at (game size = CSS size x dpr). */
  dpr = 1;
  /** Actions sent and not answered yet (scenes block input meanwhile). */
  inFlight = 0;
  private resolveBoot: (() => void) | null = null;
  readonly booted: Promise<void>;

  constructor() {
    this.booted = new Promise<void>((resolve) => {
      this.resolveBoot = resolve;
    });
  }

  bootDone(): void {
    this.resolveBoot?.();
  }

  hint(text: string): void {
    this.ui?.hint(text);
  }

  toast(text: string, kind: "info" | "error" = "info"): void {
    this.ui?.toast(text, kind);
  }

  /** Sends an action for the viewer; rejected actions are shown as an error toast. */
  async act(action: GameAction): Promise<ActionResultLike> {
    const conn = this.conn;
    if (!conn) return { ok: false, error: "Нет партии" };
    this.inFlight++;
    try {
      const res = await conn.send(action);
      if (!res.ok && res.error) this.toast(res.error, "error");
      return res;
    } finally {
      this.inFlight--;
    }
  }
}

export const bridge = new Bridge();
