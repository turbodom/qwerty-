import { afterEach, describe, expect, it } from "vitest";
import { ARTIFACTS, BUILDINGS, QUESTS, SKILLS, UNITS } from "@korony/shared";
import type { ArtifactId, BuildingId, SkillId, UnitId } from "@korony/shared";
import { setLang } from "../src/i18n";
import {
  artifactFx, artifactName, buildingName, countLabel, engineText, questName, skillName, unitName,
} from "../src/i18n/catalog";
import { feedbackFromEvents } from "../src/game/toasts";

const CYRILLIC = /[А-Яа-яЁё]/;

afterEach(() => setLang("ru"));

describe("catalog translations", () => {
  it("returns the shared (Russian) names in Russian", () => {
    setLang("ru");
    expect(unitName("pike")).toBe(UNITS.pike.name);
    expect(buildingName("forge")).toBe(BUILDINGS.forge.name);
    expect(engineText("Построено: Кузница")).toBe("Построено: Кузница");
  });

  it("has English for every unit, building, skill, quest and artifact", () => {
    setLang("en");
    for (const id of Object.keys(UNITS) as UnitId[]) expect(unitName(id)).not.toMatch(CYRILLIC);
    for (const id of Object.keys(BUILDINGS) as BuildingId[]) expect(buildingName(id)).not.toMatch(CYRILLIC);
    for (const id of Object.keys(SKILLS) as SkillId[]) expect(skillName(id)).not.toMatch(CYRILLIC);
    for (const q of QUESTS) expect(questName(q.id)).not.toMatch(CYRILLIC);
    for (const id of Object.keys(ARTIFACTS) as ArtifactId[]) {
      expect(artifactName(id)).not.toMatch(CYRILLIC);
      expect(artifactFx(ARTIFACTS[id])).not.toMatch(CYRILLIC);
    }
    expect(countLabel("мало")).toBe("few");
  });

  it("translates the engine's messages in English", () => {
    setLang("en");
    expect(engineText("Построено: Кузница")).toBe("Built: Forge");
    expect(engineText("Герой должен быть в своём замке")).toBe("The hero must be in your castle");
    expect(engineText("Навык: Нападение (+2 атака)")).toBe("Skill: Offense (+2 attack)");
    expect(engineText("Нужна постройка: Кузница")).toBe("Requires: Forge");
    expect(engineText("Соперник вернулся")).toBe("Your opponent is back");
    expect(engineText("Задание выполнено: Откройте сундук. +500 золота")).toBe("Quest complete: Open a chest. +500 gold");
    expect(engineText("something else")).toBe("something else");
  });

  it("feedback toasts are English in English", () => {
    setLang("en");
    const fb = feedbackFromEvents(
      [
        { type: "quest", player: "you", quest: "build" },
        { type: "toast", player: "you", text: "Задание выполнено: Постройте здание в замке. +500 золота" },
        { type: "toast", player: "you", text: "Построено: Кузница" },
      ],
      "you",
    );
    for (const text of fb.toasts) expect(text).not.toMatch(CYRILLIC);
  });
});
