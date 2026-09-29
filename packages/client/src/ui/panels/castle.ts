import { BUILDINGS, FACTION_UNITS, UNITS, heroCastle } from "@korony/shared";
import type { UnitId } from "@korony/shared";
import { buildingIconUrl } from "../../gfx/artUrls";
import { unitIconUrl } from "../../gfx/bake";
import {
  buildReason, factionBuildings, hireInfo, mePlayer, myHero, ownerColor, upgradeInfo,
} from "../../game/helpers";
import type { Reason } from "../../game/helpers";
import { fmtNum, t } from "../../i18n";
import { buildingDesc, buildingName, unitAbility, unitName } from "../../i18n/catalog";
import type { I18nKey } from "../../i18n";
import { h } from "../dom";
import type { AppApi, PanelSpec } from "./types";

function reasonText(r: Reason | null): string {
  return r ? t(r.key, r.params) : "";
}

/** Castle: hire, one building a day, forge upgrades. Every button is a GameAction; disabled ones say why. */
export function castlePanel(app: AppApi): PanelSpec {
  const view = app.view();
  const me = view ? mePlayer(view) : undefined;
  const hero = view ? myHero(view) : undefined;
  const body = h("div", { class: "stack" });
  if (!view || !me) return { id: "castle", title: t("bar.castle"), body };
  const title = t("castle.title", { faction: t(`faction.${me.faction}` as I18nKey) });
  const color = ownerColor(view.state, view.you);

  body.append(
    h("div", { class: "row" }, h("span", null, t("castle.goldRow")), h("b", { testid: "castle-gold" }, fmtNum(me.gold))),
  );

  const inCastle = !!heroCastle(view.state, view.you);
  if (!inCastle) {
    const castle = view.state.objects.find((o) => o.id === me.castleId && o.owner === view.you && !o.gone);
    body.append(h("p", { class: "fx" }, t("castle.notHere")));
    if (castle && hero?.alive) {
      body.append(
        h(
          "button",
          {
            class: "btn ghost block",
            onClick: async () => {
              app.closePanel();
              await app.act({ type: "move", to: { x: castle.x, y: castle.y } });
            },
          },
          t("castle.goHome"),
        ),
      );
    }
  }

  // hire
  body.append(h("div", { class: "section-title" }, t("castle.hire")));
  const units: readonly UnitId[] = me.faction === "neutral" ? [] : FACTION_UNITS[me.faction];
  for (const unit of units) {
    const u = UNITS[unit];
    const info = hireInfo(view, unit);
    body.append(
      h(
        "div",
        { class: "item-row", testid: `hire-${unit}` },
        h("img", { src: unitIconUrl(unit, color), alt: "" }),
        h(
          "div",
          { class: "grow" },
          h("b", null, unitName(unit)),
          h("div", { class: "fx" }, t("castle.available", { n: info.available, cost: fmtNum(u.cost) })),
          h(
            "div",
            { class: "fx" },
            t("castle.unitStats", { atk: u.atk, def: u.def, hp: u.hp, spd: u.spd }) + (unitAbility(unit) ? ` · ${unitAbility(unit) ?? ""}` : ""),
          ),
          info.reason ? h("span", { class: "reason" }, reasonText(info.reason)) : null,
        ),
        h(
          "button",
          {
            class: "btn small",
            disabled: !!info.reason,
            onClick: () => void app.act({ type: "hire", unit }),
          },
          t("castle.hireBtn", { n: info.n || "" }).trim(),
        ),
      ),
    );
  }
  body.append(h("div", { class: "fx" }, t("castle.growthNote")));

  // buildings
  body.append(h("div", { class: "section-title" }, t("castle.buildings")));
  for (const id of factionBuildings(view)) {
    const b = BUILDINGS[id];
    const has = !!me.built[id];
    const reason = has ? null : buildReason(view, id);
    body.append(
      h(
        "div",
        { class: "item-row", testid: `build-${id}` },
        h("img", { src: buildingIconUrl(id), alt: "" }),
        h(
          "div",
          { class: "grow" },
          h("b", null, buildingName(id)),
          h("div", { class: "fx" }, has ? t("castle.built") : buildingDesc(id)),
          reason ? h("span", { class: "reason" }, reasonText(reason)) : null,
        ),
        h(
          "button",
          {
            class: "btn ghost small",
            disabled: has || !!reason,
            onClick: () => void app.act({ type: "build", building: id }),
          },
          has ? t("castle.have") : t("common.gold", { amount: fmtNum(b.cost) }),
        ),
      ),
    );
  }

  // forge upgrades
  const ups = (hero?.army ?? [])
    .map((s) => ({ s, info: upgradeInfo(view, s.unit) }))
    .filter((x): x is { s: (typeof x)["s"]; info: NonNullable<(typeof x)["info"]> } => x.info !== null);
  if (ups.length > 0) {
    body.append(h("div", { class: "section-title" }, t("castle.upgrades")));
    for (const { s, info } of ups) {
      const to = UNITS[info.to];
      body.append(
        h(
          "div",
          { class: "item-row upgrade", testid: `upgrade-${s.unit}` },
          h("img", { src: unitIconUrl(info.to, color), alt: "" }),
          h(
            "div",
            { class: "grow" },
            h("b", null, t("castle.upgradeRow", { from: unitName(s.unit), n: s.count, to: unitName(info.to) })),
            h("div", { class: "fx" }, t("castle.upgradeCost", { cost: fmtNum(info.cost), atk: to.atk, spd: to.spd })),
            info.reason ? h("span", { class: "reason" }, reasonText(info.reason)) : null,
          ),
          h(
            "button",
            {
              class: "btn ghost small",
              disabled: !!info.reason,
              onClick: () => void app.act({ type: "upgrade", unit: s.unit }),
            },
            t("castle.upgradeBtn", { n: info.n || "" }).trim(),
          ),
        ),
      );
    }
  }

  const castleObj = view.state.objects.find((o) => o.id === me.castleId);
  const gar = (castleObj?.garrison ?? []).filter((s) => s.count > 0);
  if (gar.length > 0) {
    body.append(
      h("div", { class: "fx" }, t("castle.garrison", { list: gar.map((s) => `${unitName(s.unit)} ${s.count}`).join(", ") })),
    );
  }
  return { id: "castle", title, body };
}
