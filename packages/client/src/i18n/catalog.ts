/**
 * Names and descriptions of the shared game catalog (units, buildings, quests, artifacts, skills, spells, sets,
 * slots, shop items) in the current language, and translation of the engine's and server's own Russian messages
 * (toasts and action errors). `@korony/shared` stays Russian-only; Russian is returned unchanged.
 */
import {
  ARTIFACTS, BUILDINGS, MAX_ARMY_STACKS, QUESTS, SETS, SKILLS, SLOTS, SPELLS, STAT_NAMES, UNITS,
} from "@korony/shared";
import type {
  ArtifactDef, ArtifactId, BuildingId, QuestId, SetId, ShopItem, SkillId, SlotId, SpellId, StatKey, UnitId,
} from "@korony/shared";
import { getLang } from "./index";

const EN_UNITS: Record<UnitId, { name: string; ability?: string }> = {
  pike: { name: "Pikemen", ability: "+50% damage to flyers" },
  halberd: { name: "Halberdiers", ability: "+50% damage to flyers" },
  archer: { name: "Archers" },
  marksman: { name: "Marksmen" },
  griffin: { name: "Griffins", ability: "retaliates against every attack" },
  royalGriffin: { name: "Royal Griffins", ability: "retaliates against every attack" },
  skeleton: { name: "Skeletons" },
  ghost: { name: "Ghosts", ability: "the enemy does not retaliate" },
  lich: { name: "Liches", ability: "also hits adjacent enemies" },
  wolf: { name: "Wolves" },
};

const EN_BUILDINGS: Record<BuildingId, { name: string; desc: string }> = {
  griffinTower: { name: "Griffin Tower", desc: "unlocks griffins, 3 a week" },
  mageGuild: { name: "Mage Guild", desc: "unlocks Heal and Haste" },
  forge: { name: "Forge", desc: "lets you upgrade units" },
};

const EN_SPELLS: Record<SpellId, string> = { bolt: "Lightning", heal: "Heal", haste: "Haste" };

const EN_SKILLS: Record<SkillId, { name: string; desc: string }> = {
  offense: { name: "Offense", desc: "+2 attack" },
  armor: { name: "Armor", desc: "+2 defense" },
  sorcery: { name: "Sorcery", desc: "+1 power" },
  pathfinding: { name: "Pathfinding", desc: "+2 steps a day" },
  luck: { name: "Luck", desc: "+1 luck" },
  leadership: { name: "Leadership", desc: "+1 morale" },
};

const EN_QUESTS: Record<QuestId, string> = {
  chest: "Open a chest",
  mine: "Capture a mine",
  fight: "Defeat a monster guard",
  artifact: "Find an artifact",
  build: "Build something in your castle",
  upgrade: "Upgrade a unit at the forge",
  level3: "Reach level 3",
  conquer: "Capture the enemy castle",
};

const EN_ARTIFACTS: Record<ArtifactId, { name: string; desc?: string }> = {
  sword: { name: "Sword of Might" },
  shield: { name: "Guardian's Shield" },
  rookieMail: { name: "Recruit's Cuirass" },
  apprenticeRing: { name: "Apprentice's Ring" },
  boots: { name: "Wanderer's Boots" },
  windCloak: { name: "Cloak of Wind" },
  luckAmulet: { name: "Amulet of Luck" },
  valorPauldrons: { name: "Pauldrons of Valor" },
  mageRing: { name: "Mage's Ring" },
  crown: { name: "Overlord's Crown" },
  ashHelm: { name: "Ash Helm" },
  ashMail: { name: "Ash Cuirass" },
  ashBlade: { name: "Ash Blade" },
  stormOrb: { name: "Storm Orb", desc: "lightning hits twice as hard" },
};

const EN_STATS: Record<StatKey, string> = {
  atk: "attack",
  def: "defense",
  pow: "power",
  move: "steps a day",
  spd: "unit speed",
  luck: "luck",
  morale: "morale",
  dmgPct: "% damage",
  boltX: "lightning power",
};

const EN_SETS: Record<SetId, { name: string; desc: string }> = {
  ash: { name: "Ash set", desc: "+20% damage for all units, morale +1" },
};

const EN_SLOTS: Record<SlotId, string> = {
  head: "Head", neck: "Neck", shoulders: "Shoulders", torso: "Torso", cloak: "Cloak",
  feet: "Feet", weapon: "Weapon", shield: "Shield", ring1: "Ring", ring2: "Ring",
};

const EN_SHOP: Record<string, { name: string; desc: string }> = {
  banner_gold: { name: "Golden banner", desc: "A golden flag for your hero and castle on the map" },
  banner_crimson: { name: "Crimson banner", desc: "A crimson flag with a black border" },
  banner_emerald: { name: "Emerald banner", desc: "A rare emerald flag with a coat of arms" },
  premium_30: { name: "Premium for 30 days", desc: "A premium mark in the lobby and profile for 30 days" },
  loadout_sword: { name: "Start with the Sword of Might", desc: "Your hero starts the game with the Sword of Might (+2 attack)" },
  loadout_amulet: { name: "Start with the Amulet of Luck", desc: "Your hero starts the game with the Amulet of Luck (+1 luck)" },
  loadout_gold: { name: "War chest", desc: "+1000 gold at the start of the game" },
};

/** Approximate army sizes from `approx` ("мало", "5–9", ...). */
const EN_APPROX: Record<string, string> = { "мало": "few" };

function en(): boolean {
  return getLang() === "en";
}

export function unitName(id: UnitId): string {
  return en() ? EN_UNITS[id].name : UNITS[id].name;
}

export function unitAbility(id: UnitId): string | undefined {
  return en() ? EN_UNITS[id].ability : UNITS[id].ability;
}

export function buildingName(id: BuildingId): string {
  return en() ? EN_BUILDINGS[id].name : BUILDINGS[id].name;
}

export function buildingDesc(id: BuildingId): string {
  return en() ? EN_BUILDINGS[id].desc : BUILDINGS[id].desc;
}

export function spellName(id: SpellId): string {
  return en() ? EN_SPELLS[id] : SPELLS[id].name;
}

export function skillName(id: SkillId): string {
  return en() ? EN_SKILLS[id].name : SKILLS[id].name;
}

export function skillDesc(id: SkillId): string {
  return en() ? EN_SKILLS[id].desc : SKILLS[id].desc;
}

export function questName(id: QuestId): string {
  if (en()) return EN_QUESTS[id];
  return QUESTS.find((q) => q.id === id)?.name ?? id;
}

export function artifactName(id: ArtifactId): string {
  return en() ? EN_ARTIFACTS[id].name : ARTIFACTS[id].name;
}

/** Effect text of an artifact, e.g. "+2 атака, часть комплекта" / "+2 attack, part of a set". */
export function artifactFx(a: ArtifactDef): string {
  const english = en();
  const parts: string[] = [];
  for (const k of Object.keys(a.fx) as StatKey[]) {
    if (k === "boltX") continue;
    parts.push(`+${String(a.fx[k])} ${english ? EN_STATS[k] : STAT_NAMES[k]}`);
  }
  const desc = english ? EN_ARTIFACTS[a.id].desc : a.desc;
  if (desc) parts.push(desc);
  if (a.set) parts.push(english ? "part of a set" : "часть комплекта");
  return parts.join(", ");
}

export function setName(id: SetId): string {
  return en() ? EN_SETS[id].name : SETS[id].name;
}

export function setDesc(id: SetId): string {
  return en() ? EN_SETS[id].desc : SETS[id].desc;
}

export function slotName(id: SlotId): string {
  return en() ? EN_SLOTS[id] : (SLOTS.find((s) => s.id === id)?.name ?? id);
}

export function shopItemName(item: ShopItem): string {
  return (en() && EN_SHOP[item.id]?.name) || item.name;
}

export function shopItemDesc(item: ShopItem): string {
  return (en() && EN_SHOP[item.id]?.desc) || item.desc;
}

/** Approximate army size label ("мало" → "few"). */
export function countLabel(hint: string): string {
  return en() ? (EN_APPROX[hint] ?? hint) : hint;
}

// ================= engine / server messages =================

/** Exact Russian messages of the engine (action errors, toasts) and the match server. */
const EN_MESSAGES: Record<string, string> = {
  "Сначала закончите бой": "Finish the battle first",
  "Вы уже завершили день. Дождитесь соперника": "You have already ended the day. Wait for your opponent",
  "Вы уже завершили день": "You have already ended the day",
  "Ваш герой погиб": "Your hero has fallen",
  "Неверная клетка": "Invalid tile",
  "Герой уже здесь": "The hero is already here",
  "Там туман. Подойдите ближе": "It is foggy there. Come closer",
  "Шаги на сегодня кончились. Завершите день": "No steps left today. End the day",
  "Туда не пройти": "You cannot get there",
  "Там уже идёт бой": "A battle is already going on there",
  "Там уже идёт бой.": "A battle is already going on there.",
  "Герой должен быть в своём замке": "The hero must be in your castle",
  "В этом замке такой отряд не нанять": "This unit cannot be hired in this castle",
  "Нет доступных отрядов. Ждите новой недели": "None available. Wait for the new week",
  "Не хватает золота": "Not enough gold",
  "Эта постройка недоступна вашей фракции": "Your faction cannot build this",
  "Уже построено": "Already built",
  "Сегодня уже строили": "You have already built today",
  "Этот отряд нельзя улучшить": "This unit cannot be upgraded",
  "Такого отряда нет в армии": "There is no such unit in the army",
  "Этого артефакта нет в рюкзаке": "This artifact is not in the backpack",
  "Слот пуст": "The slot is empty",
  "Нет навыка для выбора": "No skill to choose",
  "Нет такого варианта": "No such option",
  "Вы не в бою": "You are not in a battle",
  "Сейчас ходит противник": "It is the opponent's turn",
  "Бой окончен": "The battle is over",
  "Нет героя, чтобы колдовать": "No hero to cast spells",
  "Герой не знает этого заклинания": "The hero does not know this spell",
  "В этом раунде уже колдовали": "A spell was already cast this round",
  "Нет такого отряда": "No such unit",
  "Выберите вражеский отряд": "Choose an enemy unit",
  "Выберите свой отряд": "Choose one of your units",
  "Неверное действие": "Invalid action",
  "Игра окончена": "The game is over",
  "Нет такого игрока": "No such player",
  "Вы выбыли из игры": "You are out of the game",
  "Так нельзя": "Not allowed",
  "Замок захвачен!": "Castle captured!",
  "Новая неделя! В замке новые войска.": "A new week! New troops in the castle.",
  "Рудник ваш: +500 золота в день": "The mine is yours: +500 gold a day",
  // match server
  "Слишком много действий, подождите немного": "Too many actions, wait a moment",
  "Неверное сообщение": "Invalid message",
  "Ждём соперника": "Waiting for the opponent",
  "Ошибка сервера": "Server error",
  "Соперник отключился, ждём его возвращения": "Your opponent disconnected, waiting for them to return",
  "Соперник вернулся": "Your opponent is back",
  "Соперник покинул партию. Победа!": "Your opponent left the game. Victory!",
  "Партия уже идёт": "The game has already started",
  "Комната заполнена": "The room is full",
  "Вы уже ждёте соперника в этой комнате": "You are already waiting for an opponent in this room",
  "Неверные параметры входа в комнату": "Invalid room options",
  "Неизвестная карта": "Unknown map",
  "Нужно войти заново": "Please sign in again",
};

function byRuName<T extends string>(table: Record<T, { name: string }>, name: string): T | undefined {
  return (Object.keys(table) as T[]).find((k) => table[k].name === name);
}

function questByRuName(name: string): QuestId | undefined {
  return QUESTS.find((q) => q.name === name)?.id;
}

/** Patterned engine messages: [pattern, English builder]. */
const EN_PATTERNS: readonly [RegExp, (m: RegExpMatchArray) => string | null][] = [
  [/^Построено: (.+)$/, (m) => {
    const id = byRuName(BUILDINGS, m[1] ?? "");
    return id ? `Built: ${EN_BUILDINGS[id].name}` : null;
  }],
  [/^Нужна постройка: (.+)$/, (m) => {
    const id = byRuName(BUILDINGS, m[1] ?? "");
    return id ? `Requires: ${EN_BUILDINGS[id].name}` : null;
  }],
  [/^Навык: (.+) \((.+)\)$/, (m) => {
    const id = byRuName(SKILLS, m[1] ?? "");
    return id ? `Skill: ${EN_SKILLS[id].name} (${EN_SKILLS[id].desc})` : null;
  }],
  [/^В армии не больше (\d+) отрядов$/, (m) => `An army holds at most ${m[1] ?? MAX_ARMY_STACKS} units`],
  [/^Задание выполнено: (.+?)((?:\. \+[\d\s ]+ (?:золота|опыта))*)$/, (m) => {
    const id = questByRuName(m[1] ?? "");
    if (!id) return null;
    const rewards = (m[2] ?? "").replace(/золота/g, "gold").replace(/опыта/g, "exp");
    return `Quest complete: ${EN_QUESTS[id]}${rewards}`;
  }],
  [/^\+([\d\s ]+) золота$/, (m) => `+${(m[1] ?? "").trim()} gold`],
  [/^(.+) захватывает замок!$/, (m) => `${m[1] ?? ""} captures a castle!`],
  [/^(.+) повержен! Артефакты достаются победителю\.$/, (m) => `${m[1] ?? ""} is defeated! The winner takes the artifacts.`],
  [/^(.+) артефакт: (.+) \((.*)\)$/, (m) => {
    const id = byRuName(ARTIFACTS, m[2] ?? "");
    if (!id) return null;
    const a = ARTIFACTS[id];
    const rarity = ["Common", "Rare", "Epic", "Legendary"][a.rarity] ?? "";
    return `${rarity} artifact: ${EN_ARTIFACTS[id].name} (${artifactFx(a)})`;
  }],
];

/**
 * A message produced by the engine or the server (Russian) in the current language. Unknown messages
 * (and everything in Russian mode) are returned unchanged.
 */
export function engineText(text: string): string {
  if (!en()) return text;
  const exact = EN_MESSAGES[text];
  if (exact) return exact;
  for (const [re, build] of EN_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const out = build(m);
    if (out) return out;
  }
  return text;
}
