import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/en";
import { ru } from "../src/i18n/ru";
import { DICTIONARIES, LANGS, detectLang, format, placeholders, setLang, t } from "../src/i18n";

describe("i18n dictionaries", () => {
  it("ru and en have exactly the same keys", () => {
    const ruKeys = Object.keys(ru).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(ruKeys);
    expect(ruKeys.length).toBeGreaterThan(100);
  });

  it("every language has the same placeholders per key", () => {
    for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
      const expected = placeholders(ru[key]);
      for (const lang of LANGS) {
        expect(placeholders(DICTIONARIES[lang][key]), `${lang}:${key}`).toEqual(expected);
      }
    }
  });

  it("no string is empty", () => {
    for (const lang of LANGS) {
      for (const [k, v] of Object.entries(DICTIONARIES[lang])) expect(v.trim(), `${lang}:${k}`).not.toBe("");
    }
  });
});

describe("t / format / detectLang", () => {
  it("substitutes params and keeps unknown placeholders", () => {
    expect(format("Шагов: {n}.", { n: 5 })).toBe("Шагов: 5.");
    expect(format("{a} and {b}", { a: "x" })).toBe("x and {b}");
  });

  it("translates in the current language", () => {
    setLang("ru");
    expect(t("bar.endDay")).toBe("Конец дня");
    expect(t("top.day", { week: 2, day: 3 })).toBe("Неделя 2, день 3");
    setLang("en");
    expect(t("bar.endDay")).toBe("End day");
    setLang("ru");
  });

  it("prefers the stored language, then the browser, then Russian", () => {
    expect(detectLang("en", ["ru-RU"])).toBe("en");
    expect(detectLang(null, ["en-US", "ru"])).toBe("en");
    expect(detectLang(null, ["de-DE", "ru-RU"])).toBe("ru");
    expect(detectLang("xx", ["fr"])).toBe("ru");
    expect(detectLang(null, [])).toBe("ru");
  });
});
