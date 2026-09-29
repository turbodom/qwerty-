import { readFile, rename, writeFile } from "node:fs/promises";
import { applyWorldAction, createWorld, worldView } from "@korony/shared";
import type { WorldAction, WorldResult, WorldState, WorldView } from "@korony/shared";
import type { Session } from "./auth";

/**
 * The Seasonal Wasteland world: one shared WorldState per server, kept in memory and saved as a JSON
 * snapshot (a file or an Upstash Redis key) a moment after every change, so a restart picks it up again.
 */

export interface WorldSnapshots {
  readonly kind: string;
  load(): Promise<WorldState | null>;
  save(state: WorldState): Promise<void>;
}

/** No persistence: the world lives only as long as the process. */
export class NoSnapshots implements WorldSnapshots {
  readonly kind = "memory";
  async load(): Promise<WorldState | null> {
    return null;
  }
  async save(): Promise<void> {}
}

function isWorld(x: unknown): x is WorldState {
  return !!x && typeof x === "object" && (x as { version?: unknown }).version === 1 && Array.isArray((x as { sectors?: unknown }).sectors);
}

/** JSON file on disk, written through a temporary file so a crash never leaves half a snapshot. */
export class FileSnapshots implements WorldSnapshots {
  readonly kind = "file";
  constructor(private readonly path: string) {}

  async load(): Promise<WorldState | null> {
    try {
      const data: unknown = JSON.parse(await readFile(this.path, "utf8"));
      return isWorld(data) ? data : null;
    } catch {
      return null;
    }
  }

  async save(state: WorldState): Promise<void> {
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(state));
    await rename(tmp, this.path);
  }
}

/** Upstash Redis over its REST API (free tier, no extra dependency): one key holds the whole world. */
export class UpstashSnapshots implements WorldSnapshots {
  readonly kind = "upstash";
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly key = "korony:world",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(path: string, body?: string): Promise<unknown> {
    const init: RequestInit = { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${this.token}` } };
    if (body !== undefined) init.body = body;
    const res = await this.fetchImpl(`${this.url.replace(/\/+$/, "")}${path}`, init);
    if (!res.ok) throw new Error(`upstash ${path.split("/")[1] ?? ""} failed: ${res.status}`);
    return ((await res.json()) as { result?: unknown }).result;
  }

  async load(): Promise<WorldState | null> {
    const raw = await this.call(`/get/${encodeURIComponent(this.key)}`);
    if (typeof raw !== "string") return null;
    try {
      const data: unknown = JSON.parse(raw);
      return isWorld(data) ? data : null;
    } catch {
      return null;
    }
  }

  async save(state: WorldState): Promise<void> {
    await this.call(`/set/${encodeURIComponent(this.key)}`, JSON.stringify(state));
  }
}

export interface WorldServiceOptions {
  now?: () => number;
  dayMs: number;
  seasonDays: number;
  seed?: number;
  snapshots?: WorldSnapshots;
  /** Delay before a change is saved (changes in between are saved together). */
  saveDelayMs?: number;
  log?: (msg: string) => void;
}

export interface WorldActionResponse {
  result: WorldResult;
  view: WorldView;
}

export class WorldService {
  private state: WorldState | null = null;
  private readonly ready: Promise<void>;
  private readonly now: () => number;
  private readonly snapshots: WorldSnapshots;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(private readonly opts: WorldServiceOptions) {
    this.now = opts.now ?? Date.now;
    this.snapshots = opts.snapshots ?? new NoSnapshots();
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    let loaded: WorldState | null = null;
    try {
      loaded = await this.snapshots.load();
    } catch (err) {
      this.opts.log?.(`[world] could not load the ${this.snapshots.kind} snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (loaded) {
      // day length and season length follow the current configuration
      loaded.dayMs = this.opts.dayMs;
      loaded.seasonDays = this.opts.seasonDays;
      this.state = loaded;
      this.opts.log?.(`[world] season ${loaded.season}, day ${loaded.day} loaded from ${this.snapshots.kind}`);
    } else {
      this.state = createWorld({
        seed: this.opts.seed ?? (this.now() % 0x7fffffff), now: this.now(), dayMs: this.opts.dayMs, seasonDays: this.opts.seasonDays,
      });
    }
  }

  private async world(): Promise<WorldState> {
    await this.ready;
    if (!this.state) throw new Error("world not initialised");
    return this.state;
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, this.opts.saveDelayMs ?? 2000);
    this.saveTimer.unref?.();
  }

  /** Saves pending changes now (also called on shutdown). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saving;
    if (!this.dirty || !this.state) return;
    this.dirty = false;
    const snapshot = structuredClone(this.state);
    this.saving = this.snapshots.save(snapshot).catch((err: unknown) => {
      this.dirty = true;
      this.opts.log?.(`[world] could not save the ${this.snapshots.kind} snapshot: ${err instanceof Error ? err.message : String(err)}`);
    });
    await this.saving;
  }

  async view(session: Session | null): Promise<WorldView> {
    const w = await this.world();
    const day = w.day;
    const season = w.season;
    const v = worldView(w, session?.uid ?? null, this.now());
    if (w.day !== day || w.season !== season) this.scheduleSave();
    return v;
  }

  async act(session: Session, action: WorldAction): Promise<WorldActionResponse> {
    const w = await this.world();
    const result = applyWorldAction(w, { id: session.uid, name: session.username }, action, this.now());
    this.scheduleSave();
    return { result, view: worldView(w, session.uid, this.now()) };
  }

  /** The raw state (tests and admin tooling). */
  async snapshot(): Promise<WorldState> {
    return structuredClone(await this.world());
  }
}
