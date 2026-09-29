import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig } from "./config";
import { startServer } from "./server";

/**
 * Entry point: `tsx src/index.ts`. Reads `.env` (package dir first, then the repo root) without overriding
 * variables that are already set, starts HTTP + Colyseus on PORT and shuts down gracefully on SIGINT/SIGTERM.
 */

const SHUTDOWN_TIMEOUT_MS = 10_000;

function loadDotEnv(): void {
  for (const rel of ["../.env", "../../../.env"]) {
    const path = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[config] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const server = await startServer({ config });
  console.log(
    `[server] Короны Пустоши: http://localhost:${server.port} (${config.env}; guest login ${config.allowGuestLogin ? "on" : "off"}; ` +
      `payments ${config.piApiKey ? "on" : "off"}; day ${config.daySeconds}s)`,
  );

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[server] ${signal}: shutting down`);
    const force = setTimeout(() => {
      console.error("[server] shutdown timed out, exiting");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    server
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error("[server] shutdown failed:", err);
        process.exit(1);
      });
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
