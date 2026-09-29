import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { ErrorRequestHandler, Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { SHOP_ITEMS } from "@korony/shared";
import type { AuthResponse } from "@korony/shared";
import { GUEST_UID_PREFIX, createSessionAuth, isGuestSession, requireSession, sessionOf } from "./auth";
import type { Session, SessionAuth } from "./auth";
import type { Config } from "./config";
import { HttpError } from "./errors";
import type { ErrorBody } from "./errors";
import { PaymentService } from "./payments";
import { PiApiError } from "./pi";
import type { PiApi } from "./pi";
import { loadoutFor, publicUser } from "./shop";
import type { Store, UserRecord } from "./store";

export const BODY_LIMIT = "16kb";

/** Built client (Vite `dist`), served by the same process when present. */
export const DEFAULT_CLIENT_DIST = fileURLToPath(new URL("../../client/dist", import.meta.url));

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface AppDeps {
  config: Config;
  store: Store;
  pi: PiApi;
  /** Defaults to createSessionAuth(config.sessionSecret). */
  auth?: SessionAuth;
  now?: () => number;
  /** Directory of the built client; `null` disables static serving. Defaults to DEFAULT_CLIENT_DIST. */
  clientDist?: string | null;
  rateLimits?: { auth?: RateLimitOptions; payments?: RateLimitOptions };
}

// ================= request validation =================

const paymentId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const txid = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);

export const schemas = {
  authPi: z.object({ accessToken: z.string().min(1).max(4096) }),
  authGuest: z.object({
    username: z
      .string()
      .trim()
      .min(2)
      .max(24)
      .regex(/^[\p{L}\p{N}_\-. ]+$/u),
  }),
  approve: z.object({ paymentId }),
  complete: z.object({ paymentId, txid }),
  /** The PaymentDTO from Pi.authenticate's onIncompletePaymentFound; only its identifier is used. */
  incomplete: z.object({ payment: z.looseObject({ identifier: paymentId }) }),
};

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, "bad_request", "Неверный запрос");
  return r.data;
}

// ================= middleware =================

/** Fixed-window request counter per client IP. */
export function rateLimit(opts: RateLimitOptions, now: () => number = Date.now): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const t = now();
    if (hits.size > 10_000) {
      for (const [k, h] of hits) if (h.resetAt <= t) hits.delete(k);
    }
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    let h = hits.get(key);
    if (!h || h.resetAt <= t) {
      h = { count: 0, resetAt: t + opts.windowMs };
      hits.set(key, h);
    }
    h.count++;
    res.setHeader("RateLimit-Limit", String(opts.max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, opts.max - h.count)));
    if (h.count > opts.max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((h.resetAt - t) / 1000))));
      const body: ErrorBody = { error: "Слишком много запросов, подождите немного", code: "rate_limited" };
      res.status(429).json(body);
      return;
    }
    next();
  };
}

/**
 * CORS for the configured client origins only. Sessions travel in the Authorization header, never in cookies;
 * Allow-Credentials is still sent to allowed origins so a client using `credentials: "include"` keeps working.
 */
export function cors(origins: readonly string[]): RequestHandler {
  const allowed = new Set(origins);
  return (req, res, next) => {
    res.vary("Origin");
    const origin = req.get("origin");
    const ok = origin !== undefined && allowed.has(origin);
    if (ok) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      if (ok) {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Max-Age", "600");
      }
      res.status(204).end();
      return;
    }
    next();
  };
}

function securityHeaders(production: boolean): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    // The Pi sandbox shows the app inside an iframe, so the client pages must stay frameable.
    if (production) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    next();
  };
}

const apiHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("X-Frame-Options", "DENY");
  next();
};

// ================= app =================

/** Express app with the REST API (and the built client when it exists). Colyseus attaches to the same http server. */
export function createApp(deps: AppDeps): Express {
  const { config, store, pi } = deps;
  const now = deps.now ?? Date.now;
  const auth = deps.auth ?? createSessionAuth(config.sessionSecret);
  const payments = new PaymentService({ store, pi, now });
  const startedAt = now();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(securityHeaders(config.env === "production"));

  const api = express.Router();
  api.use(apiHeaders);
  api.use(cors(config.clientOrigins));
  // Rate limits run before body parsing so floods cost as little as possible.
  api.use("/auth", rateLimit(deps.rateLimits?.auth ?? { windowMs: 60_000, max: 30 }, now));
  api.use("/payments", rateLimit(deps.rateLimits?.payments ?? { windowMs: 60_000, max: 60 }, now));
  api.use(express.json({ limit: BODY_LIMIT }));
  const signedIn = requireSession(auth);
  /** Pi payments need a Pi account: guests are turned away before anything reaches the Pi API. */
  const piAccount: RequestHandler = (_req, res, next) => {
    if (isGuestSession(sessionOf(res))) throw new HttpError(403, "pi_login_required", "Покупки доступны только после входа через Pi");
    next();
  };

  const issue = async (user: UserRecord): Promise<AuthResponse> => ({
    token: await auth.sign({ uid: user.uid, username: user.username }),
    user: publicUser(user),
  });
  const currentUser = async (s: Session): Promise<UserRecord> =>
    (await store.getUser(s.uid)) ?? (await store.upsertUser(s.uid, s.username));

  api.get("/health", (_req, res) => {
    res.json({ ok: true, time: now(), uptimeSeconds: Math.round((now() - startedAt) / 1000) });
  });

  api.post("/auth/pi", async (req, res) => {
    const { accessToken } = parseBody(schemas.authPi, req.body);
    let piUser;
    try {
      piUser = await pi.me(accessToken);
    } catch (err) {
      if (err instanceof PiApiError && (err.kind === "unauthorized" || err.status === 400 || err.status === 403)) {
        throw new HttpError(401, "invalid_pi_token", "Pi не подтвердил вход, попробуйте ещё раз");
      }
      throw new HttpError(502, "pi_unavailable", "Сервер Pi не ответил, попробуйте позже");
    }
    const user = await store.upsertUser(piUser.uid, piUser.username);
    res.json(await issue(user));
  });

  api.post("/auth/guest", async (req, res) => {
    if (!config.allowGuestLogin) throw new HttpError(404, "guest_login_disabled", "Гостевой вход выключен, войдите через Pi");
    const { username } = parseBody(schemas.authGuest, req.body);
    // a fresh account per login: the name is only a display name, so nobody can take over another guest by typing it
    const user = await store.upsertUser(`${GUEST_UID_PREFIX}${randomBytes(12).toString("base64url")}`, username);
    res.json(await issue(user));
  });

  api.get("/me", signedIn, async (_req, res) => {
    res.json(publicUser(await currentUser(sessionOf(res))));
  });

  api.get("/shop", (_req, res) => {
    res.json(SHOP_ITEMS);
  });

  api.get("/loadout", signedIn, async (_req, res) => {
    res.json(loadoutFor(await currentUser(sessionOf(res))));
  });

  api.post("/payments/approve", signedIn, piAccount, async (req, res) => {
    const body = parseBody(schemas.approve, req.body);
    res.json(await payments.approve(sessionOf(res), body.paymentId));
  });

  api.post("/payments/complete", signedIn, piAccount, async (req, res) => {
    const body = parseBody(schemas.complete, req.body);
    res.json(await payments.complete(sessionOf(res), body.paymentId, body.txid));
  });

  api.post("/payments/incomplete", signedIn, piAccount, async (req, res) => {
    const body = parseBody(schemas.incomplete, req.body);
    res.json(await payments.incomplete(sessionOf(res), body.payment.identifier));
  });

  api.use((_req, res) => {
    const body: ErrorBody = { error: "Не найдено", code: "not_found" };
    res.status(404).json(body);
  });

  app.use("/api", api);

  const dist = deps.clientDist === undefined ? DEFAULT_CLIENT_DIST : deps.clientDist;
  if (dist !== null && existsSync(join(dist, "index.html"))) serveClient(app, dist);

  app.use(errorHandler);
  return app;
}

/** Static client with SPA fallback: unknown GET paths that accept HTML get index.html. */
function serveClient(app: Express, dist: string): void {
  const index = join(dist, "index.html");
  app.use(
    express.static(dist, {
      index: "index.html",
      setHeaders(res, path) {
        if (/[\\/]assets[\\/]/.test(path)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        else res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get("/{*splat}", (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/api" || req.path.startsWith("/api/") || !req.accepts("html")) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(index);
  });
}

const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  let status = 500;
  let body: ErrorBody = { error: "Ошибка сервера", code: "internal" };
  if (err instanceof HttpError) {
    status = err.status;
    body = { error: err.message, code: err.code };
  } else if (typeof err === "object" && err !== null && "type" in err) {
    // body-parser errors
    const type = (err as { type?: unknown }).type;
    if (type === "entity.too.large") {
      status = 413;
      body = { error: "Слишком большой запрос", code: "too_large" };
    } else if (type === "entity.parse.failed" || type === "encoding.unsupported" || type === "charset.unsupported") {
      status = 400;
      body = { error: "Неверный запрос", code: "bad_request" };
    }
  }
  if (status === 500) console.error("[http] unhandled error:", err);
  res.status(status).json(body);
};
