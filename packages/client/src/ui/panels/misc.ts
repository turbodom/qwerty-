import { musicOn, setMusic, setSound, soundOn } from "../../audio";
import { LANGS, getLang, setLang, t } from "../../i18n";
import type { I18nKey } from "../../i18n";
import { h } from "../dom";
import type { AppApi, PanelFactory, PanelSpec } from "./types";

/** Yes / no dialog. */
export function confirmPanel(text: string, onYes: () => void): PanelFactory {
  return (app: AppApi): PanelSpec => {
    const body = h(
      "div",
      { class: "stack" },
      h("p", null, text),
      h(
        "div",
        { class: "seg" },
        h("button", { class: "btn ghost", onClick: () => app.closePanel() }, t("common.no")),
        h(
          "button",
          {
            class: "btn",
            testid: "confirm-yes",
            onClick: () => {
              app.closePanel();
              onYes();
            },
          },
          t("common.yes"),
        ),
      ),
    );
    return { id: "confirm", title: t("app.title"), body, center: true };
  };
}

/** Sound / music / language toggles (lobby and in-game menu). */
export function settingsBlock(onChange: () => void): HTMLElement {
  const state = (on: boolean): string => (on ? t("lobby.on") : t("lobby.off"));
  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "seg" },
      h(
        "button",
        {
          class: `btn ghost small${soundOn() ? " on" : ""}`,
          testid: "toggle-sound",
          onClick: () => {
            setSound(!soundOn());
            onChange();
          },
        },
        t("lobby.sound", { state: state(soundOn()) }),
      ),
      h(
        "button",
        {
          class: `btn ghost small${musicOn() ? " on" : ""}`,
          testid: "toggle-music",
          onClick: () => {
            setMusic(!musicOn());
            onChange();
          },
        },
        t("lobby.music", { state: state(musicOn()) }),
      ),
    ),
    h(
      "div",
      { class: "seg", role: "group", ariaLabel: t("lobby.language") },
      LANGS.map((l) =>
        h(
          "button",
          {
            class: `btn ghost small${getLang() === l ? " on" : ""}`,
            testid: `lang-${l}`,
            onClick: () => {
              setLang(l);
              onChange();
            },
          },
          t(`lang.${l}` as I18nKey),
        ),
      ),
    ),
  );
}

/** In-game menu: settings, back to the lobby and (online) surrender. */
export function menuPanel(app: AppApi): PanelSpec {
  const view = app.view();
  const running = !!view && view.state.winner === null && !view.state.players.find((p) => p.id === view.you)?.defeated;
  const online = !app.isLocal();
  const body = h(
    "div",
    { class: "stack" },
    settingsBlock(() => app.rerender()),
    !online ? h("p", { class: "fx" }, t("menu.localHint")) : running ? h("p", { class: "fx" }, t("menu.onlineHint")) : null,
    h("button", { class: "btn ghost block", testid: "to-lobby", onClick: () => app.toLobby() }, t("menu.toLobby")),
    online && running
      ? h("button", { class: "btn danger block", testid: "surrender", onClick: () => app.surrender() }, t("menu.surrender"))
      : null,
  );
  return { id: "menu", title: t("menu.title"), body, center: true };
}

/** Victory / defeat. */
export function resultPanel(won: boolean, days: number): PanelFactory {
  return (app: AppApi): PanelSpec => {
    const body = h(
      "div",
      { class: "stack" },
      h("p", null, won ? t("result.victoryText", { days }) : t("result.defeatText", { days })),
      app.isLocal()
        ? h("button", { class: "btn block", testid: "new-game", onClick: () => app.newLocalGame() }, t("result.newGame"))
        : null,
      h("button", { class: "btn ghost block", testid: "result-lobby", onClick: () => app.toLobby() }, t("result.toLobby")),
    );
    return { id: "result", title: won ? t("result.victory") : t("result.defeat"), body, center: true, closable: false };
  };
}
