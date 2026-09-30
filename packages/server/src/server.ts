import { createServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server as ColyseusServer, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@korony/shared";
import { createSessionAuth } from "./auth";
import type { Config } from "./config";
import { createApp } from "./http";
import type { AppDeps, RateLimitOptions } from "./http";
import { guardMatchmaking } from "./matchmakeGuard";
import { PiClient } from "./pi";
import type { PiApi } from "./pi";
import { createMatchRoom } from "./rooms/MatchRoom";
import { matchFilter } from "./rooms/matchLogic";
import { MemoryStore } from "./store";
import type { Store } from "./store";
import { FileSnapshots, NoSnapshots, UpstashSnapshots, WorldService } from "./world";
import type { WorldSnapshots } from "./world";

export interface StartOptions {
  config: Config;
  store?: Store;
  pi?: PiApi;
  /** Overrides config.port (0 = any free port). */
  port?: number;
  host?: string;
  clientDist?: AppDeps["clientDist"];
  /** `matchmake` limits Colyseus matchmaking requests (`/matchmake/...`) per client IP. */
  rateLimits?: AppDeps["rateLimits"] & { matchmake?: RateLimitOptions };
  now?: () => number;
  /** Overrides the snapshot store chosen from config (tests). */
  worldSnapshots?: WorldSnapshots;
}

export interface RunningServer {
  port: number;
  httpServer: HttpServer;
  gameServer: ColyseusServer;
  store: Store;
  world: WorldService;
  /** Disconnects rooms, closes sockets and the http server. */
  close(): Promise<void>;
}

/** Limits Colyseus matchmaking CORS to the configured client origins (it reflects any origin by default). */
function restrictMatchmakerCors(origins: readonly string[]): void {
  const allowed = new Set(origins);
  const defaults = matchMaker.controller.DEFAULT_CORS_HEADERS as Record<string, string>;
  delete defaults["Access-Control-Allow-Origin"];
  delete defaults["Access-Control-Allow-Credentials"];
  matchMaker.controller.getCorsHeaders = (req): Record<string, string> => {
    const origin = req.headers["origin"];
    // colyseus.js always sends credentials, so an allowed origin also needs Allow-Credentials.
    return typeof origin === "string" && allowed.has(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" }
      : { Vary: "Origin" };
  };
}

/** HTTP API + Colyseus on one http server. */
export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const { config } = opts;
  const now = opts.now ?? Date.now;
  const store = opts.store ?? new MemoryStore(now);
  const pi = opts.pi ?? new PiClient({ apiBase: config.piApiBase, apiKey: config.piApiKey });
  const auth = createSessionAuth(config.sessionSecret);
  const snapshots: WorldSnapshots = opts.worldSnapshots
    ?? (config.upstashUrl && config.upstashToken
      ? new UpstashSnapshots(config.upstashUrl, config.upstashToken)
      : config.worldFile
        ? new FileSnapshots(config.worldFile)
        : new NoSnapshots());
  const world = new WorldService({
    now, dayMs: config.worldDayMinutes * 60_000, seasonDays: config.worldSeasonDays, snapshots,
    log: (m) => console.log(m),
  });

  const app = createApp({
    config, store, pi, auth, now, world,
    ...(opts.clientDist !== undefined ? { clientDist: opts.clientDist } : {}),
    ...(opts.rateLimits ? { rateLimits: opts.rateLimits } : {}),
  });
  const httpServer = createServer(app);
  const gameServer = new ColyseusServer({
    transport: new WebSocketTransport({ server: httpServer }),
    greet: false,
    gracefullyShutdown: false,
  });
  restrictMatchmakerCors(config.clientOrigins);
  // Colyseus reads /matchmake bodies itself, before Express and with no size limit: cap and rate-limit them.
  guardMatchmaking(gameServer, {
    trustProxy: config.trustProxy,
    now,
    ...(opts.rateLimits?.matchmake ? { rateLimit: opts.rateLimits.matchmake } : {}),
  });

  const handler = gameServer
    .define(ROOM_NAME, createMatchRoom({
      auth, store, now, daySeconds: config.daySeconds, reconnectSeconds: config.reconnectSeconds,
    }))
    .filterBy(["code", "mapId"]);
  // Normalized filter: a public player (no code) must never land in a friend's room, which the default
  // filter (it skips absent options) would allow.
  handler.getFilterOptions = (options: unknown) => matchFilter(options);

  await gameServer.listen(opts.port ?? config.port, opts.host);
  const port = (httpServer.address() as AddressInfo).port;

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      try {
        await gameServer.gracefullyShutdown(false);
      } catch (err) {
        console.error("[server] shutdown error:", err);
      }
      if (httpServer.listening) {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      }
      httpServer.closeAllConnections();
      await world.flush();
    })();
    return closing;
  };

  return { port, httpServer, gameServer, store, world, close };
}
