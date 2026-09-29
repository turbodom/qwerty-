import type { IncomingMessage, ServerResponse } from "node:http";
import express from "express";
import type { Request, RequestHandler, Response } from "express";
import type { Server as ColyseusServer } from "colyseus";
import { matchMaker } from "colyseus";
import type { ErrorBody } from "./errors";
import { rateLimit } from "./http";
import type { RateLimitOptions } from "./http";

/** Largest matchmaking request body (join options are a few short strings). */
export const MATCHMAKE_BODY_LIMIT = 8 * 1024;

export const DEFAULT_MATCHMAKE_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 60 };

export type RawHandler = (req: IncomingMessage, res: ServerResponse) => unknown;

export interface MatchmakeGuardOptions {
  trustProxy: boolean | number | string;
  rateLimit?: RateLimitOptions;
  maxBodyBytes?: number;
  now?: () => number;
  /** Extra headers for guard responses (the matchmaker CORS headers), so browsers can read 413/429. */
  headers?: (req: IncomingMessage) => Record<string, string>;
}

/**
 * Wraps a raw matchmaking handler with a per-IP rate limit and a body size cap. Colyseus buffers the whole
 * body with no limit before it even looks at the session, so oversized requests must be cut off here:
 * a declared Content-Length over the cap is refused without reading, and a streamed body is counted and
 * the connection dropped as soon as it passes the cap (the inner handler never sees its `end`).
 */
export function createMatchmakeGuard(inner: RawHandler, opts: MatchmakeGuardOptions): RawHandler {
  const max = opts.maxBodyBytes ?? MATCHMAKE_BODY_LIMIT;
  const guard = express();
  guard.disable("x-powered-by");
  guard.set("trust proxy", opts.trustProxy);
  const extraHeaders: RequestHandler = (req, res, next) => {
    if (opts.headers) for (const [k, v] of Object.entries(opts.headers(req))) res.setHeader(k, v);
    next();
  };
  guard.use(extraHeaders);
  guard.use(rateLimit(opts.rateLimit ?? DEFAULT_MATCHMAKE_RATE_LIMIT, opts.now));
  guard.use((req: Request, res: Response) => {
    const declared = req.headers["content-length"];
    if (declared !== undefined && !(Number(declared) <= max)) {
      tooLarge(req, res);
      return;
    }
    let received = 0;
    const count = (chunk: Buffer): void => {
      received += chunk.length;
      if (received > max) {
        req.off("data", count);
        tooLarge(req, res);
      }
    };
    // Registered before the inner handler's listener, so the overflowing chunk is the last one it buffers.
    req.on("data", count);
    void inner(req, res);
  });
  return (req, res) => {
    guard(req as Request, res as Response);
  };
}

function tooLarge(req: IncomingMessage, res: ServerResponse): void {
  // Stop buffering and reading: drop every body listener (the inner handler's too) and pause the stream.
  req.removeAllListeners("data");
  req.removeAllListeners("end");
  req.pause();
  if (!res.headersSent) {
    const body: ErrorBody = { error: "Слишком большой запрос", code: "too_large" };
    res.writeHead(413, { "Content-Type": "application/json", Connection: "close" });
    res.end(JSON.stringify(body), () => req.socket.destroy());
  } else {
    req.socket.destroy();
  }
}

/**
 * Routes Colyseus matchmaking (every URL containing `/matchmake`, which Colyseus serves before Express sees it)
 * through createMatchmakeGuard.
 */
export function guardMatchmaking(gameServer: ColyseusServer, opts: MatchmakeGuardOptions): void {
  // handleMatchMakeRequest is protected in the typings; attachMatchMakingRoutes calls it through `this`.
  const target = gameServer as unknown as { handleMatchMakeRequest: RawHandler };
  const inner = target.handleMatchMakeRequest.bind(gameServer);
  const headers = opts.headers ?? ((req: IncomingMessage) => matchMaker.controller.getCorsHeaders(req) as Record<string, string>);
  target.handleMatchMakeRequest = createMatchmakeGuard(inner, { ...opts, headers });
}
