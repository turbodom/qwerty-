/** The tutorial card over the map: the current step, its progress and a way out. */
import type { GameEvent, PlayerView } from "@korony/shared";
import { TUTORIAL_STEPS, advance } from "../game/tutorial";
import type { TutorialSignals, TutorialState } from "../game/tutorial";
import { t } from "../i18n";
import type { I18nKey } from "../i18n";
import { STORAGE_KEYS, readJson, removeItem, writeJson } from "../storage";
import { h } from "./dom";

export class Coach {
  readonly el: HTMLElement;
  private state: TutorialState | null;
  private readonly sig: TutorialSignals = { castleOpened: false };
  private view: PlayerView | null = null;

  constructor() {
    this.el = h("div", { class: "coach", hidden: true, testid: "coach" });
    const saved = readJson<TutorialState>(STORAGE_KEYS.tutorial);
    this.state = saved && typeof saved.gameId === "string" && Number.isInteger(saved.step) ? saved : null;
  }

  /** Starts the tutorial for a new local game. */
  begin(gameId: string): void {
    this.state = { gameId, step: 0 };
    this.sig.castleOpened = false;
    writeJson(STORAGE_KEYS.tutorial, this.state);
  }

  /** Ends the tutorial (skipped, finished or the game was left for another one). */
  stop(): void {
    this.state = null;
    removeItem(STORAGE_KEYS.tutorial);
    this.render();
  }

  /** A processed update of a local game (null view: not on the map). */
  update(view: PlayerView | null, events: readonly GameEvent[], visible: boolean): void {
    this.view = view;
    const st = this.state;
    if (st && view && view.state.id === st.gameId) {
      const next = advance(st, view, events, this.sig);
      if (next !== st) {
        this.state = next;
        writeJson(STORAGE_KEYS.tutorial, next);
      }
    }
    this.render(visible);
  }

  /** The castle panel was opened. */
  castleOpened(): void {
    if (this.sig.castleOpened) return;
    this.sig.castleOpened = true;
    if (this.view) this.update(this.view, [], !this.el.hidden);
  }

  private render(visible = !this.el.hidden): void {
    const st = this.state;
    const view = this.view;
    this.el.replaceChildren();
    if (!st || !view || view.state.id !== st.gameId || !visible || st.step >= TUTORIAL_STEPS.length) {
      this.el.hidden = true;
      return;
    }
    const id = TUTORIAL_STEPS[st.step] ?? "win";
    const last = id === "win";
    this.el.hidden = false;
    this.el.append(
      h("div", { class: "coach-head" }, h("b", null, t("tut.title")), h("small", null, t("tut.progress", { n: st.step + 1, total: TUTORIAL_STEPS.length }))),
      h("p", { testid: `coach-${id}` }, t(`tut.${id}` as I18nKey)),
      h(
        "div",
        { class: "coach-actions" },
        last
          ? h("button", { class: "btn small", testid: "coach-done", onClick: () => this.stop() }, t("tut.done"))
          : h("button", { class: "btn ghost small", testid: "coach-skip", onClick: () => this.stop() }, t("tut.skip")),
      ),
    );
  }
}
