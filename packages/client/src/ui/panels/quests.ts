import { QUESTS } from "@korony/shared";
import { mePlayer } from "../../game/helpers";
import { fmtNum, t } from "../../i18n";
import { questName } from "../../i18n/catalog";
import { h } from "../dom";
import type { AppApi, PanelSpec } from "./types";

export function questsPanel(app: AppApi): PanelSpec {
  const view = app.view();
  const me = view ? mePlayer(view) : undefined;
  const body = h("div", { class: "stack" });
  const done = QUESTS.filter((q) => me?.quests[q.id]).length;
  body.append(h("div", { class: "fx" }, t("quests.summary", { done, total: QUESTS.length })));
  const list = h("div", null);
  for (const q of QUESTS) {
    const ok = !!me?.quests[q.id];
    const rewards: string[] = [];
    if (q.gold) rewards.push(t("quests.gold", { n: fmtNum(q.gold) }));
    if (q.exp) rewards.push(t("quests.exp", { n: fmtNum(q.exp) }));
    list.append(
      h(
        "div",
        { class: "quest", testid: `quest-${q.id}` },
        h("div", null, ok ? h("s", null, questName(q.id)) : h("span", null, questName(q.id)), h("div", { class: "fx" }, rewards.join(" · "))),
        h("span", { class: `state${ok ? " done" : ""}` }, ok ? t("quests.done") : t("quests.inProgress")),
      ),
    );
  }
  body.append(list);
  return { id: "quests", title: t("quests.title"), body };
}
