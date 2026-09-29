import { SPELL_IDS, SPELLS, healAmount, heroBoltDamage } from "@korony/shared";
import type { ActiveBattle, Seat, SpellId } from "@korony/shared";
import { t } from "../../i18n";
import { buildingName, spellName } from "../../i18n/catalog";
import { h } from "../dom";
import type { AppApi, PanelFactory, PanelSpec } from "./types";

/** Spellbook for the viewer's battle hero: bolt always, heal/haste with a mage guild. */
export function spellbookPanel(ab: ActiveBattle, side: Seat, onPick: (spell: SpellId) => void): PanelFactory {
  return (app: AppApi): PanelSpec => {
    const body = h("div", { class: "stack" });
    const hero = ab.battle.heroes[side];
    if (!hero) {
      body.append(h("p", { class: "fx" }, t("spell.noHero")));
      return { id: "spellbook", title: t("spell.title"), body, center: true };
    }
    const used = ab.battle.spellUsed[side];
    if (used) body.append(h("p", { class: "fx" }, t("spell.used")));
    const box = h("div", { class: "choice" });
    for (const id of SPELL_IDS) {
      const def = SPELLS[id];
      const known = hero.spells.includes(id);
      let label: string;
      if (id === "bolt") label = t("spell.bolt", { name: spellName(id), dmg: heroBoltDamage(hero) });
      else if (id === "heal") label = t("spell.heal", { name: spellName(id), hp: healAmount(hero.stats.pow ?? 0) });
      else label = t("spell.haste", { name: spellName(id) });
      const req = def.requires;
      box.append(
        h(
          "button",
          {
            class: "btn ghost",
            testid: `spell-${id}`,
            disabled: !known || used,
            onClick: () => {
              app.closePanel();
              onPick(id);
            },
          },
          label,
          !known && req ? h("span", { class: "sub-label" }, t("spell.needs", { building: buildingName(req) })) : null,
        ),
      );
    }
    body.append(box);
    return { id: "spellbook", title: t("spell.title"), body, center: true };
  };
}
