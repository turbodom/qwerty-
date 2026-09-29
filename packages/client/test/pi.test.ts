import { describe, expect, it } from "vitest";
import { inPiEnvironment } from "../src/pi";

const PI_BROWSER =
  "Mozilla/5.0 (Linux; Android 14; SM-A166P Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 PiBrowser/1.17.1";
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

describe("inPiEnvironment", () => {
  it("recognises Pi Browser by its user agent", () => {
    expect(inPiEnvironment(PI_BROWSER, false)).toBe(true);
  });

  it("treats a normal browser as outside Pi, so the guest login is offered", () => {
    expect(inPiEnvironment(CHROME, false)).toBe(false);
    // without VITE_PI_SANDBOX a frame alone does not count as the Pi sandbox
    expect(inPiEnvironment(CHROME, true)).toBe(false);
    expect(inPiEnvironment("", false)).toBe(false);
  });
});
