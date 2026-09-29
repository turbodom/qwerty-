import { describe, expect, it } from "vitest";
import { ConfigError, DEV_SESSION_SECRET, loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("uses documented defaults in development and warns about the dev secret", () => {
    const warnings: string[] = [];
    const c = loadConfig({}, (m) => warnings.push(m));
    expect(c.env).toBe("development");
    expect(c.port).toBe(2567);
    expect(c.sessionSecret).toBe(DEV_SESSION_SECRET);
    expect(c.piApiKey).toBeNull();
    expect(c.piApiBase).toBe("https://api.minepi.com");
    expect(c.allowGuestLogin).toBe(true);
    expect(c.daySeconds).toBe(90);
    expect(c.reconnectSeconds).toBe(60);
    expect(c.trustProxy).toBe(false);
    expect(warnings.some((w) => w.includes("SESSION_SECRET"))).toBe(true);
  });

  it("reads and validates values", () => {
    const c = loadConfig(
      {
        PORT: "3000", SESSION_SECRET: "x".repeat(40), PI_API_KEY: "key", PI_API_BASE: "https://api.example.com/",
        ALLOW_GUEST_LOGIN: "false", CLIENT_ORIGIN: "https://a.example, http://localhost:5173/", DAY_SECONDS: "30",
        RECONNECT_SECONDS: "0", TRUST_PROXY: "1",
      },
      () => {},
    );
    expect(c.port).toBe(3000);
    expect(c.piApiKey).toBe("key");
    expect(c.piApiBase).toBe("https://api.example.com");
    expect(c.allowGuestLogin).toBe(false);
    expect(c.clientOrigins).toEqual(["https://a.example", "http://localhost:5173"]);
    expect(c.daySeconds).toBe(30);
    expect(c.reconnectSeconds).toBe(0);
    expect(c.trustProxy).toBe(1);
  });

  it("requires a strong SESSION_SECRET in production and keeps guest login on by default, with a warning", () => {
    expect(() => loadConfig({ NODE_ENV: "production" }, () => {})).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: "production", SESSION_SECRET: "short" }, () => {})).toThrow(/at least 32/);
    expect(() =>
      loadConfig({ NODE_ENV: "production", SESSION_SECRET: "change-me-to-a-long-random-string" }, () => {}),
    ).toThrow(/placeholder/);
    const warnings: string[] = [];
    const c = loadConfig({ NODE_ENV: "production", SESSION_SECRET: "s".repeat(48) }, (m) => warnings.push(m));
    expect(c.allowGuestLogin).toBe(true);
    expect(warnings.some((w) => w.includes("ALLOW_GUEST_LOGIN=false"))).toBe(true);
    expect(c.clientOrigins).toEqual([]);
    const off: string[] = [];
    const piOnly = loadConfig({ NODE_ENV: "production", SESSION_SECRET: "s".repeat(48), ALLOW_GUEST_LOGIN: "false" }, (m) => off.push(m));
    expect(piOnly.allowGuestLogin).toBe(false);
    expect(off.some((w) => w.includes("guest"))).toBe(false);
  });

  it("rejects malformed values", () => {
    expect(() => loadConfig({ PORT: "abc" }, () => {})).toThrow(ConfigError);
    expect(() => loadConfig({ ALLOW_GUEST_LOGIN: "maybe" }, () => {})).toThrow(ConfigError);
    expect(() => loadConfig({ PI_API_BASE: "not a url" }, () => {})).toThrow(ConfigError);
    expect(() => loadConfig({ CLIENT_ORIGIN: "https://a.example/path" }, () => {})).toThrow(ConfigError);
    expect(() => loadConfig({ DAY_SECONDS: "1" }, () => {})).toThrow(ConfigError);
  });
});
