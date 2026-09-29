import { beforeEach, describe, expect, it } from "vitest";
import { applyAction, createGame, playerView } from "@korony/shared";
import type { GameEvent, GameState } from "@korony/shared";
import { buildReason, hireInfo, mapLockReason, myBattle, upgradeInfo } from "../src/game/helpers";
import { feedbackFromEvents } from "../src/game/toasts";
import { setLang } from "../src/i18n";

beforeEach(() => setLang("ru"));

function newGame(): GameState {
  return createGame({
    id: "t", mapId: "valley", seed: 1,
    players: [{ id: "you", name: "Игрок", isAI: false }, { id: "ai", name: "ИИ", isAI: true }],
  });
}

describe("feedbackFromEvents", () => {
  it("translates structured events and skips the engine's duplicate toast", () => {
    const events: GameEvent[] = [
      { type: "gold", player: "you", amount: 1000, reason: "chest" },
      { type: "toast", player: "you", text: "+1 000 золота" },
      { type: "quest", player: "you", quest: "chest" },
      { type: "toast", player: "you", text: "Задание выполнено: Откройте сундук. +500 золота" },
      { type: "gold", player: "you", amount: 500, reason: "quest" },
      { type: "toast", player: "you", text: "Построено: Кузница" },
    ];
    const fb = feedbackFromEvents(events, "you");
    expect(fb.toasts).toHaveLength(3);
    expect(fb.toasts[0]).toMatch(/1\s000 золота/);
    expect(fb.toasts[1]).toMatch(/^Задание выполнено: Откройте сундук/);
    expect(fb.toasts[2]).toBe("Построено: Кузница");
    expect(fb.sounds).toContain("coin");
    expect(fb.sounds).toContain("level");
  });

  it("ignores other players' private events and reports new weeks and income", () => {
    const events: GameEvent[] = [
      { type: "gold", player: "ai", amount: 1000, reason: "chest" },
      { type: "toast", player: "ai", text: "secret" },
      { type: "newWeek" },
      { type: "toast", text: "Новая неделя! В замке новые войска." },
      { type: "gold", player: "you", amount: 1500, reason: "income" },
      { type: "level", player: "you" },
      { type: "level", player: "you" },
    ];
    const fb = feedbackFromEvents(events, "you");
    expect(fb.toasts).toEqual([
      "Новая неделя! В замке новые войска.",
      expect.stringMatching(/^Доход: \+1\s500 золота$/),
      "Новый уровень! Выберите навык.",
    ]);
  });
});

describe("castle helpers", () => {
  it("explains why castle actions are disabled", () => {
    const s = newGame();
    let view = playerView(s, "you");
    // hero starts next to the castle, not in it
    expect(hireInfo(view, "pike").reason?.key).toBe("reason.notInCastle");
    expect(buildReason(view, "forge")?.key).toBe("reason.notInCastle");
    expect(applyAction(s, "you", { type: "move", to: { x: 2, y: 14 } }).ok).toBe(true);
    view = playerView(s, "you");
    const pike = hireInfo(view, "pike");
    expect(pike.reason).toBeNull();
    expect(pike.n).toBe(10);
    expect(hireInfo(view, "griffin").reason?.key).toBe("reason.needsBuilding");
    expect(buildReason(view, "forge")).toBeNull();
    expect(upgradeInfo(view, "pike")?.reason?.key).toBe("reason.needsBuilding");
    expect(upgradeInfo(view, "skeleton")).toBeNull();
    expect(applyAction(s, "you", { type: "build", building: "forge" }).ok).toBe(true);
    view = playerView(s, "you");
    expect(buildReason(view, "mageGuild")?.key).toBe("reason.builtToday");
    expect(buildReason(view, "forge")?.key).toBe("reason.alreadyBuilt");
    expect(upgradeInfo(view, "pike")?.reason).toBeNull();
    expect(mapLockReason(view)).toBeNull();
    expect(myBattle(view)).toBeUndefined();
  });
});
