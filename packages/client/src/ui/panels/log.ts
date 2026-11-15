import { chronicle } from "../mapTools";
import { t } from "../../i18n";
import { h } from "../dom";
import type { AppApi, PanelSpec } from "./types";

/** The game's chronicle: days, battles, captures and weekly events, newest first. */
export function logPanel(app: AppApi): PanelSpec {
  const view = app.view();
  const lines = view ? chronicle(view) : [];
  const body = h(
    "div",
    { class: "stack" },
    lines.length === 0
      ? h("p", { class: "fx" }, t("map.logEmpty"))
      : h("ul", { class: "wlist log", testid: "chronicle" }, ...lines.map((line) => h("li", null, h("span", null, line)))),
  );
  return { id: "log", title: t("map.log"), body };
}
