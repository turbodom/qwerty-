/**
 * Safe key/value storage over `localStorage`. Every access is wrapped: private mode, blocked storage
 * or a missing `localStorage` (tests, workers) never throw into game code.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Storage keys used by the client (one place, so they never collide). */
export const STORAGE_KEYS = {
  session: "korony-session",
  lang: "korony-lang",
  audio: "korony-audio",
  localSave: "korony-local-save-v1",
  reconnect: "korony-reconnect",
  /** Last name used for the guest login (prefills the field). */
  guestName: "korony-guest-name",
} as const;

/** In-memory storage (used as a fallback and in tests). */
export function memoryStorage(): KeyValueStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => {
      data.set(k, String(v));
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

const fallback = memoryStorage();

/** The browser's localStorage when usable, else an in-memory fallback. Looked up on every call. */
export function defaultStorage(): KeyValueStorage {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    if (ls && typeof ls.getItem === "function") return ls;
  } catch {
    // access to localStorage can throw (blocked cookies)
  }
  return fallback;
}

export function readItem(key: string, store: KeyValueStorage = defaultStorage()): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string, store: KeyValueStorage = defaultStorage()): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(key: string, store: KeyValueStorage = defaultStorage()): void {
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}

export function readJson<T>(key: string, store: KeyValueStorage = defaultStorage()): T | null {
  const raw = readItem(key, store);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown, store: KeyValueStorage = defaultStorage()): boolean {
  try {
    return writeItem(key, JSON.stringify(value), store);
  } catch {
    return false;
  }
}
