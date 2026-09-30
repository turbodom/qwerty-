import { ARTIFACTS, SETS, SLOTS, armyPower, effectiveStat, expToNext, heroSpells, maxMovement, setCounts } from "@korony/shared";
import type { ArmyStack, ArtifactId, GameState, SetId, SkillId, SlotId, StatKey } from "@korony/shared";
import { gearTier, heroBodyUrl, skillIconUrl, spellIconUrl } from "../../gfx/artUrls";
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

/** The backpack item whose details are shown. */
let selectedBag: number | null = null;

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
  const st = (k: StatKey): number => effectiveStat(hero, k);
  body.append(
    h(
      "div",
      { class: "hero-head" },
      h("div", { class: "hero-lvl" }, h("small", null, t("hero.level")), h("b", null, hero.level)),
      h(
        "div",
        { class: "grow" },
        h("div", { class: "hero-xp" }, h("span", null, t("hero.expShort")), h("span", null, `${fmtNum(hero.exp)} / ${fmtNum(need)}`)),
        h("div", { class: "progress" }, h("i", { style: `width:${Math.min(100, Math.round((hero.exp / need) * 100))}%` })),
      ),
      h("div", { class: "hero-power" }, h("small", null, t("hero.power")), h("b", { testid: "hero-power" }, fmtNum(armyPower(hero.army)))),
    ),
  );
  if (me.levelChoices.length > 0) {
    body.append(
      h("button", { class: "btn block", testid: "choose-skill", onClick: () => app.openPanel(levelUpPanel) }, t("hero.chooseSkill")),
    );
  }

  body.append(h("div", { class: "section-title" }, t("hero.army")), h("div", { class: "inline" }, armyChips(view.state, view.you, hero.army)));


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

  // characteristics as a list with icons, then the spells as an ability bar
  const rows: [SkillId, I18nKey, string][] = [
    ["offense", "hero.stat.atk", String(st("atk"))],
    ["armor", "hero.stat.def", String(st("def"))],
    ["sorcery", "hero.stat.pow", String(st("pow"))],
    ["luck", "hero.stat.luck", String(st("luck"))],
    ["leadership", "hero.stat.morale", String(st("morale"))],
    ["pathfinding", "hero.stat.move", `${hero.mp} / ${maxMovement(hero)}`],
  ];
  body.append(
    h("div", { class: "section-title" }, t("hero.statsTitle")),
    h(
      "div",
      { class: "hero-stats", testid: "hero-stats" },
      rows.map(([icon, key, value]) =>
        h("div", { class: "hero-stat" }, h("img", { src: skillIconUrl(icon), alt: "" }), h("span", null, t(key)), h("b", null, value)),
      ),
      st("spd") > 0 ? h("div", { class: "hero-stat" }, h("span", { class: "hero-stat-ico" }, "»"), h("span", null, t("hero.stat.spd")), h("b", null, `+${st("spd")}`)) : null,
    ),
  );
  const spells = heroSpells(view.state, hero);
  if (spells.length > 0) {
    body.append(
      h("div", { class: "section-title" }, t("hero.abilities")),
      h(
        "div",
        { class: "hero-abilities" },
        spells.map((id) => h("div", { class: "hero-ability", title: spellName(id) }, h("img", { src: spellIconUrl(id), alt: "" }), h("span", null, spellName(id)))),
      ),
    );
  }

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

  // backpack: an inventory grid; tapping an item shows its details with the equip button
  body.append(h("div", { class: "section-title" }, t("hero.bag")));
  if (hero.bag.length === 0) body.append(h("p", { class: "fx" }, t("hero.bagEmpty")));
  const sel = selectedBag !== null && hero.bag[selectedBag] ? selectedBag : hero.bag.length > 0 ? 0 : null;
  const cells: HTMLElement[] = hero.bag.map((id, i) =>
    h(
      "button",
      {
        type: "button",
        class: `inv-cell r${ARTIFACTS[id].rarity}${i === sel ? " sel" : ""}`,
        testid: `bag-${i}`,
        title: artifactName(id),
        ariaLabel: artifactName(id),
        onClick: () => {
          selectedBag = i;
          app.rerender();
        },
      },
      h("img", { src: artIconUrl(id), alt: "" }),
    ),
  );
  const minCells = Math.max(10, Math.ceil(hero.bag.length / 5) * 5);
  for (let i = hero.bag.length; i < minCells; i++) cells.push(h("div", { class: "inv-cell empty" }));
  body.append(h("div", { class: "inv-grid" }, cells));
  const selId: ArtifactId | undefined = sel !== null ? hero.bag[sel] : undefined;
  if (selId) {
    const a = ARTIFACTS[selId];
    body.append(
      h(
        "div",
        { class: `inv-detail r${a.rarity}`, testid: "bag-detail" },
        h("img", { src: artIconUrl(selId), alt: "" }),
        h(
          "div",
          { class: "grow" },
          h("b", { class: `r${a.rarity}` }, artifactName(selId)),
          h("div", { class: "fx" }, `${t(`rarity.${a.rarity}` as I18nKey)} · ${slotName(a.slot === "ring" ? "ring1" : a.slot)}`),
          h("div", null, artifactFx(a)),
        ),
        h(
          "button",
          { class: "btn small", testid: "bag-equip", onClick: () => { selectedBag = null; void app.act({ type: "equip", artifact: selId }); } },
          t("hero.equip"),
        ),
      ),
    );
  }
  return { id: "hero", title, body };
}
