/** Client configuration from Vite env (see .env.example at the repo root). */

const env: Record<string, unknown> = (import.meta.env ?? {}) as Record<string, unknown>;

function readString(key: string): string | undefined {
  const v = env[key];
  return typeof v === "string" ? v : undefined;
}

/** Base URL of the game server; empty string means same origin (dev proxy or same host in production). */
export const SERVER_URL: string = (readString("VITE_SERVER_URL") ?? "").trim().replace(/\/+$/, "");

/** Pi SDK sandbox mode (Developer Portal sandbox). */
export const PI_SANDBOX: boolean = readString("VITE_PI_SANDBOX") === "true";

/**
 * Pi login and payments. Off by default so the game is tested with the guest login in Pi Browser and in
 * a normal browser alike; set VITE_PI_LOGIN=true when Pi authentication is switched on.
 */
export const PI_LOGIN: boolean = readString("VITE_PI_LOGIN") === "true";

/** True in the Vite dev server. */
export const IS_DEV: boolean = env["DEV"] === true;

/** Map used for new games. */
export const DEFAULT_MAP_ID = "valley";

/**
 * Colyseus endpoint. With an explicit server URL the client talks to it directly; with same origin
 * the dev server proxies `/colyseus` to the game server (see vite.config.ts).
 */
export function colyseusEndpoint(): string {
  if (SERVER_URL) return SERVER_URL;
  const origin = typeof location !== "undefined" ? location.origin : "http://localhost:2567";
  return IS_DEV ? `${origin}/colyseus` : origin;
}

/** Absolute or same-origin URL of a server API path such as `/api/me`. */
export function apiUrl(path: string): string {
  return `${SERVER_URL}${path}`;
}
