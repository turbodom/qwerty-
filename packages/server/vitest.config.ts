import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Colyseus loads @pm2/io, which talks over process.send() when an IPC channel exists and
    // confuses the child-process pool; worker threads have no such channel.
    pool: "threads",
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
