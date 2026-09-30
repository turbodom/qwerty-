/** The loading splash from index.html: art download progress, rotating tips, and a fade out once the art is ready. */
import { t } from "../i18n";
import type { I18nKey } from "../i18n";

const TIPS = ["tip.1", "tip.2", "tip.3", "tip.4", "tip.5", "tip.6"] as const satisfies readonly I18nKey[];

let tipTimer: ReturnType<typeof setInterval> | null = null;

/** Localizes the splash and starts the tips. */
export function initSplash(): void {
  const status = document.getElementById("splash-status");
  const tip = document.getElementById("splash-tip");
  if (!status || !tip) return;
  status.textContent = t("splash.loading");
  let i = Math.floor(Math.random() * TIPS.length);
  const show = (): void => {
    tip.style.opacity = "0";
    setTimeout(() => {
      tip.textContent = t(TIPS[i % TIPS.length] ?? "tip.1");
      tip.style.opacity = "1";
      i++;
    }, 250);
  };
  show();
  tipTimer = setInterval(show, 4000);
}

/** 0..1 */
export function setSplashProgress(v: number): void {
  const bar = document.getElementById("splash-bar");
  if (bar) bar.style.width = `${Math.round(6 + Math.max(0, Math.min(1, v)) * 94)}%`;
}

export function hideSplash(): void {
  const el = document.getElementById("splash");
  if (!el || el.classList.contains("out")) return;
  setSplashProgress(1);
  if (tipTimer) clearInterval(tipTimer);
  tipTimer = null;
  el.classList.add("out");
  setTimeout(() => el.remove(), 600);
}
