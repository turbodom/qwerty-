import { ARTIFACTS, MINE_INCOME, QUESTS } from "@korony/shared";
import type { GameEvent, GameState, PlayerId } from "@korony/shared";
import type { SfxName } from "../audio";
import { fmtNum, t } from "../i18n";
import type { I18nKey } from "../i18n";
import { artifactFx, artifactName, engineText, questName } from "../i18n/catalog";

export interface Feedback {
  toasts: string[];
  sounds: SfxName[];
}

/**
 * Player-facing toasts and sounds for a batch of events (already filtered for the viewer).
 * Structured events (gold from chests and income, artifacts, quests, levels, mines, new week) get
 * translated toasts. The engine follows each of those with its own Russian `toast` event; that one is
 * skipped so nothing is shown twice. Other engine toasts (skills, buildings, captures) are shown as is.
 */
export function feedbackFromEvents(events: readonly GameEvent[], you: PlayerId, state?: GameState): Feedback {
  const toasts: string[] = [];
  const sounds: SfxName[] = [];
  let skipNextToast = false;
  let leveled = false;
  const sound = (s: SfxName): void => {
    if (!sounds.includes(s)) sounds.push(s);
  };

  for (const e of events) {
    switch (e.type) {
      case "gold":
        if (e.player !== you) break;
        if (e.reason === "chest") {
          toasts.push(t("toast.gold", { amount: fmtNum(e.amount) }));
          skipNextToast = true;
          sound("coin");
        } else if (e.reason === "income") {
          toasts.push(t("toast.income", { amount: fmtNum(e.amount) }));
        } else if (e.reason === "build" || e.reason === "upgrade") {
          sound("build");
        } else if (e.reason === "hire" || e.reason === "quest") {
          sound("coin");
        }
        break;
      case "artifact": {
        if (e.player !== you) break;
        const a = ARTIFACTS[e.artifact];
        const rarity = t(`rarity.${a.rarity}` as I18nKey);
        toasts.push(
          t("toast.artifact", {
            rarity: rarity.charAt(0).toUpperCase() + rarity.slice(1),
            name: artifactName(e.artifact),
            fx: artifactFx(a),
          }),
        );
        skipNextToast = true;
        sound("coin");
        break;
      }
      case "quest": {
        if (e.player !== you) break;
        const q = QUESTS.find((x) => x.id === e.quest);
        let text = t("toast.quest", { name: q ? questName(q.id) : e.quest });
        if (q?.gold) text += ` · ${t("quests.gold", { n: fmtNum(q.gold) })}`;
        if (q?.exp) text += ` · ${t("quests.exp", { n: fmtNum(q.exp) })}`;
        toasts.push(text);
        skipNextToast = true;
        sound("level");
        break;
      }
      case "level":
        if (e.player === you && !leveled) {
          leveled = true;
          toasts.push(t("toast.level"));
          sound("level");
        }
        break;
      case "mine":
        if (e.player === you) {
          toasts.push(t("toast.mine", { gold: fmtNum(MINE_INCOME) }));
          skipNextToast = true;
          sound("coin");
        } else {
          toasts.push(t("toast.mineLost"));
        }
        break;
      case "newWeek":
        toasts.push(t("toast.newWeek"));
        skipNextToast = true;
        break;
      case "defeat":
        if (e.player !== you && state) {
          const p = state.players.find((x) => x.id === e.player);
          if (p && state.winner === null) toasts.push(t("toast.playerDefeated", { name: p.name }));
        }
        break;
      case "toast":
        if (e.player !== undefined && e.player !== you) break;
        if (skipNextToast) {
          skipNextToast = false;
          break;
        }
        toasts.push(engineText(e.text));
        break;
      case "moved":
        sound("step");
        break;
      default:
        break;
    }
  }
  return { toasts, sounds };
}
