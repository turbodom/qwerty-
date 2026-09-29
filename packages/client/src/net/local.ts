import { applyAction, createGame, eventsForPlayer, playerView } from "@korony/shared";
import type { GameAction, GameState, PlayerLoadout, PlayerView } from "@korony/shared";
import { DEFAULT_MAP_ID } from "../config";
import { STORAGE_KEYS, defaultStorage, readJson, removeItem, writeJson } from "../storage";
import type { KeyValueStorage } from "../storage";
import type { ActionResultLike, GameConnection, ViewListener } from "./connection";

/** Player ids of the offline game: the human sits at seat 0 (castle), the AI at seat 1 (necropolis). */
export const LOCAL_HUMAN_ID = "you";
export const LOCAL_AI_ID = "ai";

interface LocalSave {
  v: 1;
  savedAt: number;
  state: GameState;
}

export interface LocalGameOptions {
  name?: string;
  loadout?: PlayerLoadout;
  seed?: number;
  mapId?: string;
  store?: KeyValueStorage;
}

/** Uniform uint32 seed from the platform CSPRNG (falls back to time only if crypto is missing). */
export function randomSeed(): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === "function") {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return (a[0] ?? 0) >>> 0;
  }
  return (Date.now() ^ 0x9e3779b9) >>> 0;
}

function looksLikeState(x: unknown): x is GameState {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Partial<GameState>;
  return (
    s.version === 1 &&
    typeof s.day === "number" &&
    Array.isArray(s.players) &&
    s.players.some((p) => p.id === LOCAL_HUMAN_ID) &&
    typeof s.heroes === "object" &&
    Array.isArray(s.objects) &&
    Array.isArray(s.terrain) &&
    Array.isArray(s.battles)
  );
}

/**
 * Game against the AI running entirely in the browser on @korony/shared: the same applyAction,
 * playerView and eventsForPlayer the server uses. Saved to storage after every successful action.
 */
export class LocalGame implements GameConnection {
  readonly kind = "local" as const;
  view: PlayerView | null;
  private readonly listeners = new Set<ViewListener>();
  private closed = false;

  private constructor(
    private readonly state: GameState,
    private readonly store: KeyValueStorage,
  ) {
    this.view = playerView(state, LOCAL_HUMAN_ID);
  }

  /** New game with a fresh random seed (or the given one); saved immediately. */
  static create(opts: LocalGameOptions = {}): LocalGame {
    const store = opts.store ?? defaultStorage();
    const seed = opts.seed ?? randomSeed();
    const human = { id: LOCAL_HUMAN_ID, name: opts.name?.trim() || "Игрок", isAI: false } as const;
    const state = createGame({
      id: `local-${seed.toString(36)}`,
      mapId: opts.mapId ?? DEFAULT_MAP_ID,
      seed,
      players: [opts.loadout ? { ...human, loadout: opts.loadout } : human, { id: LOCAL_AI_ID, name: "ИИ", isAI: true }],
    });
    const game = new LocalGame(state, store);
    game.persist();
    return game;
  }

  /** The saved game, or null when there is none (or it is unreadable / finished). */
  static load(store: KeyValueStorage = defaultStorage()): LocalGame | null {
    const save = readJson<LocalSave>(STORAGE_KEYS.localSave, store);
    if (!save || save.v !== 1 || !looksLikeState(save.state)) return null;
    if (save.state.winner !== null) return null;
    try {
      return new LocalGame(save.state, store);
    } catch {
      return null;
    }
  }

  /** Day of the saved game (for the lobby's "Continue" button), or null. */
  static savedDay(store: KeyValueStorage = defaultStorage()): number | null {
    const save = readJson<LocalSave>(STORAGE_KEYS.localSave, store);
    if (!save || save.v !== 1 || !looksLikeState(save.state) || save.state.winner !== null) return null;
    return save.state.day;
  }

  static clearSave(store: KeyValueStorage = defaultStorage()): void {
    removeItem(STORAGE_KEYS.localSave, store);
  }

  /** Deep copy of the full (unfogged) state, for tests and debugging. */
  snapshot(): GameState {
    return JSON.parse(JSON.stringify(this.state)) as GameState;
  }

  subscribe(cb: ViewListener): () => void {
    this.listeners.add(cb);
    if (this.view) cb(this.view, []);
    return () => {
      this.listeners.delete(cb);
    };
  }

  send(action: GameAction): Promise<ActionResultLike> {
    if (this.closed) return Promise.resolve({ ok: false, error: "Партия закрыта", events: [] });
    const res = applyAction(this.state, LOCAL_HUMAN_ID, action);
    if (!res.ok) return Promise.resolve({ ok: false, error: res.error ?? "Так нельзя", events: [] });
    this.persist();
    const events = eventsForPlayer(this.state, LOCAL_HUMAN_ID, res.events);
    const view = playerView(this.state, LOCAL_HUMAN_ID);
    this.view = view;
    for (const cb of [...this.listeners]) cb(view, events);
    return Promise.resolve({ ok: true, events });
  }

  leave(): void {
    this.persist();
    this.closed = true;
    this.listeners.clear();
  }

  /** Writes the save; a finished game removes it instead. */
  private persist(): void {
    if (this.state.winner !== null) {
      LocalGame.clearSave(this.store);
      return;
    }
    const save: LocalSave = { v: 1, savedAt: Date.now(), state: this.state };
    writeJson(STORAGE_KEYS.localSave, save, this.store);
  }
}
