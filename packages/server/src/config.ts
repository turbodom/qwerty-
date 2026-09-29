import { z } from "zod";

/** Runtime configuration, read once from the environment (see `.env.example`). */
export interface Config {
  env: "development" | "production" | "test";
  port: number;
  /** HS256 key for session tokens. */
  sessionSecret: string;
  /** Pi Server API key; null disables payments (503). */
  piApiKey: string | null;
  piApiBase: string;
  /**
   * Guest login by name (`POST /api/auth/guest`), so the game can be tried in a normal browser.
   * On by default; must be switched off (ALLOW_GUEST_LOGIN=false) before the Pi Mainnet listing, which allows Pi login only.
   */
  allowGuestLogin: boolean;
  /** Origins allowed by CORS (empty: same origin only). */
  clientOrigins: string[];
  daySeconds: number;
  reconnectSeconds: number;
  /** Express "trust proxy" setting (false: use the socket address as the client IP). */
  trustProxy: boolean | number | string;
}

export const DEV_SESSION_SECRET = "dev-only-session-secret-do-not-use-in-production";
const PLACEHOLDER_SECRET = "change-me-to-a-long-random-string";
const MIN_SECRET_LENGTH = 32;

const emptyToUndefined = (v: unknown): unknown => (typeof v === "string" && v.trim() === "" ? undefined : v);

const boolFromEnv = z.preprocess((v) => {
  const s = emptyToUndefined(v);
  if (typeof s !== "string") return s;
  const t = s.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(t)) return true;
  if (["0", "false", "no", "off"].includes(t)) return false;
  return s;
}, z.boolean().optional());

const intFromEnv = (min: number, max: number) =>
  z.preprocess((v) => {
    const s = emptyToUndefined(v);
    return typeof s === "string" ? Number(s.trim()) : s;
  }, z.number().int().min(min).max(max).optional());

const originSchema = z.string().refine((s) => {
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && u.origin === s;
  } catch {
    return false;
  }
}, "must be an origin like https://example.com (no path, no trailing slash)");

const envSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(["development", "production", "test"]).optional()),
  PORT: intFromEnv(0, 65535),
  SESSION_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  PI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  PI_API_BASE: z.preprocess(emptyToUndefined, z.url({ protocol: /^https?$/ }).optional()),
  ALLOW_GUEST_LOGIN: boolFromEnv,
  CLIENT_ORIGIN: z.preprocess(
    (v) => {
      const s = emptyToUndefined(v);
      return typeof s === "string" ? s.split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean) : s;
    },
    z.array(originSchema).optional(),
  ),
  DAY_SECONDS: intFromEnv(5, 3600),
  RECONNECT_SECONDS: intFromEnv(0, 3600),
  TRUST_PROXY: z.preprocess(emptyToUndefined, z.string().optional()),
});

export class ConfigError extends Error {
  override name = "ConfigError";
}

function parseTrustProxy(v: string | undefined): boolean | number | string {
  if (v === undefined) return false;
  const t = v.trim().toLowerCase();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^\d+$/.test(t)) return Number(t);
  return v.trim();
}

/**
 * Reads and validates the configuration. Throws ConfigError with every problem listed.
 * In production SESSION_SECRET is required (at least 32 characters); elsewhere a dev default is used with a warning.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  warn: (msg: string) => void = (m) => console.warn(`[config] ${m}`),
): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  const e = parsed.data;
  const mode = e.NODE_ENV ?? "development";
  const production = mode === "production";

  let sessionSecret = e.SESSION_SECRET;
  if (production) {
    if (!sessionSecret) throw new ConfigError("SESSION_SECRET is required when NODE_ENV=production");
    if (sessionSecret === PLACEHOLDER_SECRET) throw new ConfigError("SESSION_SECRET still has the placeholder value from .env.example");
    if (sessionSecret.length < MIN_SECRET_LENGTH) {
      throw new ConfigError(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`);
    }
  } else if (!sessionSecret) {
    sessionSecret = DEV_SESSION_SECRET;
    if (mode !== "test") warn("SESSION_SECRET is not set: using an insecure development secret");
  }

  const allowGuestLogin = e.ALLOW_GUEST_LOGIN ?? true;
  if (production && allowGuestLogin) {
    warn("guest login is on: anyone can play without Pi. Set ALLOW_GUEST_LOGIN=false before the Pi Mainnet listing");
  }
  if (production && !e.PI_API_KEY) warn("PI_API_KEY is not set: payments are disabled");

  return {
    env: mode,
    port: e.PORT ?? 2567,
    sessionSecret,
    piApiKey: e.PI_API_KEY ?? null,
    piApiBase: (e.PI_API_BASE ?? "https://api.minepi.com").replace(/\/+$/, ""),
    allowGuestLogin,
    clientOrigins: e.CLIENT_ORIGIN ?? (production ? [] : ["http://localhost:5173", "http://127.0.0.1:5173"]),
    daySeconds: e.DAY_SECONDS ?? 90,
    reconnectSeconds: e.RECONNECT_SECONDS ?? 60,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
  };
}
