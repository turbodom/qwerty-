import { mePlayer, myHero } from "../../game/helpers";
import { t } from "../../i18n";
import { skillDesc, skillName } from "../../i18n/catalog";
import { skillIconUrl } from "../../gfx/artUrls";
import { h } from "../dom";
import type { AppApi, PanelSpec } from "./types";

/** Level-up choice: the first queued pair of skills. */
export function levelUpPanel(app: AppApi): PanelSpec {
  const view = app.view();
  const me = view ? mePlayer(view) : undefined;
  const hero = view ? myHero(view) : undefined;
  const body = h("div", { class: "stack" });
  const choice = me?.levelChoices[0];
  if (!me || !hero || !choice) {
    return { id: "levelup", title: t("hero.chooseSkill"), body, center: true };
  }
  const level = hero.level - me.levelChoices.length + 1;
  body.append(h("p", { class: "fx" }, t("level.choose", { name: hero.name })));
  const box = h("div", { class: "choice" });
  choice.forEach((id, i) => {
    box.append(
      h(
        "button",
        {
          class: "btn ghost with-icon",
          testid: `skill-${i}`,
          onClick: async () => {
            // one choice per pair: a double tap must not spend the next queued pair too
            if (box.dataset["busy"]) return;
            box.dataset["busy"] = "1";
            for (const b of box.querySelectorAll("button")) b.disabled = true;
            const res = await app.act({ type: "chooseSkill", index: i === 0 ? 0 : 1 });
            if (res.ok) app.closePanel();
            else {
              delete box.dataset["busy"];
              for (const b of box.querySelectorAll("button")) b.disabled = false;
            }
          },
        },
        h("img", { src: skillIconUrl(id), alt: "" }),
        h("span", null, `${skillName(id)}: ${skillDesc(id)}`),
      ),
    );
  });
  body.append(box);
  if (me.levelChoices.length > 1) body.append(h("div", { class: "fx" }, t("level.more", { n: me.levelChoices.length - 1 })));
  return { id: "levelup", title: t("level.title", { level }), body, center: true };
}
