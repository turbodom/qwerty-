import { en } from "./en";
import { ru } from "./ru";
import type { I18nKey } from "./ru";
import { STORAGE_KEYS, readItem, writeItem } from "../storage";

export type { I18nKey } from "./ru";

export type Lang = "ru" | "en";
export const LANGS: readonly Lang[] = ["ru", "en"];

export const DICTIONARIES: Record<Lang, Record<I18nKey, string>> = { ru, en };

export type I18nParams = Record<string, string | number>;

function isLang(x: unknown): x is Lang {
  return x === "ru" || x === "en";
}

/**
 * Picks the language: a stored choice wins; otherwise the first browser language we support;
 * Russian by default.
 */
export function detectLang(stored: string | null, languages: readonly string[]): Lang {
  if (isLang(stored)) return stored;
  for (const l of languages) {
    const primary = l.toLowerCase().split(/[-_]/)[0];
    if (isLang(primary)) return primary;
  }
  return "ru";
}

function browserLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  const list = Array.isArray(navigator.languages) ? [...navigator.languages] : [];
  if (list.length === 0 && typeof navigator.language === "string") list.push(navigator.language);
  return list;
}

let current: Lang = detectLang(readItem(STORAGE_KEYS.lang), browserLanguages());
const listeners = new Set<(lang: Lang) => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (!isLang(lang) || lang === current) return;
  current = lang;
  writeItem(STORAGE_KEYS.lang, lang);
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  for (const cb of listeners) cb(lang);
}

export function onLangChange(cb: (lang: Lang) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Replaces `{name}` placeholders; unknown placeholders are left as they are. */
export function format(template: string, params?: I18nParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined ? m : String(v);
  });
}

/** Translated string for `key` in the current language (falls back to Russian, then to the key). */
export function t(key: I18nKey, params?: I18nParams): string {
  const s = DICTIONARIES[current][key] ?? ru[key] ?? key;
  return format(s, params);
}

/** Number with locale grouping: 12 500 (ru) / 12,500 (en). */
export function fmtNum(n: number): string {
  const locale = current === "ru" ? "ru-RU" : "en-US";
  try {
    return Math.round(n).toLocaleString(locale);
  } catch {
    return String(Math.round(n));
  }
}

/** Placeholder names used in a template, sorted (for parity tests). */
export function placeholders(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{(\w+)\}/g)) if (m[1]) out.add(m[1]);
  return [...out].sort();
}
