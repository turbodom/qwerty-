import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/** The repo root holds the shared .env (see .env.example); only VITE_* variables reach the client. */
const envDir = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "VITE_");
  const target = env["VITE_SERVER_URL"] || "http://localhost:2567";
  return {
    envDir,
    build: {
      target: "es2020",
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          manualChunks: { phaser: ["phaser"] },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": { target, changeOrigin: true },
        // Colyseus matchmaking + websocket when the client uses the same origin (VITE_SERVER_URL empty)
        "/colyseus": {
          target,
          changeOrigin: true,
          ws: true,
          rewrite: (p: string) => p.replace(/^\/colyseus/, ""),
        },
      },
    },
    test: {
      environment: "node",
      include: ["test/**/*.test.ts"],
    },
  };
});
