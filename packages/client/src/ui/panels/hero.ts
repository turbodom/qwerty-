import { ARTIFACTS, SETS, SLOTS, effectiveStat, expToNext, heroSpells, maxMovement, setCounts } from "@korony/shared";
import type { ArmyStack, GameState, SetId, SlotId } from "@korony/shared";
import { gearTier, heroBodyUrl } from "../../gfx/artUrls";
import { artIconUrl, unitIconUrl } from "../../gfx/bake";
import { mePlayer, myHero, ownerColor } from "../../game/helpers";
import { fmtNum, t } from "../../i18n";
import { artifactFx, artifactName, countLabel, setDesc, setName, slotName, spellName, unitName } from "../../i18n/catalog";
import type { I18nKey } from "../../i18n";
import { h } from "../dom";
import { levelUpPanel } from "./levelup";
import type { AppApi, PanelSpec } from "./types";

/** Slots shown left and right of the hero figure. */
const LEFT_SLOTS: readonly SlotId[] = ["head", "neck", "shoulders", "torso", "cloak"];
const RIGHT_SLOTS: readonly SlotId[] = ["weapon", "shield", "ring1", "ring2", "feet"];

/** Army stacks as chips; `compact` (the action bar) shows icon and count only, the name goes to the tooltip. */
export function armyChips(state: GameState, owner: string, army: readonly ArmyStack[], compact = false): HTMLElement[] {
  const color = ownerColor(state, owner);
  return army
    .filter((s) => s.count > 0 || s.countHint)
    .map((s) => {
      const name = unitName(s.unit);
      const count = s.countHint ? countLabel(s.countHint) : String(s.count);
      return h(
        "span",
        { class: compact ? "chip compact" : "chip", title: `${name} ${count}`, ariaLabel: `${name} ${count}` },
        h("img", { src: unitIconUrl(s.unit, color), alt: "" }),
        compact ? count : `${name} ${count}`,
      );
    });
}

export function heroPanel(app: AppApi): PanelSpec {
  const view = app.view();
  const hero = view ? myHero(view) : undefined;
  const me = view ? mePlayer(view) : undefined;
  const body = h("div", { class: "stack" });
  if (!view || !hero || !me) return { id: "hero", title: t("bar.hero"), body };
  const title = t("hero.title", { name: hero.name, level: hero.level });
  if (!hero.alive) {
    body.append(h("p", null, t("hero.dead")));
    return { id: "hero", title, body };
  }

  const need = expToNext(hero.level);
  const st = (k: Parameters<typeof effectiveStat>[1]): number => effectiveStat(hero, k);
  body.append(
    h("div", { class: "fx" }, t("hero.exp", { exp: fmtNum(hero.exp), next: fmtNum(need) })),
    h("div", { class: "progress" }, h("i", { style: `width:${Math.min(100, Math.round((hero.exp / need) * 100))}%` })),
    h(
      "div",
      { class: "fx" },
      t("hero.stats", {
        atk: st("atk"), def: st("def"), pow: st("pow"), luck: st("luck"), morale: st("morale"), spd: st("spd"),
        move: maxMovement(hero),
      }),
    ),
    h("div", { class: "fx" }, t("hero.mp", { mp: hero.mp, max: maxMovement(hero) })),
  );

  if (me.levelChoices.length > 0) {
    body.append(
      h("button", { class: "btn block", testid: "choose-skill", onClick: () => app.openPanel(levelUpPanel) }, t("hero.chooseSkill")),
    );
  }

  body.append(h("div", { class: "section-title" }, t("hero.army")), h("div", { class: "inline" }, armyChips(view.state, view.you, hero.army)));

  const spells = heroSpells(view.state, hero).map((id) => spellName(id));
  body.append(h("div", { class: "fx" }, t("hero.spells", { list: spells.join(", ") })));

  // equipment: the hero figure between the 10 slots; the figure gets heavier gear as more slots fill
  const color = ownerColor(view.state, view.you);
  const slot = (id: SlotId): HTMLElement => {
    const art = hero.equipped[id];
    const a = art ? ARTIFACTS[art] : undefined;
    const label = slotName(id);
    if (!a || !art) {
      return h(
        "div",
        { class: "pd-slot", testid: `slot-${id}`, title: `${label}: ${t("hero.empty")}` },
        h("span", { class: "pd-empty" }),
        h("span", { class: "pd-name" }, label),
      );
    }
    return h(
      "button",
      {
        type: "button",
        class: `pd-slot filled r${a.rarity}`,
        testid: `slot-${id}`,
        title: `${artifactName(art)}: ${artifactFx(a)}. ${t("hero.unequip")}`,
        ariaLabel: `${label}: ${artifactName(art)}. ${t("hero.unequip")}`,
        onClick: () => void app.act({ type: "unequip", slot: id }),
      },
      h("img", { src: artIconUrl(art), alt: "" }),
      h("span", { class: "pd-name" }, label),
    );
  };
  const worn = SLOTS.filter((s) => hero.equipped[s.id]).length;
  body.append(
    h("div", { class: "section-title" }, t("hero.slots")),
    h(
      "div",
      { class: "paperdoll" },
      h("div", { class: "pd-col" }, LEFT_SLOTS.map(slot)),
      h(
        "div",
        { class: "pd-figure" },
        h("img", { src: heroBodyUrl(color === "red" ? "enemy" : "player", gearTier(worn)), alt: hero.name }),
      ),
      h("div", { class: "pd-col" }, RIGHT_SLOTS.map(slot)),
    ),
    h("p", { class: "fx" }, t("hero.unequipHint")),
  );

  // sets
  const counts = setCounts(hero);
  for (const k of Object.keys(SETS) as SetId[]) {
    const def = SETS[k];
    const n = counts[k] ?? 0;
    body.append(
      h(
        "div",
        { class: "fx" },
        t(n >= def.need ? "hero.setActive" : "hero.setPending", { name: setName(k), n, need: def.need, desc: setDesc(k) }),
      ),
    );
  }

  // backpack
  body.append(h("div", { class: "section-title" }, t("hero.bag")));
  if (hero.bag.length === 0) body.append(h("p", { class: "fx" }, t("hero.bagEmpty")));
  hero.bag.forEach((id, i) => {
    const a = ARTIFACTS[id];
    body.append(
      h(
        "div",
        { class: "item-row", testid: `bag-${i}` },
        h("img", { src: artIconUrl(id), alt: "" }),
        h(
          "div",
          { class: "grow" },
          h("b", { class: `r${a.rarity}` }, artifactName(id)),
          h("div", { class: "fx" }, `${t(`rarity.${a.rarity}` as I18nKey)} · ${artifactFx(a)}`),
        ),
        h("button", { class: "btn ghost small", onClick: () => void app.act({ type: "equip", artifact: id }) }, t("hero.equip")),
      ),
    );
  });
  return { id: "hero", title, body };
}
