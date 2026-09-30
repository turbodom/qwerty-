import { musicOn, setMusic, setSound, soundOn } from "../../audio";
import { QUESTS, armyPower } from "@korony/shared";
import { artUrl } from "../../gfx/artUrls";
import { LANGS, fmtNum, getLang, setLang, t } from "../../i18n";
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

/** Victory / defeat: a full presentation with the art of the outcome and the real numbers of the match. */
export function resultPanel(won: boolean): PanelFactory {
  return (app: AppApi): PanelSpec => {
    const view = app.view();
    const state = view?.state;
    const me = view ? state?.players.find((p) => p.id === view.you) : undefined;
    const hero = view && state ? Object.values(state.heroes).find((x) => x.owner === view.you) : undefined;
    const days = state?.day ?? 0;
    const mines = view && state ? state.objects.filter((o) => o.kind === "mine" && !o.gone && o.owner === view.you).length : 0;
    const quests = me ? QUESTS.filter((q) => me.quests[q.id]).length : 0;
    const stat = (label: string, value: string | number): HTMLElement =>
      h("div", { class: "result-stat" }, h("b", null, value), h("span", null, label));
    const body = h(
      "div",
      { class: "result" },
      h("div", { class: "result-art" }, h("img", { src: artUrl(won ? "city-player-3" : "battle-bg"), alt: "" })),
      h("div", { class: "result-crest" }, h("img", { src: artUrl("logo"), alt: "" })),
      h("h1", { class: "result-title", testid: "result-title" }, won ? t("result.victory") : t("result.defeat")),
      h("p", { class: "result-text" }, won ? t("result.victoryText", { days }) : t("result.defeatText", { days })),
      h(
        "div",
        { class: "result-stats", testid: "result-stats" },
        stat(t("result.days"), days),
        stat(t("result.heroLevel"), hero ? hero.level : "—"),
        stat(t("result.army"), hero && hero.alive ? fmtNum(armyPower(hero.army)) : "—"),
        stat(t("result.gold"), me ? fmtNum(me.gold) : "—"),
        stat(t("result.mines"), mines),
        stat(t("result.quests"), `${quests}/${QUESTS.length}`),
      ),
      h(
        "div",
        { class: "result-actions" },
        app.isLocal()
          ? h("button", { class: "btn block", testid: "new-game", onClick: () => app.newLocalGame() }, won ? t("result.newGame") : t("result.retry"))
          : null,
        h("button", { class: "btn ghost block", testid: "result-lobby", onClick: () => app.toLobby() }, t("result.toLobby")),
      ),
    );
    return { id: "result", title: t("app.title"), body, center: true, closable: false, className: won ? "result-panel won" : "result-panel lost" };
  };
}
